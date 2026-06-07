# Composer Commands

This folder owns pure slash-command parsing and routing for the composer.

## Boundaries

- Keep command text parsing, command classification, and Pi RPC command construction here.
- Keep React state, browser APIs (`window.confirm`, `navigator.clipboard`), WebSocket `send()`, and prompt clearing in hooks.
- Do not move these helpers to `packages/shared`; they are GUI behavior, not cross-layer protocol contracts.
- Add new slash commands by updating the route table/helpers here and adding focused tests.

## Public surface

Use `index.ts` for stable exports consumed by hooks/tests. Internal helpers should stay local to this folder until another feature needs them.
