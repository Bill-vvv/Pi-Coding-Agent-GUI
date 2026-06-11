# WebSocket State Bus Stabilization Plan

Status: implemented on `feat/websocket-state-bus-stabilization` (Trellis roadmap 5/5 done). This document records the product/architecture decision that Pi GUI WebSocket is a first-class state consistency subsystem, not a best-effort transport detail.

## Decision

Treat the WebSocket layer as the GUI's **state bus + command channel + recovery channel + replay channel**.

The key product questions for future work are:

1. When can the frontend trust its local state?
2. How are changes that happen while disconnected recovered?
3. How does the user know the lifecycle of a command they clicked?

If a WebSocket change cannot answer these questions, it is probably only improving connectivity, not state consistency.

## Current implementation map

Current connect/reconnect flow:

```text
apps/web/src/hooks/useGuiSocket.ts
→ open /ws with token + sinceEventId
→ apps/server/src/index.ts validates auth
→ server sends minimal hello with protocol capabilities
→ server sends bootstrap.begin
→ server sends typed bootstrap.chunk snapshots
→ server sends runtime busy/queue/command/pending UI seed events
→ server sends bootstrap.complete
→ server replays gui.event envelopes or emits event.replay.gap
→ server sends replay.complete
→ server sends connection.ready
→ frontend enters ready only after connection.ready and keeps replay gaps degraded until resync snapshots land
→ frontend reconnects with exponential backoff unless unauthorized
```

Important current files:

| Area | Path |
| --- | --- |
| Frontend socket lifecycle | `apps/web/src/hooks/useGuiSocket.ts` |
| Frontend connection type | `apps/web/src/types.ts` |
| Frontend reducer | `apps/web/src/state/appReducer.ts` |
| Server `/ws` bootstrap/replay | `apps/server/src/index.ts` |
| Server WebSocket hub/backpressure/heartbeat | `apps/server/src/ws/wsHub.ts` |
| Replay gap detection | `apps/server/src/runtime/eventReplay.ts` |
| Shared protocol | `packages/shared/src/protocol.ts` |

Confirmed strengths:

- Reconnect carries `sinceEventId`.
- The replay cursor only advances on persisted `gui.event`, replay gap, or stale `hello` correction.
- Replay gap detection already distinguishes `pruned`, `truncated`, and `stale_cursor`.
- Transient socket errors are not immediately promoted to the main chat error banner.
- Server `WsHub` has heartbeat and slow-client/backpressure protection.
- Initial `hello` has already been partially slimmed by keeping only active subagent runs in the bootstrap.

Implemented so far:

- `connection.ready` is the short-term trust boundary; the frontend no longer treats raw socket open as interactive state.
- Bootstrap is phased through `bootstrap.begin`, scoped `bootstrap.chunk` snapshots, `bootstrap.complete`, `replay.complete`, then `connection.ready`.
- `event.replay.gap` creates degraded recovery state and triggers targeted resync of active conversation/session/command snapshots.
- Frontend diagnostics now retain sanitized endpoint/auth presence, hello/ready/server timestamps, replay cursor, last replay gap, close code/reason/`wasClean`, reconnect attempt, and auth/backpressure clues.
- Unauthorized close is represented distinctly and does not loop forever.
- A frontend pending command registry records sent commands by `requestId`, resolves `command.result`, times out stale commands, marks disconnect-unknown states, and exposes composer/diagnostics status.

Protocol organization:

- `packages/shared/src/protocol.ts` now remains the stable compatibility re-export.
- Cohesive protocol ownership lives under `packages/shared/src/protocol/`:
  - `commands.ts` for frontend → server commands;
  - `bootstrap.ts` for hello/bootstrap/ready trust boundaries;
  - `replay.ts` for replay cursor/gap semantics;
  - `diagnostics.ts` for command-result lifecycle events;
  - `events.ts` for backend → frontend state events and the final `ServerEvent` union.

## State model principle

Every UI-affecting state change must be explicitly classified as one of:

| Class | Examples | Recovery contract |
| --- | --- | --- |
| Durable event | `gui.event` envelopes for conversation/tool/runtime facts that must be replayed | Must be persisted and replayable, with cursor and dedupe semantics. |
| Snapshot state | projects, runtimes, settings, sessions, queues, commands, pending extension UI | Must be fully covered by bootstrap/resync snapshots after reconnect. |
| Ephemeral signal | temporary warnings, non-critical hints, local UI toasts | May be lost; must not be required to reconstruct trusted state. |

Rule:

> All non-lossy state changes must either enter the durable replay stream or be fully covered by a bootstrap/resync snapshot.

