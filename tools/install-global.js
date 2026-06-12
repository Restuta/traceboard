#!/usr/bin/env node
// Enable *opt-in, per-session* recording for any project, without attaching to
// each one. Registers nightshift's hooks in your global ~/.claude/settings.json
// but gates them behind the NIGHTSHIFT env var, so they stay dormant until you
// ask for them:
//
//   NIGHTSHIFT=1 claude        # this session records
//   claude                     # this session does NOT (hook is a no-op)
//
// Cost when off: Claude Code runs the hook command, but it's a one-line shell
// test that exits before spawning node — a few ms, imperceptible. Only an
// opted-in session pays for node + logging. Events route to a central
// per-project log under ~/.nightshift/sessions/ (nothing inside your repos).
//
//   node tools/install-global.js          # install / update (idempotent)
//   node tools/install-global.js --remove # uninstall
//
// Projects you explicitly `attach` keep their own local .nightshift/ log, always
// record, and take precedence. No git config is touched (a global
// core.hooksPath would override per-repo hooks like Husky), so in opted-in
// sessions commits are captured from the agent's Bash output instead.

const fs = require('fs');
const os = require('os');
const path = require('path');

const remove = process.argv.includes('--remove');
const here = path.resolve(__dirname, '..');
const HOOK = path.join(here, 'hooks', 'claude-hook.js');
const MARK = 'hooks/claude-hook.js'; // identifies our hook command on re-runs
const settingsPath = path.join(os.homedir(), '.claude', 'settings.json');
const sessionsDir = path.join(os.homedir(), '.nightshift', 'sessions');

// Shell-gated: when NIGHTSHIFT is empty/unset the `[ -n ]` test is false and the
// command short-circuits to `true` (exit 0) without ever launching node.
const CMD = `[ -n "$NIGHTSHIFT" ] && node "${HOOK}" || true`;
const EVENTS = {
  SessionStart: null, UserPromptSubmit: null, Stop: null, Notification: null,
  PostToolUse: 'Edit|Write|MultiEdit|NotebookEdit|TodoWrite|Bash',
};

let settings = {};
if (fs.existsSync(settingsPath)) {
  try { settings = JSON.parse(fs.readFileSync(settingsPath, 'utf8')); }
  catch {
    console.error(`refusing to touch unparsable ${settingsPath} — fix it and rerun`);
    process.exit(1);
  }
}
settings.hooks = settings.hooks || {};

function isOurs(group) {
  return (group.hooks || []).some(h => (h.command || '').includes(MARK));
}

if (remove) {
  let removed = 0;
  for (const event of Object.keys(settings.hooks)) {
    const before = settings.hooks[event].length;
    settings.hooks[event] = settings.hooks[event].filter(g => !isOurs(g));
    removed += before - settings.hooks[event].length;
    if (!settings.hooks[event].length) delete settings.hooks[event];
  }
  fs.writeFileSync(settingsPath, JSON.stringify(settings, null, 2) + '\n');
  console.log(`nightshift global hooks removed (${removed} group(s)) from ${settingsPath}`);
  console.log(`Central logs left in place at ${sessionsDir} — delete them by hand if you want.`);
  process.exit(0);
}

// Back up once before the first edit, so there's always a way back.
if (fs.existsSync(settingsPath) && !fs.existsSync(settingsPath + '.nightshift-bak')) {
  fs.copyFileSync(settingsPath, settingsPath + '.nightshift-bak');
}

// Drop any prior version of our group first, then add the current one — this
// makes re-runs idempotent and migrates an older (e.g. ungated) command.
for (const [event, matcher] of Object.entries(EVENTS)) {
  const groups = (settings.hooks[event] || []).filter(g => !isOurs(g));
  const group = { hooks: [{ type: 'command', command: CMD }] };
  if (matcher) group.matcher = matcher;
  groups.push(group);
  settings.hooks[event] = groups;
}

fs.mkdirSync(path.dirname(settingsPath), { recursive: true });
fs.writeFileSync(settingsPath, JSON.stringify(settings, null, 2) + '\n');
fs.mkdirSync(sessionsDir, { recursive: true });

console.log(`nightshift hooks registered in ${settingsPath} (opt-in, gated on $NIGHTSHIFT)`);
console.log(`central logs:  ${sessionsDir}/<project>.jsonl  (one per project)`);
console.log('');
console.log('Record a session by launching it with the env var:');
console.log('  NIGHTSHIFT=1 claude          # this session records; plain `claude` does not');
console.log("  alias nsclaude='NIGHTSHIFT=1 claude'   # optional convenience");
console.log('');
console.log('Watch your recorded sessions (one tab per project):');
console.log(`  node "${path.join(here, 'server.js')}" --dir "${sessionsDir}"`);
console.log('');
console.log('Uninstall:  node tools/install-global.js --remove');
