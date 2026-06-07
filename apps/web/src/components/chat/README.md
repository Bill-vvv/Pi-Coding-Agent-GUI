# Chat components

This folder owns the Chat conversation surface rendering.

## Ownership

- `ChatView.tsx` wires chat shell state, feedback banners, load-older behavior, and auto-follow scroll behavior.
- `ConversationBlockList.tsx` owns virtualized block list measurement and the non-virtual `ConversationBlockList` test/detail renderer.
- `ConversationBlockRenderer.tsx` renders message blocks and dispatches tool-group blocks.
- `ToolGroupBlock.tsx` renders grouped thinking/tool/subagent process details.
- `SubagentProcessBlock.tsx` renders subagent process previews/actions used inside tool groups.
- `ScrollableContent.tsx` owns the stealth-scrollbar presentation hook for nested scroll areas.

## Boundaries

Conversation display derivation must stay in `apps/web/src/domain/conversationDisplay.ts`; this folder consumes `ConversationDisplayBlock` models and renders them. Do not decode raw server/Pi payloads here.

Keep new chat-only rendering helpers in this folder. Move logic to `apps/web/src/domain/` only when it is pure, display-oriented, and reused outside chat. Do not add WebSocket command sending or reducer-style server-event application to this folder.

`index.ts` is the public surface for this folder. Keep it small; internal block helpers should be imported only by sibling files unless an external consumer explicitly needs them.
