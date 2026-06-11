# Desktop MVP Validation Checklist

This checklist complements [`desktop-electron-plan.md`](./desktop-electron-plan.md). It validates the WSL-hosted backend, reused web UI, and current Electron shell surfaces.

## Default local validation

Run before completing desktop MVP hardening tasks:

```bash
npm run typecheck
npm test
npm run build
```

`npm test` runs release-safety plus backend, frontend, and desktop package tests. It does not require Pi to be installed.

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

## Electron shell MVP validation

`apps/desktop` implements the first Windows desktop host bridge MVP. The default script host remains WSL for compatibility with the current Windows-side mirror flow. When Electron is launched without an explicit host env, it shows a startup host chooser for WSL vs Windows native. Run on Windows with WSL available:

```bash
npm run dev:desktop
```

To run the backend and Pi from Windows native instead of WSL, explicitly select the Windows host.

PowerShell:

```powershell
$env:PI_GUI_DESKTOP_HOST = "windows"
npm run dev:desktop
```

CMD:

```cmd
set PI_GUI_DESKTOP_HOST=windows
npm run dev:desktop
```

Windows host requires Windows-side backend dependencies, including native modules such as `better-sqlite3`, and a Windows-side `pi` executable/config. The mirror sync copies `apps/server` source, but a selective mirror that installed only `@pi-gui/shared`, `@pi-gui/web`, and `@pi-gui/desktop` is enough for WSL host only; Windows host also needs `@pi-gui/server` dependencies installed on Windows.

For isolated desktop GUI development, mirror the web stable/dev split. When using a Windows-side Electron mirror, sync WSL changes first:

```bash
npm run sync:desktop-mirror

# stable: ongoing development, backend 8787, web 5173, data apps/server/.pi-gui-stable
npm run dev:desktop:stable

# dev: observe revision effects, backend 8877, web 5273, data apps/server/.pi-gui-dev
npm run dev:desktop:dev
```

`sync:desktop-mirror` defaults to `/mnt/c/Users/ceshi/pi-gui-desktop`; override with `PI_GUI_DESKTOP_MIRROR_DIR` or `-- --target <path>`. Use `-- --no-build` to skip the Windows-side desktop build.

For a built/local run without the Vite dev server:

```bash
npm run start:desktop
```

Preferred dev layout is a Windows-side desktop checkout plus the WSL checkout that owns backend/Pi state:

```text
C:\Users\<user>\pi-gui-desktop        # Windows-side Electron launcher/workspace
/home/<user>/projects/pi-gui              # WSL backend/Pi workspace
```

Create `.pi-gui-desktop.local.json` in the Windows checkout to point at the WSL workspace:

```json
{
  "wslCwd": "/home/user/projects/pi-gui",
  "wslDistro": "Ubuntu"
}
```

Install only the Windows-side desktop/web/shared workspaces, not the WSL backend native dependencies:

```bash
npm install -w @pi-gui/shared -w @pi-gui/web -w @pi-gui/desktop --include-workspace-root=false
```

When running directly from a WSL checkout exposed as `\\wsl.localhost\<Distro>\...`, the desktop launcher detects the distro and WSL cwd automatically, runs repo commands inside WSL, and launches Windows Electron through `npx`. No Windows drive mapping is required. The default desktop GUI database now stays under `apps/server/.pi-gui`; if an older `apps/server/.pi-gui-desktop` database exists, the server imports its projects and sessions into the canonical database on startup.

Validate:

- When no explicit host is supplied to Electron, the startup host chooser lets the user pick WSL or Windows native.
- Electron BrowserWindow first shows the startup status page, then loads the existing React UI from the Vite dev server.
- On Windows 10, Electron uses transparent-window clipping for rounded outer corners; on Windows 11, Electron uses native rounded corners. Set `PI_GUI_DESKTOP_TRANSPARENT_WINDOW=1` or `0` to force the compatibility mode on or off for debugging.
- Electron launches the selected backend host with `PI_GUI_MODE=desktop`, loopback host, a controlled local port, and a generated token.
- With the default WSL host, Electron launches backend through `wsl.exe`.
- With `PI_GUI_DESKTOP_HOST=windows`, Electron launches backend directly from the Windows checkout and does not require `PI_GUI_DESKTOP_WSL_CWD`.
- Projects, runtimes, and sessions created through a desktop host carry execution-host metadata so archived sessions can show whether they belong to WSL or Windows native.
- Archived sessions from a different host are not resumed by the active backend; the UI shows a switch-host hint and the backend rejects mismatched `session.resume` requests.
- Electron waits for `/health` before loading the UI.
- The renderer receives `apiBaseUrl`, `wsUrl`, and `authToken` through `window.__PI_GUI_CONFIG__`.
- The frontend connects to WebSocket and receives `hello`.
- Backend stdout/stderr are captured in the Electron logs directory (`backend.log`).
- Closing Electron terminates the backend process it launched best-effort.
- Non-Windows runs show an unsupported-platform message for this MVP.

Windows installer, code signing, auto-update, and crash-report packaging are validated in a later release task.
