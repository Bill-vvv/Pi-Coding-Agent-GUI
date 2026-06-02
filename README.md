# Pi GUI

WSL-first Web GUI skeleton for Pi coding Agent.

## Development

```bash
npm install
npm run dev
```

Open the Vite URL shown in the terminal, usually `http://localhost:5173`.

Backend binds to `127.0.0.1:8787` by default and exposes WebSocket `/ws`.

## Architecture

- `apps/server`: Fastify orchestrator, SQLite state, Pi RPC runtime supervisor.
- `apps/web`: React + Vite UI.
- `packages/shared`: shared domain and WebSocket protocol types.

The server integrates Pi through `pi --mode rpc` and treats stdout as strict LF-delimited JSONL.
