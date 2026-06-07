# Sidebar module

This folder owns Sidebar-specific behavior that should not become global utilities.

## Ownership

- `Sidebar.tsx` (public wrapper at `components/Sidebar.tsx`) composes JSX and wires callbacks from `App.tsx`.
- `useSidebarOrdering.ts` owns Sidebar-local browser state: collapsed projects, persisted project/session order, read timestamps, and runtime read marking.
- `useSidebarDragReorder.ts` owns drag/drop lifecycle, row measurement, reorder animation, drag payload parsing, and drop CSS state.
- `sidebarOrdering.ts` owns pure ordering helpers used by ordering and drag behavior.
- `sidebarUnread.ts` owns pure unread-dot derivation for runtime rows.

## Dependency rules

- This module may depend on React, `@pi-gui/shared` domain types, and web domain display helpers.
- Do not put WebSocket commands, reducer updates, or backend protocol parsing here; pass callbacks from `App.tsx`/hooks instead.
- Do not move Sidebar-only helpers to a global `utils` folder. Promote a helper to `apps/web/src/domain/` only after another feature area needs the same pure behavior.
- Keep `index.ts` as the small public surface for the feature folder; internal helpers can be imported directly by files in this folder and tests.
