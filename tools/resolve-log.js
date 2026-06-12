#!/usr/bin/env node
// Print the events-log path claude-hook.js would use for the current project,
// so the /nightshift skill (and humans) can emit to / tail the right file.
// Mirrors the resolution in hooks/claude-hook.js.

const fs = require('fs');
const os = require('os');
const path = require('path');

const root = process.env.CLAUDE_PROJECT_DIR || process.cwd();

function resolve() {
  if (process.env.NIGHTSHIFT_LOG) return process.env.NIGHTSHIFT_LOG;
  const local = path.join(root, '.nightshift');
  if (fs.existsSync(local)) return path.join(local, 'events.jsonl');
  const home = process.env.NIGHTSHIFT_HOME || path.join(os.homedir(), '.nightshift');
  const slug = root.replace(/^\/+/, '').replace(/[^A-Za-z0-9._-]+/g, '-') || 'session';
  return path.join(home, 'sessions', `${slug}.jsonl`);
}

process.stdout.write(resolve() + '\n');
