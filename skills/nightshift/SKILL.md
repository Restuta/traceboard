---
name: nightshift
description: Start (or stop) nightshift recording for THIS Claude Code session — turns the session into a live kanban board + replay tape. Use when the user types /nightshift, or asks to record/track/watch the current session on the nightshift board. Recording is per-session and off by default; typing nothing has zero impact on other sessions.
---

# /nightshift — record this session

nightshift's hooks are pre-registered globally but **gated on a per-session
marker file**. They do nothing until this skill creates the marker for the
current session, so sessions where `/nightshift` is never typed pay only a
sub-millisecond shell test (no `node`, no logging). This skill flips the marker
for `$CLAUDE_CODE_SESSION_ID`.

Read `~/.nightshift/install.json` for paths:
`{ "repo", "server", "emit", "resolveLog" }`. If that file is missing, the
one-time global install hasn't run — tell the user to run
`node <nightshift-repo>/tools/install-global.js` once, then retry. Do not try to
edit `~/.claude/settings.json` yourself.

Parse the argument (default is `on`):

## `/nightshift` or `/nightshift on`
Start recording this session and open the board.

1. Mark the session, emit the opening event, and bring up the board — all in
   one block:
   ```sh
   SID="$CLAUDE_CODE_SESSION_ID"
   REPO=$(node -e 'console.log(require(require("os").homedir()+"/.nightshift/install.json").repo)')
   LOG=$(node "$REPO/tools/resolve-log.js")
   mkdir -p ~/.nightshift/active && touch ~/.nightshift/active/"$SID"
   node "$REPO/tools/emit.js" session --phase start --agent claude \
     --title "$(basename "$PWD")" --cwd "$PWD" --log "$LOG"
   node "$REPO/tools/board.js" --open --session "$(basename "$LOG" .jsonl)"
   ```
   `board.js` prints the URL and opens it in the browser; it starts the server
   on the first call (detached, so it outlives this session) and reuses it on
   later ones.
2. From here on, every edit/todo/commit this session makes is recorded and
   shows up live on that board. Tell the user recording is **on for this
   session only**, give them the URL `board.js` printed, and mention
   `/nightshift off` to stop.

## `/nightshift off` (or `stop`)
```sh
rm -f ~/.nightshift/active/"$CLAUDE_CODE_SESSION_ID"
REPO=$(node -e 'console.log(require(require("os").homedir()+"/.nightshift/install.json").repo)')
LOG=$(node "$REPO/tools/resolve-log.js")
node "$REPO/tools/emit.js" session --phase idle --log "$LOG"
```
Confirm recording is paused for this session (the tape is kept).

## `/nightshift watch`
Just (re)open the board without changing recording state:
```sh
REPO=$(node -e 'console.log(require(require("os").homedir()+"/.nightshift/install.json").repo)')
node "$REPO/tools/board.js" --open --session "$(basename "$(node "$REPO/tools/resolve-log.js")" .jsonl)"
```
The session switcher lists every recorded project.

## `/nightshift status`
Report whether `~/.nightshift/active/$CLAUDE_CODE_SESSION_ID` exists (recording
on/off), the resolved `$LOG`, and its event count (`wc -l`).

Keep replies to one or two lines — this is a recorder, not a chat.
