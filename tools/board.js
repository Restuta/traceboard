#!/usr/bin/env node
// Ensure ONE nightshift board server is running (serving ~/.nightshift/sessions)
// and print its URL; with --open, open it in the browser. Reused across
// sessions: the first /nightshift starts it detached, the rest find it alive
// and just hand back (and re-open) the URL.
//
//   node tools/board.js [--open] [--session <slug>] [--port <preferred>]

const http = require('http');
const net = require('net');
const os = require('os');
const fs = require('fs');
const path = require('path');
const { spawn, execFile } = require('child_process');

const args = process.argv.slice(2);
const has = f => args.includes(f);
const val = f => { const i = args.indexOf(f); return i >= 0 ? args[i + 1] : null; };

const nsHome = process.env.NIGHTSHIFT_HOME || path.join(os.homedir(), '.nightshift');
const sessionsDir = path.join(nsHome, 'sessions');
const stateFile = path.join(nsHome, 'board.json');
const serverJs = path.join(__dirname, '..', 'server.js');
const session = val('--session');

// Is a nightshift board answering on this port? /sessions returns a JSON array,
// which also distinguishes our global board from anything else on the port.
function isBoard(port, cb) {
  const req = http.get({ host: '127.0.0.1', port, path: '/sessions', timeout: 600 }, res => {
    let b = '';
    res.on('data', d => (b += d));
    res.on('end', () => { try { cb(Array.isArray(JSON.parse(b))); } catch { cb(false); } });
  });
  req.on('error', () => cb(false));
  req.on('timeout', () => { req.destroy(); cb(false); });
}

// First port >= start that nothing is listening on (so we never hijack, e.g., a
// project board already on 4173).
function freePort(start, cb) {
  const s = net.createServer();
  s.once('error', () => freePort(start + 1, cb));
  s.once('listening', () => s.close(() => cb(start)));
  s.listen(start, '127.0.0.1');
}

function openUrl(url) {
  const cmd = process.platform === 'darwin' ? 'open'
    : process.platform === 'win32' ? 'cmd' : 'xdg-open';
  const a = process.platform === 'win32' ? ['/c', 'start', '', url] : [url];
  try { execFile(cmd, a, () => {}); } catch { /* best effort */ }
}

function urlFor(port) {
  return `http://localhost:${port}/${session ? `?session=${encodeURIComponent(session)}` : ''}`;
}

function done(port) {
  const url = urlFor(port);
  process.stdout.write(url + '\n');
  if (has('--open')) openUrl(url);
}

function start() {
  const preferred = Number(val('--port')) || 4173;
  freePort(preferred, port => {
    fs.mkdirSync(sessionsDir, { recursive: true });
    const out = fs.openSync(path.join(nsHome, 'board.log'), 'a');
    const child = spawn(process.execPath, [serverJs, '--dir', sessionsDir, '--port', String(port)],
      { detached: true, stdio: ['ignore', out, out] });
    child.unref();
    fs.writeFileSync(stateFile, JSON.stringify({ port, pid: child.pid }) + '\n');
    let tries = 0;
    const wait = () => isBoard(port, ok => {
      if (ok || tries++ > 30) return done(port);
      setTimeout(wait, 100);
    });
    setTimeout(wait, 150);
  });
}

// Reuse the board we started before, if it's still alive; else start one.
let prev = null;
try { prev = JSON.parse(fs.readFileSync(stateFile, 'utf8')); } catch { /* none yet */ }
if (prev && prev.port) isBoard(prev.port, ok => (ok ? done(prev.port) : start()));
else start();
