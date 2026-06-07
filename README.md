# Pi Coding Agent GUI

A WSL-first Web GUI for Pi Coding Agent.

Pi Coding Agent GUI provides a browser-based control surface for local Pi RPC runtimes: project management, session/runtime supervision, conversation display, token/context visibility, voice-input experiments, and same-LAN remote access for trusted devices.

中文：Pi Coding Agent GUI 是一个优先面向 WSL/本地开发环境的 Web 图形界面，用于管理 Pi Coding Agent 的 RPC 运行时、项目、会话、对话、上下文/token 信息、语音输入实验，以及受信任局域网设备的远程访问。

## Development / 开发

Install dependencies and start the dev server:

```bash
npm install
npm run dev
```

中文：安装依赖并启动开发环境：

```bash
npm install
npm run dev
```

Open the Vite URL shown in the terminal, usually `http://localhost:5173`.

中文：打开终端中显示的 Vite 地址，通常是 `http://localhost:5173`。

Useful checks:

```bash
npm test
npm run typecheck
npm run build
```

中文：常用检查命令：

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

中文：可选真实 Pi RPC 冒烟测试。该命令会在当前目录启动 `pi --mode rpc`，并只发送 `get_state`：

```bash
npm run smoke:pi-rpc
```

可通过 `PI_GUI_SMOKE_CWD=/path/to/project` 覆盖测试工作目录。

The backend binds to `127.0.0.1:8787` by default and exposes WebSocket `/ws`.

中文：后端默认监听 `127.0.0.1:8787`，并暴露 WebSocket `/ws`。

## Android same-LAN remote access / Android 同局域网远程访问

Remote access is opt-in and intended only for trusted local networks in the current MVP. Public internet relay/tunnel and HTTPS certificate management are deferred.

中文：远程访问当前 MVP 中是可选功能，仅建议在受信任的本地网络使用。公网中继/隧道和 HTTPS 证书管理暂不在当前范围内。

1. Build the web UI before serving it from the backend:

   ```bash
   npm run build -w @pi-gui/web
   ```

   中文：先构建 Web UI，后端才能直接托管它：

   ```bash
   npm run build -w @pi-gui/web
   ```

2. Open Settings → Remote Access in the GUI.

   中文：在 GUI 中打开 Settings → Remote Access。

3. Enable LAN access. The setting and generated app token are persisted locally; changing the listen host may require restarting the Pi GUI server/app.

   中文：启用 LAN access。设置和生成的应用 token 会保存在本地；修改监听 host 可能需要重启 Pi GUI server/app。

4. After restart, the backend serves the built web UI, `/api/*`, and `/ws` from the same LAN origin. The Remote Access panel shows candidate LAN URLs and a QR code containing the selected URL plus token.

   中文：重启后，后端会从同一个局域网 origin 提供已构建的 Web UI、`/api/*` 和 `/ws`。Remote Access 面板会显示候选局域网 URL，以及包含选中 URL 和 token 的二维码。

5. If the backend is running inside WSL, the panel prefers Windows host LAN addresses when available and can request Windows Admin PowerShell/UAC setup for `netsh portproxy` plus firewall. Copyable commands remain available as a fallback.

   中文：如果后端运行在 WSL 内，面板会优先使用可用的 Windows 主机局域网地址，并可请求 Windows 管理员 PowerShell/UAC 来配置 `netsh portproxy` 和防火墙。复制命令仍作为备用方案保留。

6. Scan the QR code on Android Chrome. The token is saved in that browser origin for future reconnects until you rotate or clear it from the Remote Access panel.

   中文：在 Android Chrome 上扫描二维码。token 会保存在该浏览器 origin 下，用于后续重连，直到你在 Remote Access 面板中轮换或清除它。

### Security notes / 安全说明

- LAN remote mode uses HTTP + token for MVP; use it only on trusted Wi‑Fi/ethernet.
- Anyone with the QR/token can control projects, runtimes, path browsing, and file upload until the token is rotated or cleared.
- Existing desktop/production local mode remains loopback-only by default.

中文：

- LAN remote mode 在 MVP 阶段使用 HTTP + token；请仅在受信任的 Wi‑Fi/以太网中使用。
- 任何持有二维码/token 的人都可以控制项目、运行时、路径浏览和文件上传，直到 token 被轮换或清除。
- 现有 desktop/production local mode 默认仍只绑定 loopback。

### Operator/dev environment controls / 运维与开发环境变量

- `PI_GUI_MODE=remote-lan` explicitly starts remote LAN mode.
- `PI_GUI_HOST=0.0.0.0` or a LAN IP controls the listen host in remote LAN mode.
- `PI_GUI_AUTH_TOKEN=<token>` can supply an env-managed token; otherwise the persisted Remote Access token is used after enabling in the GUI.
- `PI_GUI_SERVE_WEB=1` serves `apps/web/dist` from the backend for local smoke tests.
- `PI_GUI_WEB_DIST=/path/to/dist` overrides the built web UI directory.

中文：

- `PI_GUI_MODE=remote-lan` 显式启动远程局域网模式。
- `PI_GUI_HOST=0.0.0.0` 或局域网 IP 用于控制 remote LAN mode 的监听 host。
- `PI_GUI_AUTH_TOKEN=<token>` 可提供由环境变量管理的 token；否则启用 GUI Remote Access 后使用本地持久化 token。
- `PI_GUI_SERVE_WEB=1` 会让后端托管 `apps/web/dist`，用于本地冒烟测试。
- `PI_GUI_WEB_DIST=/path/to/dist` 可覆盖已构建 Web UI 的目录。

## Architecture / 架构

- `apps/server`: Fastify orchestrator, SQLite state, Pi RPC runtime supervisor.
- `apps/web`: React + Vite UI.
- `packages/shared`: shared domain and WebSocket protocol types.

中文：

- `apps/server`：Fastify 编排层、SQLite 状态、Pi RPC runtime supervisor。
- `apps/web`：React + Vite 前端 UI。
- `packages/shared`：共享领域类型和 WebSocket 协议类型。

The server integrates Pi through `pi --mode rpc` and treats stdout as strict LF-delimited JSONL.

中文：服务端通过 `pi --mode rpc` 集成 Pi，并将 stdout 视为严格的 LF 分隔 JSONL。
