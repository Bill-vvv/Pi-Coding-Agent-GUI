# Client Command Parser Internals

This folder owns runtime validation for WebSocket `ClientCommand` payloads after raw JSON has been parsed.

## Ownership

- `index.ts` is the small public surface consumed by `../parseClientCommand.ts`.
- `validators.ts` owns scalar/array validators and protocol enum coercion.
- `projectSessionSettings.ts` owns project, session, and settings command parsing.
- `runtime.ts` owns runtime lifecycle, prompt/RPC/log command parsing.
- `extensionConversationReplay.ts` owns extension UI, conversation, subagent detail, and event replay parsing.
- `types.ts` contains parser-local aliases only.

## Boundaries

- Raw JSON parsing and the initial `type` string check stay in `../parseClientCommand.ts`.
- These helpers return shared `ClientCommand` variants and must preserve validation messages where practical.
- Do not add command dispatch, database, runtime supervision, or WebSocket send behavior here.
- Add new client commands by updating shared protocol first, then adding parser coverage in the cohesive family module and the switch in `parseClientCommand.ts`.
- Avoid one-file-per-command sprawl; group by command family.
