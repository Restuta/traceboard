#!/usr/bin/env node
// Synthesize a nightshift tape from a past Claude Code session transcript —
// attach the board retroactively, no hooks required.
//   node tools/import-transcript.js <transcript.jsonl> [--out <file>]
//     [--repo <path>] [--no-item]
//
// Transcripts live in ~/.claude/projects/<munged-cwd>/<session-id>.jsonl.
// Mapping (same vocabulary the live hooks produce, see docs/EVENTS.md):
//   first/last timestamp        → session start / end
//   human prompts               → session resume (with idle at the prior lull)
//   Edit/Write/NotebookEdit     → edit
//   TodoWrite                   → todos
//   AskUserQuestion             → session attention
//   `git commit` tool output    → commit (sha, message, shortstat)
//   --repo <path>               → commit facts taken from `git log` over the
//                                 session window instead — exact numbers from
//                                 git, not parsed from model output. Wins on
//                                 sha collision with parsed commits.

const fs = require('fs');
const path = require('path');
const { execFileSync } = require('child_process');

const argv = process.argv.slice(2);
const flags = { repo: [] };
const positional = [];
for (let i = 0; i < argv.length; i++) {
  if (argv[i] === '--out') flags.out = argv[++i];
  else if (argv[i] === '--repo') flags.repo.push(argv[++i]);
  else if (argv[i] === '--no-item') flags.noItem = true;
  else positional.push(argv[i]);
}

const src = positional[0];
if (!src) {
  console.error('usage: import-transcript.js <transcript.jsonl> [--out <file>] [--repo <path>] [--no-item]');
  process.exit(1);
}

const lines = fs.readFileSync(src, 'utf8').split('\n').filter(Boolean);

// ---- pass 1: session metadata ----------------------------------------------

let sessionId = null, cwd = null, title = null, aiTitle = null;
for (const line of lines) {
  let e; try { e = JSON.parse(line); } catch { continue; }
  if (e.sessionId && !sessionId) sessionId = e.sessionId;
  if (e.cwd && !cwd) cwd = e.cwd;
  if (e.type === 'custom-title' && e.customTitle) title = e.customTitle;
  if (e.type === 'ai-title' && e.aiTitle) aiTitle = e.aiTitle;
}
title = title || aiTitle || (sessionId ? `session ${sessionId.slice(0, 8)}` : 'imported session');
const sid8 = (sessionId || 'unknown').slice(0, 8);
const root = cwd || '.';

// ---- pass 2: walk the transcript, collect events ----------------------------

const events = [];
const ts = e => e.timestamp ? Date.parse(e.timestamp) : null;

// A human prompt is a non-meta user line whose content is plain text (string,
// or an array with text blocks and no tool_result) and not a local-command echo.
function isHumanPrompt(e) {
  if (e.type !== 'user' || e.isMeta) return false;
  const c = e.message && e.message.content;
  if (typeof c === 'string') return !/^\s*</.test(c);
  if (Array.isArray(c)) {
    return c.some(b => b.type === 'text') && !c.some(b => b.type === 'tool_result');
  }
  return false;
}

let firstT = null, lastT = null, lastActivityT = null;
let phase = null; // 'working' | 'idle' — to avoid redundant idle events
const pendingCommitCalls = new Map(); // tool_use id → t of the bash call
const parsedCommits = [];
let edits = 0, prompts = 0;

