# Desktop MVP Validation Checklist

This checklist complements [`desktop-electron-plan.md`](./desktop-electron-plan.md). It validates the existing WSL-hosted backend and web UI surfaces that the future Electron shell will reuse.

## Default local validation

Run before completing desktop MVP hardening tasks:

```bash
npm run typecheck
npm test
npm run build
```

`npm test` runs both backend and frontend package tests. It does not require Pi to be installed.

## Optional real Pi RPC smoke

Run only on a local machine where `pi` is installed and it is safe to start a short-lived RPC process:

```bash
npm run smoke:pi-rpc
```

You may override the working directory:

```bash
PI_GUI_SMOKE_CWD=/path/to/project npm run smoke:pi-rpc
```

This smoke check is intentionally not part of default CI because hosted CI environments may not have Pi installed.

## Browser/dev validation

1. Start the dev stack:

   ```bash
   npm run dev
   ```

2. Open the Vite URL shown in the terminal.
3. Confirm the app connects to the backend and receives initial `hello` state.
4. Add/select a WSL project directory.
5. Start, stop, resume, and restart a runtime when Pi is available.
6. Refresh the browser and confirm reconnect does not stop backend runtimes.

## Environment diagnostics

From Settings, open the environment diagnostics surface and verify:

- backend platform, Node, npm, host, and port are shown;
- WSL status, distro, and interop are shown;
- Pi path/version and Pi RPC smoke status are shown when available;
- missing WSL/Pi/RPC failures show remediation guidance;
- diagnostics can refresh without starting a normal Pi session.

## Path conversion scenarios

Validate project path selection with:

- existing Linux/WSL absolute paths such as `/home/user/project`;
- existing `/mnt/c/...` paths;
- Windows drive paths such as `C:\Users\user\project` or `C:/Users/user/project` when running in WSL;
- WSL UNC paths for the current distro, such as `\\wsl.localhost\Distro\home\user\project` and `\\wsl$\Distro\home\user\project`;
- mismatched distro UNC paths, relative paths, and `~` paths show clear errors.

Confirm stored projects use the resolved backend-visible WSL `cwd`.

## Token-protected local connection

When running the backend with `PI_GUI_AUTH_TOKEN` configured:

- `/health` remains public and minimal;
- protected `/api/*` requests reject missing or invalid tokens;
- WebSocket `/ws` rejects missing or invalid tokens before sending `hello`;
- the frontend connects when supplied the same token through runtime config;
- token values are not visible in reducer state or normal logs.

When `PI_GUI_AUTH_TOKEN` is unset in development, the existing browser flow should continue to work.

## Runtime crash logs and recovery

For a stopped or crashed runtime, verify the runtime log/recovery surface shows:

- runtime metadata: status, cwd, pid/session/model details when available;
- recent diagnostic events from `runtime_status`, `stderr`, and `error` kinds;
- crash summary derived from recent diagnostic events;
- copy logs action copies only the displayed sanitized log set;
- recovery actions reuse existing runtime controls: resume, restart, stop, and archive.

Confirm ordinary reconnect/event replay behavior remains unchanged.

## Future Electron shell validation placeholder

These checks are intentionally placeholders until `apps/desktop` exists:

- Electron BrowserWindow loads the existing web build.
- Electron launches the WSL backend with a controlled local port and token.
- Electron waits for `/health` before showing the main UI.
- Electron injects backend URL and token into frontend runtime config.
- Electron captures backend stdout/stderr to desktop logs.
- Closing Electron handles backend lifecycle explicitly.
- Windows installer, code signing, auto-update, and crash-report packaging are validated in a later release task.
