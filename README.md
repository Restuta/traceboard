# traceboard

A live flight recorder for AI agent sessions. Work items move across a kanban
board, line counts tick with every commit, and the whole session can be
replayed from a timeline scrubber — all rendered from a single append-only
event log.

![traceboard live view](docs/screenshots/board-live.png)

Most agent boards are orchestrators: the board exists first and dispatches
agents to cards. traceboard is the inverse — **observability first**. The
session already exists; the board is a pure visualization of its traces. Facts
(commits, file edits, session lifecycle) are emitted deterministically by git
and Claude Code hooks. Intent (work items, milestones) is emitted by the agent
on purpose. The model is never responsible for keeping the board honest.

## Quickstart

```sh
git clone https://github.com/Restuta/traceboard
cd traceboard
npm run demo        # synthesizes a 48-minute session, serves it at :4173
```

Open http://localhost:4173 — you'll see the final state of a session in which
traceboard built itself. Press **▶** to replay it from the start at 10× or
60×; drag on the timeline to scrub anywhere. Zero dependencies, no build step:
plain Node ≥ 18.

![traceboard replay — scrubbed to a CI failure mid-session](docs/screenshots/board-replay.png)

## How it works

```
  facts                      intent
  ─────                      ──────
  git post-commit hook       agent runs tools/emit.js
  claude code hooks               (item / note events)
        │                          │
        └──────────┬───────────────┘
                   ▼
      .traceboard/events.jsonl          ← append-only, the only contract
                   │
                   ▼
        server.js (SSE tail)            ← zero-dep static + event stream
                   │
                   ▼
        state = fold(events[0..t])      ← pure reducer, public/reducer.js
                   │
                   ▼
        board · tape · timeline         ← live is t=now, replay is any t
```

The reducer being pure over the log is the load-bearing design decision:
live mode and time travel are the same code path evaluated at different `t`.
The corollary (see [docs/EVENTS.md](docs/EVENTS.md)) is that external facts —
CI status, PR state — are *recorded as events*, never fetched at render time.
Replaying yesterday's session must show yesterday's CI status.

## Attaching to a real session

This repo watches itself, and the same wiring works in any project:

1. Copy `hooks/claude-hook.js` and the `hooks` block of `.claude/settings.json`
   into the target project — Claude Code sessions there now emit `session`,
   `edit`, and `todos` events automatically.
2. `npm run setup` (or copy `.githooks/post-commit`) — commits now emit
   `commit` events with line counts, no matter who commits.
3. Run `node server.js` from this repo with `--log <project>/.traceboard/events.jsonl`.
4. Optionally, teach the agent the intent layer (see the dogfooding protocol in
   [CLAUDE.md](CLAUDE.md)): one `item` event per PR-sized deliverable via
   `tools/emit.js`.

The board is also **bidirectional**: type into the inbox column and the card is
appended to the log; the `UserPromptSubmit` hook surfaces open inbox cards to
the agent as context at the start of its next turn.

## Event vocabulary

`session` · `item` · `todos` · `edit` · `commit` · `pr` · `ci` · `note` —
envelope, semantics, and the attribution heuristic are specified in
[docs/EVENTS.md](docs/EVENTS.md). Unknown types are ignored by design, so the
vocabulary can grow without breaking old logs.

## Roadmap

- [ ] Transcript importer — synthesize a board from any past Claude Code
      session JSONL, no hooks required (attach retroactively)
- [ ] PR/CI poller — record GitHub facts as events (`pr`, `ci`) automatically
- [ ] Churn heatmap — surface add/delete/re-add loops, the visual signature of
      an agent flailing
- [ ] Multi-session switcher — one server, many tapes
- [ ] Shareable replays — export a tape + static player

## License

MIT
