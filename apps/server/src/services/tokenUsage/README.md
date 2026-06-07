# Token Usage Service Internals

This folder owns backend-only token usage scanning and aggregation for the `/api/usage/overview` route.

## Ownership

- `sessionFiles.ts` owns Pi session root discovery, bounded JSONL line reading, session file listing, safe stat helpers, and session metadata scanning.
- `recordParsing.ts` owns JSON record parsing and tolerant extraction of usage, timestamps, model context, and string fields from Pi session records.
- `aggregation.ts` owns in-memory usage contributions, cache-safe cloning/merging, day/model/streak aggregation, and overview construction.
- `types.ts` contains backend-private types shared by these internals and `TokenUsageService`.
- `index.ts` is the small public surface consumed by `../tokenUsageService.ts`; do not move implementation into it.

## Boundaries

- Keep HTTP/Fastify handling in `routes/usageRoutes.ts`.
- Keep the public compatibility exports in `services/tokenUsageService.ts` (`TokenUsageService`, `normalizeTokenUsageRange`, `emptyTokenUsageOverview`).
- Do not move web-only number formatting or chart display behavior here.
- Do not add shared protocol/domain fields from this folder; `packages/shared` remains the cross-layer contract owner.
- Prefer extending the existing scanner/parser/aggregation modules over adding many one-function files.
