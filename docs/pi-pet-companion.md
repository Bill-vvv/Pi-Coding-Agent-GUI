# Pi PET Companion

Pi PET Companion is a built-in Pi GUI capability that turns Pi runtime activity into a small native status pet. It is a GUI capability, not a Pi Agent core feature.

## What it shows

The PET is derived from existing Pi GUI state and WebSocket events:

- runtime lifecycle: sleeping, starting, running, stopped, crashed;
- active agent work: thinking/generating, tool execution, queued prompts;
- subagent work: active child-agent runs and a quick link to the subagent drawer;
- user attention: pending interactive prompt / extension UI requests;
- diagnostics: runtime errors, context pressure, background runtime activity.

## Interaction model

- The PET floats inside the main chat surface and stays above the composer reserved area.
- It can be collapsed or hidden.
- On the Electron desktop shell, it can also be opened as a system-level desktop companion window that stays outside the main GUI.
- It is managed from Settings → Integrations / Temporary Shims → Capabilities → Pi PET Companion.
- When relevant, it can open runtime logs, the active subagent detail view, the usage overview for high context pressure, or a background runtime that needs attention.
- Screen-reader live announcements are limited to attention/danger states so normal thinking/tool animation does not become noisy.

## Privacy and safety

The PET is intentionally UI-only:

- does not mutate `~/.pi`, provider config, wrappers, preloads, firewall rules, or external tools;
- does not change agent behavior;
- does not start Pi/runtime processes;
- does not expose raw thinking text, full file paths, tool arguments, or credentials.

The system-level desktop companion uses an Electron always-on-top transparent window when the desktop shell is available. It mirrors the same privacy-safe PET display payload from the GUI; it does not inspect Pi Agent directly.

It shows compact, privacy-safe status summaries such as “工具运行中: read” or “上下文占用 91%”.

## Capability classification

`pi-pet-companion` is registered as a Level 3 built-in Pi GUI capability:

- origin: built-in;
- implementation host: `pi-gui`;
- risk: `ui-only`;
- release stance: default-on in enhanced profiles;
- local runtime: supported;
- remote runtime: supported.

Vanilla Pi remains clean: PET is a GUI surface and does not inject tools or alter Pi runtime behavior.
