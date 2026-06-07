# UI primitives

This folder owns small reusable UI primitives for `apps/web`.

## Boundary

- Put generic, style-system-level components here, such as `IconButton`, compact buttons, inputs, badges, and similar controls.
- Keep feature state, WebSocket commands, server-event projection, and business-specific rendering outside this folder.
- Prefer props that describe UI semantics (`icon`, `label`, `variant`) instead of leaking feature details.
- Do not add one-off feature helpers here; keep those inside the feature folder until at least two surfaces need the same primitive.

## Icon rules

- Icons are registered in `../Icon` and consumed by semantic `IconName` values.
- Icon-only buttons should use `IconButton` so `title`, `aria-label`, `type="button"`, and `.icon-button` styling stay consistent.
- Do not inline ad-hoc SVG in feature components unless the SVG is genuinely feature-specific artwork.
