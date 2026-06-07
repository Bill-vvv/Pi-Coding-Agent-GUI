# WebSocket Command Handlers

This folder owns backend WebSocket command dispatch after `parseClientCommand()` has validated the raw client payload.

## Ownership

- `dispatch.ts` owns the command type switch and delegates each command family to focused handlers.
- `projectSessionSettingsCommands.ts` owns project, session list/resume, and settings commands.
- `runtimeCommands.ts` owns runtime lifecycle, prompt/RPC, runtime logs, extension responses, and abort commands.
- `conversationCommands.ts` owns conversation open/page, subagent detail snapshots, and event replay.
- `types.ts` contains the shared command context and `sendCommandResult()` helper.
- `index.ts` is a small public surface for `../commandHandler.ts`; do not move implementation into it.

## Boundaries

- Raw JSON parsing and validation stay in `../commandHandler.ts` plus `protocol/parseClientCommand.ts`.
- Runtime process behavior stays in `runtime/RuntimeSupervisor`; command handlers delegate to it and do not spawn Pi.
- Project/session/database details should go through `AppDatabase` facade methods.
- Keep shared protocol changes in `packages/shared` and parser updates in `protocol/parseClientCommand.ts` before adding new handler cases.
- Add new command families by creating or extending a cohesive family module; avoid one-file-per-command sprawl.
