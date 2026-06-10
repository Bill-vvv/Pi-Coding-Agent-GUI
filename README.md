# Pi Coding Agent GUI

[中文版本](./README.zh-CN.md)

A WSL-first Web GUI for Pi Coding Agent.

Pi Coding Agent GUI provides a browser-based control surface for local Pi RPC runtimes: project management, session/runtime supervision, conversation display, token/context visibility, same-LAN remote access for trusted devices, and an optional [Pi PET Companion](./docs/pi-pet-companion.md) that visualizes live runtime activity.

## Development

Install dependencies and start the dev server:

```bash
npm install
npm run dev
```

Open the Vite URL shown in the terminal, usually `http://localhost:5173`.

Restart both frontend and backend dev servers in the background:

```bash
npm run dev:restart
```

For side-by-side development, use isolated stable/dev instances:

```bash
# Stable dogfood instance: 8787 + 5173, data .pi-gui-stable
npm run dev:stable

# Feature sandbox instance: 8877 + 5273, data .pi-gui-dev
npm run dev:sandbox
```

Background restart/status helpers are also available: `npm run dev:stable:restart`, `npm run dev:sandbox:restart`, `npm run dev:stable:status`, and `npm run dev:sandbox:status`.

Desktop GUI development mirrors the same split on Windows + WSL:

```bash
# Sync WSL changes into the Windows Electron mirror and rebuild desktop
npm run sync:desktop-mirror

# Stable instance for ongoing development: 8787 + 5173, data .pi-gui-stable
npm run dev:desktop:stable

# Dev instance for observing revision effects: 8877 + 5273, data .pi-gui-dev
npm run dev:desktop:dev
```

Set `PI_GUI_DESKTOP_MIRROR_DIR` or pass `-- --target <path>` if the Windows mirror is not at the default path.

Useful checks:

```bash
npm test
npm run typecheck
npm run build
```

Optional real Pi RPC smoke test. It starts `pi --mode rpc` in the current directory and sends `get_state` only:

```bash
npm run smoke:pi-rpc
```

You can override the working directory with `PI_GUI_SMOKE_CWD=/path/to/project`.

The backend binds to `127.0.0.1:8787` by default and exposes WebSocket `/ws`.

## Android same-LAN remote access

Remote access is opt-in and intended only for trusted local networks in the current MVP. Public internet relay/tunnel and HTTPS certificate management are deferred.

1. Build the web UI before serving it from the backend:

   ```bash
   npm run build -w @pi-gui/web
   ```

2. Open Settings → Remote Access in the GUI.
3. Enable LAN access. The setting and generated app token are persisted locally; changing the listen host may require restarting the Pi GUI server/app.
4. After restart, the backend serves the built web UI, `/api/*`, and `/ws` from the same LAN origin. The Remote Access panel shows candidate LAN URLs and a QR code containing the selected URL plus token.
5. If the backend is running inside WSL, the panel prefers Windows host LAN addresses when available and can request Windows Admin PowerShell/UAC setup for `netsh portproxy` plus firewall. Copyable commands remain available as a fallback.
6. Scan the QR code on Android Chrome. The token is saved in that browser origin for future reconnects until you rotate or clear it from the Remote Access panel.

### Security notes

- LAN remote mode uses HTTP + token for MVP; use it only on trusted Wi‑Fi/ethernet.
- Anyone with the QR/token can control projects, runtimes, path browsing, and file upload until the token is rotated or cleared.
- Existing desktop/production local mode remains loopback-only by default.

### Operator/dev environment controls

- `PI_GUI_MODE=remote-lan` explicitly starts remote LAN mode.
- `PI_GUI_HOST=0.0.0.0` or a LAN IP controls the listen host in remote LAN mode.
- `PI_GUI_AUTH_TOKEN=<token>` can supply an env-managed token; otherwise the persisted Remote Access token is used after enabling in the GUI.
- `PI_GUI_SERVE_WEB=1` serves `apps/web/dist` from the backend for local smoke tests.
- `PI_GUI_WEB_DIST=/path/to/dist` overrides the built web UI directory.

## Architecture

- `apps/server`: Fastify orchestrator, SQLite state, Pi RPC runtime supervisor.
- `apps/web`: React + Vite UI.
- `packages/shared`: shared domain and WebSocket protocol types.

The server integrates Pi through `pi --mode rpc` and treats stdout as strict LF-delimited JSONL.