for (const line of lines) {
  let e; try { e = JSON.parse(line); } catch { continue; }
  const t = ts(e);
  if (t == null) continue;
  if (firstT == null) firstT = t;
  lastT = t;

  if (isHumanPrompt(e)) {
    // The lull before a prompt was idle time — close the previous turn there.
    if (phase === 'working' && lastActivityT != null) {
      events.push({ t: lastActivityT, type: 'session', phase: 'idle' });
    }
    events.push({ t, type: 'session', phase: 'resume' });
    phase = 'working';
    prompts++;
    continue;
  }

  if (e.type === 'assistant' && e.message && Array.isArray(e.message.content)) {
    lastActivityT = t;
    for (const b of e.message.content) {
      if (b.type !== 'tool_use') continue;
      const inp = b.input || {};
      if (/^(Edit|Write|MultiEdit|NotebookEdit)$/.test(b.name) && (inp.file_path || inp.notebook_path)) {
        events.push({ t, type: 'edit', path: path.relative(root, inp.file_path || inp.notebook_path), tool: b.name });
        edits++;
      } else if (b.name === 'TodoWrite' && Array.isArray(inp.todos)) {
        events.push({
          t, type: 'todos',
          todos: inp.todos.map(td => ({ text: td.content, done: td.status === 'completed' })),
        });
      } else if (b.name === 'AskUserQuestion') {
        const q = inp.questions && inp.questions[0] && inp.questions[0].question;
        events.push({ t, type: 'session', phase: 'attention', text: q || 'agent asked a question' });
      } else if (b.name === 'Bash' && /git .*commit/.test(inp.command || '')) {
        pendingCommitCalls.set(b.id, t);
      }
    }
    continue;
  }

  if (e.type === 'user' && e.message && Array.isArray(e.message.content)) {
    for (const b of e.message.content) {
      if (b.type !== 'tool_result' || !pendingCommitCalls.has(b.tool_use_id)) continue;
      const callT = pendingCommitCalls.get(b.tool_use_id);
      pendingCommitCalls.delete(b.tool_use_id);
      const text = typeof b.content === 'string'
        ? b.content
        : (b.content || []).map(c => c.text || '').join('\n');
      // Standard `git commit` output: "[branch sha] message" + shortstat.
      const head = text.match(/\[[^\s\]]+ ([0-9a-f]{7,40})\] (.+)/);
      if (!head) continue;
      const num = re => { const m = text.match(re); return m ? Number(m[1]) : 0; };
      parsedCommits.push({
        t: callT, type: 'commit', sha: head[1].slice(0, 7), message: head[2].trim(),
        add: num(/(\d+) insertions?\(\+\)/), del: num(/(\d+) deletions?\(-\)/),
        files: num(/(\d+) files? changed/),
      });
    }
  }
}

if (firstT == null) {
  console.error('no timestamped entries found — is this a Claude Code transcript?');
  process.exit(1);
}

// ---- commits: prefer git facts over parsed tool output ----------------------

const gitCommits = [];
for (const repo of flags.repo) {
  const out = execFileSync('git', [
    '-C', repo, 'log', '--no-merges',
    '--since', new Date(firstT - 60000).toISOString(),
    '--until', new Date(lastT + 60000).toISOString(),
    '--pretty=format:%x01%h%x09%ct%x09%s', '--shortstat',
  ], { encoding: 'utf8' });
  for (const chunk of out.split('\x01').filter(Boolean)) {
    const [headLine, statLine] = chunk.split('\n').map(s => s.trim()).filter(Boolean);
    const [sha, ct, message] = headLine.split('\t');
    const num = re => { const m = (statLine || '').match(re); return m ? Number(m[1]) : 0; };
    gitCommits.push({
      t: Number(ct) * 1000, type: 'commit', sha, message,
      add: num(/(\d+) insertions?\(\+\)/), del: num(/(\d+) deletions?\(-\)/),
      files: num(/(\d+) files? changed/),
    });
  }
}
const gitShas = new Set(gitCommits.map(c => c.sha));
const commits = [...gitCommits, ...parsedCommits.filter(c => !gitShas.has(c.sha))];
events.push(...commits);

// ---- envelope: session card, start/end, sort, write -------------------------

events.push({ t: firstT, type: 'session', phase: 'start', title, session: sessionId, cwd });
if (!flags.noItem) {
  events.push({
    t: firstT, type: 'item', id: `wi-import-${sid8}`, title, status: 'doing',
    note: `imported from ${path.basename(src)}`,
  });
}
events.push({ t: lastT, type: 'session', phase: 'end' });

events.sort((a, b) => a.t - b.t);

const out = flags.out || path.join('.nightshift', `import-${sid8}.jsonl`);
fs.mkdirSync(path.dirname(out), { recursive: true });
fs.writeFileSync(out, events.map(e => JSON.stringify(e)).join('\n') + '\n');

const mins = Math.round((lastT - firstT) / 60000);
console.log(`${out}: ${events.length} events — "${title}"`);
console.log(`  ${mins} min, ${prompts} prompts, ${edits} edits, ${commits.length} commits` +
  (flags.repo.length ? ` (${gitCommits.length} from git)` : ''));
console.log(`  replay: node server.js --log ${out}`);
