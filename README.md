# Pi GUI

WSL-first Web GUI skeleton for Pi coding Agent.

## Development

```bash
npm install
npm run dev
```

Open the Vite URL shown in the terminal, usually `http://localhost:5173`.

Useful checks:

```bash
npm test
npm run typecheck
npm run build
```

Optional real Pi RPC smoke test, which starts `pi --mode rpc` in the current directory and sends `get_state` only:

```bash
npm run smoke:pi-rpc
```

You can override the working directory with `PI_GUI_SMOKE_CWD=/path/to/project`.

Backend binds to `127.0.0.1:8787` by default and exposes WebSocket `/ws`.

## Architecture

- `apps/server`: Fastify orchestrator, SQLite state, Pi RPC runtime supervisor.
- `apps/web`: React + Vite UI.
- `packages/shared`: shared domain and WebSocket protocol types.

The server integrates Pi through `pi --mode rpc` and treats stdout as strict LF-delimited JSONL.