## Target governance objects

### 1. Connection State

Frontend components must consume a product-level connection state, not raw `WebSocket.readyState`.

Target states:

```text
connecting
connected_waiting_hello
bootstrapping
replaying
ready
degraded
reconnecting
closed
unauthorized
```

Short-term compatibility may use fewer states, but critical actions should be enabled only when the connection is `ready` or an explicitly allowed degraded/resync state.

### 2. Bootstrap Protocol

Short-term target:

```text
hello
→ seed snapshots
→ replay gui.event
→ connection.ready
```

`connection.ready` means the server has finished the current connection's bootstrap seed events and replay pass.

Medium-term target:

```text
hello.minimal
→ bootstrap.begin
→ bootstrap.chunk(projects/runtimes/settings/sessions/queues/commands/pendingUi/...)
→ bootstrap.complete
→ gui.event replay
→ replay.complete
→ connection.ready
```

The short-term `connection.ready` event gives the frontend an immediate trust boundary without requiring the full bootstrap split in the first implementation.

### 3. Durable Event Stream

The durable stream owns:

- `gui.event` envelopes;
- replay cursor;
- event ordering/dedupe;
- `event.replay.gap`;
- recovery rules after replay gaps.

The durable stream should not be treated as a catch-all for all state. Snapshot-only state is allowed, but the ownership boundary must be explicit.

### 4. Command Lifecycle

Every frontend command send path already receives or generates a `requestId`. Product-level behavior should track request lifecycle:

```text
created → sent → acknowledged/result → succeeded | failed | timeout | unknown_after_disconnect
```

Short-term implementation can stay frontend-only using `command.result`; protocol changes for accepted/started/progress can come later if needed.

### 5. Diagnostics

WebSocket diagnostics are a core dogfood/recovery surface, not optional console noise.

Diagnostics should record/display at least:

```text
Connection state
WS URL without token
Auth present/not present
Last server time
Last hello time
Last ready time
Last GUI event id
Reconnect attempts
Last close code/reason/wasClean
Replay status and last gap
Backpressure/slow-client clue when known
Pending commands summary
```

Never display auth tokens or credential payloads.

## Roadmap and Trellis task map

| Priority | Task | Purpose |
| --- | --- | --- |
| P0 | `.trellis/tasks/06-11-websocket-ready-recovery-contract` | Done — add the trust boundary: `connection.ready`, ready-based UI gating, replay-gap degraded/resync behavior, and close diagnostics capture. |
| P1 | `.trellis/tasks/06-11-websocket-bootstrap-protocol-hardening` | Done — reduce bootstrap payload risk and move toward phased snapshot/replay completion semantics. |
| P1 | `.trellis/tasks/06-11-websocket-diagnostics-panel` | Done — add a hidden/developer-facing diagnostics panel for connection, replay, close, backpressure, auth, and pending command state. |
| P1 | `.trellis/tasks/06-11-websocket-pending-command-registry` | Done — add a frontend pending command registry with timeout and reconnect handling. |
| P2 | `.trellis/tasks/06-11-websocket-protocol-module-split` | Done — split shared protocol modules after stabilization without changing behavior. |

Parent tracking task: `.trellis/tasks/06-11-websocket-state-bus-stabilization`.

## Product acceptance criteria

WebSocket stabilization is accepted when:

1. First startup enters the interactive state only after bootstrap/replay are complete.
2. A short disconnect does not produce a scary error, but a persistent disconnect is visible.
3. Reconnect does not duplicate old messages.
4. Reconnect does not lose runtime busy/queue/command state.
5. Replay gaps mark recovery as partial/degraded and trigger a targeted resync.
6. Critical commands have pending/success/fail/timeout/unknown-after-disconnect state.
7. Close code/reason and replay/backpressure diagnostics are visible in a debug surface.
8. Backpressure-driven disconnects are diagnosable.
9. Unauthorized sockets do not enter infinite reconnect UX.
10. After a server restart, the frontend recovers to a clearly trusted or degraded state.

## Validation strategy

Latest validation on 2026-06-11:

```bash
npm run typecheck
npm test
npm run build
```

All passed. `npm run build` emits only the existing Vite chunk-size warning.

Focused validation per implementation:

- server tests for `connection.ready`, replay completion, gap ordering, auth close behavior;
- web tests for connection state transitions, replay cursor behavior, gap degraded state, pending command timeouts;
- manual dev validation: start app, connect, run a runtime, interrupt/restart backend transport, confirm UI reaches ready/degraded with no duplicate messages and no lost busy state.
