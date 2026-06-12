#!/usr/bin/env node
// One-time setup for /nightshift in *Codex*. Codex has no per-tool hooks, so
// recording works by tailing the rollout file Codex writes (see codex-tail.js)
// — there's nothing to register in config. This installer just makes the
// /nightshift skill available and creates the data dirs.
//
//   node tools/install-codex.js          # install / update (idempotent)
//   node tools/install-codex.js --remove # uninstall
//
// It deliberately does NOT touch ~/.codex/config.toml or hooks.json — those are
// often symlinked dotfiles, and the rollout tail needs no config there.

const fs = require('fs');
const os = require('os');
const path = require('path');

const remove = process.argv.includes('--remove');
const here = path.resolve(__dirname, '..');
const home = os.homedir();
const nsHome = path.join(home, '.nightshift');
const skillSrc = path.join(here, 'skills', 'nightshift');
const skillDir = path.join(home, '.codex', 'skills', 'nightshift');

function clearSkill() {
  try {
    if (fs.lstatSync(skillDir).isSymbolicLink()) fs.unlinkSync(skillDir);
    else fs.rmSync(skillDir, { recursive: true, force: true });
  } catch { /* not there */ }
}

if (remove) {
  clearSkill();
  console.log(`nightshift Codex skill removed from ${skillDir}`);
  console.log(`(Claude install, install.json, and recorded tapes are left alone.)`);
  process.exit(0);
}

if (!fs.existsSync(path.join(home, '.codex'))) {
  console.error('~/.codex not found — is Codex installed for this user?');
  process.exit(1);
}

// Symlink the shared skill (same source as the Claude install) so repo edits
// and `git pull` are live with no reinstall.
clearSkill();
fs.mkdirSync(path.dirname(skillDir), { recursive: true });
fs.symlinkSync(skillSrc, skillDir, 'dir');

fs.mkdirSync(path.join(nsHome, 'sessions'), { recursive: true });
fs.mkdirSync(path.join(nsHome, 'active'), { recursive: true });
fs.writeFileSync(path.join(nsHome, 'install.json'), JSON.stringify({
  repo: here,
  server: path.join(here, 'server.js'),
  emit: path.join(here, 'tools', 'emit.js'),
  resolveLog: path.join(here, 'tools', 'resolve-log.js'),
}, null, 2) + '\n');

console.log('nightshift installed for Codex:');
console.log(`  skill  → ${skillDir}  (use /nightshift in any Codex session)`);
console.log(`  tapes  → ${path.join(nsHome, 'sessions')}/<project>.jsonl`);
console.log('');
console.log('In a Codex session: /nightshift  → tails the rollout + opens the board.');
console.log('Recording is per-session (stop: /nightshift off). Nothing else is affected.');
console.log('');
console.log('Uninstall:  node tools/install-codex.js --remove');
