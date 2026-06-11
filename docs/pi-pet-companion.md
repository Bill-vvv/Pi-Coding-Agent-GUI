# Pi PET Companion

Pi PET Companion is a built-in Pi GUI capability that turns Pi runtime activity into a small Electron desktop status pet. It is a GUI capability, not a Pi Agent core feature.

## What it shows

The PET is derived from existing Pi GUI state and WebSocket events:

- runtime lifecycle: sleeping, starting, running, stopped, crashed;
- active agent work: thinking/generating, tool execution, queued prompts;
- subagent work: active child-agent runs and a quick link to the subagent drawer;
- user attention: pending interactive prompt / extension UI requests;
- diagnostics: runtime errors, context pressure, background runtime activity.

## Interaction model

- The PET is a system-level Electron desktop companion window that stays outside the main GUI.
- It is always-on-top, transparent, draggable, and closeable from its own window.
- It supports selectable CodexPet bundles from bundled Pi GUI assets and `~/.codex/pets/<pet-id>/`.
- It renders standard 8×9 CodexPet spritesheets with `idle`, `running-right`, `running-left`, `waving`, `jumping`, `failed`, `waiting`, `running`, and `review` animations.
- It persists desktop-only PET preferences such as selected pet, scale, and window position under Electron user data.
- It is managed from Settings → 功能设置 → Pi PET Companion.
- The browser/web chat surface does not render a separate in-chat PET.

## Privacy and safety

The PET is intentionally UI-only:

- does not mutate `~/.pi`, provider config, wrappers, preloads, firewall rules, or external tools;
- does not change agent behavior;
- does not start Pi/runtime processes;
- does not expose raw thinking text, full file paths, tool arguments, or credentials.

The desktop companion uses an Electron always-on-top transparent window when the desktop shell is available. It mirrors a compact privacy-safe subset of the PET display payload from the GUI; it does not inspect Pi Agent directly.

It shows compact, privacy-safe status summaries such as “工具运行中: read” or “上下文占用 91%”. Runtime states map to CodexPet animations: busy work uses `running`, user attention uses `waiting`/`review`, failures use `failed`, and completion can play `waving` before returning to idle.

## CodexPet bundle format

Pi GUI discovers CodexPet bundles with this structure:

```text
~/.codex/pets/<pet-id>/
├── pet.json
└── spritesheet.webp
```

Manifest format:

```json
{
  "id": "my-pet",
  "displayName": "My Pet",
  "description": "Optional short description.",
  "spritesheetPath": "spritesheet.webp"
}
```

The spritesheet should be an 8-column by 9-row atlas. Rows are interpreted as:

| Row | Animation |
| --- | --- |
| 0 | `idle` |
| 1 | `running-right` |
| 2 | `running-left` |
| 3 | `waving` |
| 4 | `jumping` |
| 5 | `failed` |
| 6 | `waiting` |
| 7 | `running` |
| 8 | `review` |

## Capability classification

`pi-pet-companion` is registered as a Level 3 built-in Pi GUI capability:

- origin: built-in;
- implementation host: `pi-gui`;
- risk: `ui-only`;
- release stance: default-off;
- local runtime: supported;
- remote runtime: supported.

Vanilla Pi remains clean: PET is a GUI surface and does not inject tools or alter Pi runtime behavior.
