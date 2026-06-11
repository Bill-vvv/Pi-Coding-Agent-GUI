# Pi Coding Agent GUI

[English version](./README.md)

Pi Coding Agent GUI 是一个优先面向 WSL/本地开发环境的 Web 图形界面。

Pi Coding Agent GUI 提供基于浏览器的控制界面，用于管理本地 Pi RPC 运行时：项目管理、Session/Runtime 监督、对话展示、token/context 可视化、面向受信任设备的同局域网远程访问，以及可选的 [Pi PET Companion](./docs/pi-pet-companion.md) 运行状态宠物。

## 开发

安装依赖并启动开发环境：

```bash
npm install
npm run dev
```

打开终端中显示的 Vite 地址，通常是 `http://localhost:5173`。

后台重启前端和后端开发服务：

```bash
npm run dev:restart
```

并行开发建议使用隔离的 stable/dev 实例：

```bash
# 稳定 dogfood 实例：8787 + 5173，数据 .pi-gui
npm run dev:stable

# dev 实例：8877 + 5273，数据 .pi-gui-dev
npm run dev:dev
```

对应后台重启/状态查看命令：`npm run dev:stable:restart`、`npm run dev:dev:restart`、`npm run dev:stable:status`、`npm run dev:dev:status`。

桌面 GUI 开发也使用同样的隔离方式（Windows + WSL）：

```bash
# 同步 WSL 改动到 Windows Electron mirror，并重建 desktop
npm run sync:desktop-mirror

# stable：用于日常开发，8787 + 5173，数据 .pi-gui
npm run dev:desktop:stable

# dev：用于观察修订效果，8877 + 5273，数据 .pi-gui-dev
npm run dev:desktop:dev
```

如果 Windows mirror 不在默认路径，可设置 `PI_GUI_DESKTOP_MIRROR_DIR` 或传入 `-- --target <path>`。

常用检查命令：

```bash
npm test
npm run typecheck
npm run build
```

可选真实 Pi RPC 冒烟测试。该命令会在当前目录启动 `pi --mode rpc`，并只发送 `get_state`：

```bash
npm run smoke:pi-rpc
```

可通过 `PI_GUI_SMOKE_CWD=/path/to/project` 覆盖测试工作目录。

后端默认监听 `127.0.0.1:8787`，并暴露 WebSocket `/ws`。

## Android 同局域网远程访问

远程访问当前 MVP 中是可选功能，仅建议在受信任的本地网络使用。公网中继/隧道和 HTTPS 证书管理暂不在当前范围内。

1. 先构建 Web UI，后端才能直接托管它：

   ```bash
   npm run build -w @pi-gui/web
   ```

2. 在 GUI 中打开 Settings → Remote Access。
3. 启用 LAN access。设置和生成的应用 token 会保存在本地；修改监听 host 可能需要重启 Pi GUI server/app。
4. 重启后，后端会从同一个局域网 origin 提供已构建的 Web UI、`/api/*` 和 `/ws`。Remote Access 面板会显示候选局域网 URL，以及包含选中 URL 和 token 的二维码。
5. 如果后端运行在 WSL 内，面板会优先使用可用的 Windows 主机局域网地址，并可请求 Windows 管理员 PowerShell/UAC 来配置 `netsh portproxy` 和防火墙。复制命令仍作为备用方案保留。
6. 在 Android Chrome 上扫描二维码。token 会保存在该浏览器 origin 下，用于后续重连，直到你在 Remote Access 面板中轮换或清除它。

### 安全说明

- LAN remote mode 在 MVP 阶段使用 HTTP + token；请仅在受信任的 Wi‑Fi/以太网中使用。
- 任何持有二维码/token 的人都可以控制项目、运行时、路径浏览和文件上传，直到 token 被轮换或清除。
- 现有 desktop/production local mode 默认仍只绑定 loopback。

### 运维与开发环境变量

- `PI_GUI_MODE=remote-lan` 显式启动远程局域网模式。
- `PI_GUI_HOST=0.0.0.0` 或局域网 IP 用于控制 remote LAN mode 的监听 host。
- `PI_GUI_AUTH_TOKEN=<token>` 可提供由环境变量管理的 token；否则启用 GUI Remote Access 后使用本地持久化 token。
- `PI_GUI_SERVE_WEB=1` 会让后端托管 `apps/web/dist`，用于本地冒烟测试。
- `PI_GUI_WEB_DIST=/path/to/dist` 可覆盖已构建 Web UI 的目录。

## 架构

- `apps/server`：Fastify 编排层、SQLite 状态、Pi RPC runtime supervisor。
- `apps/web`：React + Vite 前端 UI。
- `packages/shared`：共享领域类型和 WebSocket 协议类型。

服务端通过 `pi --mode rpc` 集成 Pi，并将 stdout 视为严格的 LF 分隔 JSONL。
