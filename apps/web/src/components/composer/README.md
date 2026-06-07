# Composer components

Feature-local components for the chat composer surface.

- `Composer.tsx` owns the prompt textarea, high-frequency input state, and command/file/voice orchestration.
- Components in this folder render focused controls and receive typed props/callbacks.
- Do not send WebSocket commands directly from presentational controls; route actions through callbacks from `Composer`/`App`.
- Keep pure parsing/ranking/routing logic in `domain/composerCommands` and `domain/droppedPromptFiles`.
