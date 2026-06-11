#!/usr/bin/env node
// Record GitHub PR/CI facts as events — never fetched at render time, per the
// core rule in docs/EVENTS.md: replaying yesterday's session must show
// yesterday's CI status.
//   node tools/poll-github.js [--once] [--interval 30] [--repo owner/name] [--log <file>]
//
// Uses the gh CLI (auth included), zero deps. Stateless: each tick folds the
// current pr/ci state per PR number out of the log itself and appends only
// what changed — safe to restart, safe to run alongside hooks, idempotent.

const fs = require('fs');
const path = require('path');
const { execFileSync } = require('child_process');

const argv = process.argv.slice(2);
const flags = {};
for (let i = 0; i < argv.length; i++) {
  if (argv[i] === '--once') flags.once = true;
  else if (argv[i] === '--interval') flags.interval = Number(argv[++i]);
  else if (argv[i] === '--repo') flags.repo = argv[++i];
  else if (argv[i] === '--log') flags.log = argv[++i];
}
const LOG = flags.log || path.join('.nightshift', 'events.jsonl');
const INTERVAL = (flags.interval || 30) * 1000;

function ghPrs() {
  const args = ['pr', 'list', '--state', 'all', '--limit', '30',
    '--json', 'number,title,url,state,statusCheckRollup'];
  if (flags.repo) args.push('--repo', flags.repo);
  return JSON.parse(execFileSync('gh', args, { encoding: 'utf8' }));
}

// Collapse a statusCheckRollup array to one ci status; null when there are no
// checks (a ci event with nothing behind it would be noise).
function rollupCi(checks) {
  if (!Array.isArray(checks) || !checks.length) return null;
  let pending = false;
  for (const c of checks) {
    const conclusion = c.conclusion || '';
    if (/FAILURE|TIMED_OUT|STARTUP_FAILURE|ACTION_REQUIRED/.test(conclusion)) return 'fail';
    if (c.status && c.status !== 'COMPLETED') pending = true;
  }
  return pending ? 'pending' : 'pass';
}

// What the log already knows, so we only append deltas.
function knownState() {
  const known = new Map(); // number → {state, ci}
  let raw = '';
  try { raw = fs.readFileSync(LOG, 'utf8'); } catch { return known; }
  for (const line of raw.split('\n').filter(Boolean)) {
    let ev; try { ev = JSON.parse(line); } catch { continue; }
    if (ev.type === 'pr' && ev.number != null) {
      known.set(ev.number, { ...(known.get(ev.number) || {}), state: ev.state });
    } else if (ev.type === 'ci' && ev.pr != null) {
      known.set(ev.pr, { ...(known.get(ev.pr) || {}), ci: ev.status });
    }
  }
  return known;
}

function append(ev) {
  fs.mkdirSync(path.dirname(LOG), { recursive: true });
  fs.appendFileSync(LOG, JSON.stringify({ t: Date.now(), ...ev }) + '\n');
  console.log(JSON.stringify(ev));
}

function tick() {
  let prs;
  try { prs = ghPrs(); } catch (err) {
    console.error(`gh failed: ${String(err.message || err).split('\n')[0]}`);
    if (flags.once) process.exit(1);
    return;
  }
  const known = knownState();
  for (const pr of prs) {
    const state = pr.state.toLowerCase(); // open | merged | closed
    const ci = rollupCi(pr.statusCheckRollup);
    const k = known.get(pr.number) || {};
    if (k.state !== state) {
      append({ type: 'pr', number: pr.number, title: pr.title, url: pr.url, state });
    }
    if (ci != null && k.ci !== ci) {
      append({ type: 'ci', pr: pr.number, status: ci });
    }
  }
}

tick();
if (!flags.once) {
  console.error(`polling every ${INTERVAL / 1000}s → ${LOG} (ctrl-c to stop)`);
  setInterval(tick, INTERVAL);
}
