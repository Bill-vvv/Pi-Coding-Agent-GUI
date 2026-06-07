import { randomBytes } from "node:crypto";
import { isIP } from "node:net";
import type { RemoteAccessCandidateUrl, RemoteAccessPairingInfo, RemoteAccessSetupHint, RemoteAccessStatus, RemoteAccessUpdateRequest, RemoteAccessUpdateResponse, RemoteAccessWindowsPortProxyResponse } from "@pi-gui/shared";
import type { AppDatabase } from "../db.js";
import { isLoopbackHost } from "./hostUtils.js";
import { isWslEnvironment, listLanCandidateUrls } from "./lanAddressService.js";
import { launchWindowsPortProxySetup, type WindowsPortProxyRequest } from "./windowsPortProxyService.js";
import type { ServerRuntimeConfig } from "./serverConfig.js";

const ENABLED_KEY = "remoteAccess.enabled";
const TOKEN_KEY = "remoteAccess.token";
const SELECTED_HOST_KEY = "remoteAccess.selectedHost";

const TRUSTED_LAN_WARNINGS = [
  "仅在可信局域网内使用 Remote Access；MVP 不提供公网/TLS 保护。",
  "任何拿到二维码或 token 的设备都可以控制 Pi GUI、项目路径、运行时命令和文件上传，直到你轮换或清除 token。",
];

export type PersistedRemoteAccessConfig = {
  enabled: boolean;
  authToken?: string;
};

export type RemoteAccessServiceDependencies = {
  listLanCandidateUrls?: typeof listLanCandidateUrls;
  isWslEnvironment?: typeof isWslEnvironment;
  launchWindowsPortProxySetup?: (request: WindowsPortProxyRequest) => Promise<void>;
};

export class RemoteAccessService {
  constructor(
    private readonly db: AppDatabase,
    private readonly serverConfig: ServerRuntimeConfig,
    private readonly dependencies: RemoteAccessServiceDependencies = {},
  ) {}

  getPersistedConfig(): PersistedRemoteAccessConfig {
    return readPersistedRemoteAccessConfig(this.db);
  }

  getStatus(): RemoteAccessStatus {
    return buildRemoteAccessStatus(this.db, this.serverConfig, this.dependencies);
  }

  getPairingInfo(status = this.getStatus()): RemoteAccessPairingInfo {
    const token = pairingToken(this.db, this.serverConfig);
    return {
      status,
      token,
      pairingUrl: pairingUrlForStatus(status, token),
      warnings: TRUSTED_LAN_WARNINGS,
    };
  }

  windowsPortProxySetupAuthToken(): string | undefined {
    const status = this.getStatus();
    if (!status.enabled && !status.active) return undefined;
    return this.serverConfig.authTokenSource === "env" ? this.serverConfig.authToken : this.db.getSettingValue(TOKEN_KEY)?.trim() || undefined;
  }

  async configureWindowsPortProxy(): Promise<RemoteAccessWindowsPortProxyResponse> {
    const status = this.getStatus();
    if (status.networkEnvironment !== "wsl") throw new Error("Windows port forwarding is only available when Pi GUI server is running inside WSL");
    if (!status.active || status.restartRequired) throw new Error("请先重启 Pi GUI 服务，让 Remote Access 以 LAN 模式监听后再配置 Windows 转发。");
    const targetHost = portProxyTargetHost(status.candidateUrls);
    if (!targetHost) throw new Error("No WSL IPv4 address is available for Windows port forwarding");
    const launch = this.dependencies.launchWindowsPortProxySetup ?? launchWindowsPortProxySetup;
    await launch({ listenPort: this.serverConfig.port, connectAddress: targetHost });
    const nextStatus = this.getStatus();
    const phoneUrl = windowsHostPhoneUrl(nextStatus);
    return {
      accepted: true,
      status: nextStatus,
      targetHost,
      listenPort: this.serverConfig.port,
      requiresAdmin: true,
      message: phoneUrl
        ? `Windows 转发和防火墙已配置；请在手机上重新访问 ${phoneUrl}。`
        : "Windows 转发和防火墙已配置；但未自动检测到 Windows 主机 IP，请在手机上使用电脑的局域网 IP 重新访问。",
    };
  }

  update(request: RemoteAccessUpdateRequest): RemoteAccessUpdateResponse {
    validateRemoteAccessUpdate(request);
    if (request.clearToken) {
      this.db.setSettingValue(TOKEN_KEY, undefined);
      this.db.setSettingValue(ENABLED_KEY, undefined);
    }
    if (request.selectedHost !== undefined) {
      this.db.setSettingValue(SELECTED_HOST_KEY, request.selectedHost.trim() || undefined);
    }
    if (request.rotateToken && this.serverConfig.authTokenSource !== "env") {
      this.db.setSettingValue(TOKEN_KEY, generateRemoteAccessToken());
    }
    if (request.enabled !== undefined) {
      if (request.enabled) ensureToken(this.db);
      this.db.setSettingValue(ENABLED_KEY, request.enabled ? "true" : undefined);
    }

    const status = this.getStatus();
    const token = status.tokenConfigured ? pairingToken(this.db, this.serverConfig) : undefined;
    return {
      status,
      pairing: token ? { status, token, pairingUrl: pairingUrlForStatus(status, token), warnings: TRUSTED_LAN_WARNINGS } : undefined,
    };
  }
}

export function readPersistedRemoteAccessConfig(db: AppDatabase): PersistedRemoteAccessConfig {
  const enabled = db.getSettingValue(ENABLED_KEY) === "true";
  const authToken = db.getSettingValue(TOKEN_KEY)?.trim() || undefined;
  return { enabled, authToken };
}

export function remoteAccessAuthToken(db: AppDatabase, config: ServerRuntimeConfig): string | undefined {
  if (!config.remoteLan) return config.authToken;
  if (config.authTokenSource === "env") return config.authToken;
  return db.getSettingValue(TOKEN_KEY)?.trim() || undefined;
}

function buildRemoteAccessStatus(db: AppDatabase, config: ServerRuntimeConfig, dependencies: RemoteAccessServiceDependencies = {}): RemoteAccessStatus {
  const enabled = db.getSettingValue(ENABLED_KEY) === "true";
  const persistedToken = db.getSettingValue(TOKEN_KEY)?.trim() || undefined;
  const selectedHost = db.getSettingValue(SELECTED_HOST_KEY)?.trim() || undefined;
  const candidateUrls = (dependencies.listLanCandidateUrls ?? listLanCandidateUrls)({ port: config.port, selectedHost });
  const selectedCandidate = selectedHost ? candidateUrls.find((candidate) => candidate.host === selectedHost) : undefined;
  const recommendedCandidate = candidateUrls.find((candidate) => candidate.recommended) ?? candidateUrls[0];
  const selectedUrl = selectedCandidate?.url ?? (selectedHost ? `http://${selectedHost}:${config.port}/` : undefined);
  const active = !isLoopbackHost(config.host) && config.authRequired;
  const restartRequired = enabled !== active;
  const statusToken = config.authTokenSource === "env" ? config.authToken : persistedToken;
  const networkEnvironment = (dependencies.isWslEnvironment ?? isWslEnvironment)() ? "wsl" : "native";
  return {
    enabled,
    active,
    restartRequired,
    mode: active || enabled || config.remoteLan ? "remote-lan" : "local",
    bindHost: config.host,
    port: config.port,
    selectedHost,
    selectedUrl,
    recommendedUrl: recommendedCandidate?.url,
    candidateUrls,
    tokenConfigured: Boolean(statusToken),
    tokenPreview: previewToken(statusToken),
    tokenSource: config.authTokenSource === "env" ? "env" : persistedToken ? "persisted" : undefined,
    networkEnvironment,
    setupHints: buildSetupHints({ config, enabled, active, restartRequired, candidateUrls, networkEnvironment }),
  };
}

type SetupHintInput = {
  config: ServerRuntimeConfig;
  enabled: boolean;
  active: boolean;
  restartRequired: boolean;
  candidateUrls: RemoteAccessCandidateUrl[];
  networkEnvironment: "native" | "wsl";
};

function buildSetupHints({ config, enabled, active, restartRequired, candidateUrls, networkEnvironment }: SetupHintInput): RemoteAccessSetupHint[] {
  const hints: RemoteAccessSetupHint[] = [];
  if (candidateUrls.length === 0) {
    hints.push({
      code: "no_lan_candidates",
      severity: "warning",
      message: "未检测到可用于手机访问的私有 IPv4 地址。",
      remediation: "请确认电脑已连接 Wi‑Fi/以太网，或检查 VPN/虚拟网卡是否隐藏了真实 LAN 地址。",
    });
  }

  if (enabled && restartRequired) {
    hints.push({
      code: "restart_required",
      severity: "warning",
      message: "Remote Access 已保存，但当前 Pi GUI server 还没有以 LAN 模式监听。",
      detail: `当前监听地址：${config.host}:${config.port}`,
      remediation: "点击“立即重启服务”后生效；重启期间页面可能短暂断开并自动重连。",
    });
  }

  if (enabled && isLoopbackHost(config.host)) {
    hints.push({
      code: "bind_loopback",
      severity: "warning",
      message: "当前 server 仍绑定在 loopback，手机无法直接访问。",
      remediation: "以 remote-lan 模式重启，或设置 PI_GUI_MODE=remote-lan 与 PI_GUI_HOST=0.0.0.0。",
      commands: [
        {
          label: "Remote LAN 启动命令",
          platform: "shell",
          command: `PI_GUI_MODE=remote-lan PI_GUI_HOST=0.0.0.0 PORT=${config.port} PI_GUI_SERVE_WEB=1 npm run start -w @pi-gui/server`,
        },
      ],
    });
  }

  if (networkEnvironment === "wsl") {
    const wslCandidate = candidateUrls.find((candidate) => candidate.source === "windows-host" && candidate.requiresPortProxy);
    const targetHost = portProxyTargetHost(candidateUrls);
    const commands = targetHost ? windowsPortProxyCommands({ listenPort: config.port, targetHost }) : undefined;
    hints.push({
      code: "wsl_portproxy_required",
      severity: active ? "warning" : "info",
      message: "检测到 WSL：手机通常不能直接访问 WSL NAT 地址。",
      detail: wslCandidate
        ? `推荐手机访问 Windows 主机地址 ${wslCandidate.url}${targetHost ? `，并转发到 WSL ${targetHost}:${config.port}` : "。"}`
        : `${targetHost ? `WSL 当前地址为 ${targetHost}:${config.port}。` : ""}请使用 Windows 主机的局域网 IP 作为手机 URL。`,
      remediation: "如果扫码后打不开，请在 Windows 管理员 PowerShell 中添加端口转发和防火墙放行，然后重新访问/扫码。",
      commands,
    });
    hints.push({
      code: "windows_firewall_required",
      severity: "info",
      message: "Windows 防火墙或路由器 AP 隔离也可能阻止手机访问。",
      remediation: "确保手机和电脑在同一局域网，关闭访客网络/AP 隔离，并允许该端口入站 TCP。",
    });
  }

  return hints;
}

function portProxyTargetHost(candidateUrls: RemoteAccessCandidateUrl[]): string | undefined {
  return candidateUrls.find((candidate) => candidate.source === "server-interface" && !isLikelyBridgeInterface(candidate.interfaceName))?.host
    ?? candidateUrls.find((candidate) => candidate.source === "server-interface")?.host;
}

function isLikelyBridgeInterface(interfaceName: string | undefined): boolean {
  return /^(docker|br-|veth|tun|tap|tailscale|zt|wg)/i.test(interfaceName ?? "");
}

function windowsPortProxyCommands({ listenPort, targetHost }: { listenPort: number; targetHost: string }): RemoteAccessSetupHint["commands"] {
  return [
    {
      label: "添加端口转发（管理员 PowerShell）",
      platform: "windows-powershell",
      requiresAdmin: true,
      command: `netsh interface portproxy add v4tov4 listenaddress=0.0.0.0 listenport=${listenPort} connectaddress=${targetHost} connectport=${listenPort}`,
    },
    {
      label: "放行 Windows 防火墙（管理员 PowerShell）",
      platform: "windows-powershell",
      requiresAdmin: true,
      command: `New-NetFirewallRule -DisplayName "Pi GUI Remote LAN ${listenPort}" -Direction Inbound -Action Allow -Protocol TCP -LocalPort ${listenPort}`,
    },
    {
      label: "查看已有端口转发",
      platform: "windows-powershell",
      command: "netsh interface portproxy show v4tov4",
    },
  ];
}

function pairingToken(db: AppDatabase, config: ServerRuntimeConfig): string {
  if (config.authTokenSource === "env" && config.authToken) return config.authToken;
  return ensureToken(db);
}

function ensureToken(db: AppDatabase): string {
  const existing = db.getSettingValue(TOKEN_KEY)?.trim();
  if (existing) return existing;
  const token = generateRemoteAccessToken();
  db.setSettingValue(TOKEN_KEY, token);
  return token;
}

function generateRemoteAccessToken(): string {
  return randomBytes(32).toString("base64url");
}

function pairingUrlForStatus(status: RemoteAccessStatus, token: string): string {
  const baseUrl = pairingBaseUrlForStatus(status);
  const url = new URL(baseUrl);
  url.hash = `token=${encodeURIComponent(token)}`;
  return url.toString();
}

function pairingBaseUrlForStatus(status: RemoteAccessStatus): string {
  if (status.networkEnvironment === "wsl") return windowsHostPhoneUrl(status) ?? `http://127.0.0.1:${status.port}/`;
  return status.selectedUrl ?? status.recommendedUrl ?? `http://127.0.0.1:${status.port}/`;
}

function windowsHostPhoneUrl(status: RemoteAccessStatus): string | undefined {
  return status.candidateUrls.find((candidate) => candidate.source === "windows-host" && candidate.recommended)?.url
    ?? status.candidateUrls.find((candidate) => candidate.source === "windows-host")?.url;
}

function validateRemoteAccessUpdate(request: RemoteAccessUpdateRequest): void {
  if (request.enabled !== undefined && typeof request.enabled !== "boolean") throw new Error("remote access enabled must be a boolean");
  if (request.rotateToken !== undefined && typeof request.rotateToken !== "boolean") throw new Error("remote access rotateToken must be a boolean");
  if (request.clearToken !== undefined && typeof request.clearToken !== "boolean") throw new Error("remote access clearToken must be a boolean");
  if (request.selectedHost !== undefined) {
    if (typeof request.selectedHost !== "string") throw new Error("remote access selectedHost must be a string");
    const selectedHost = request.selectedHost.trim();
    if (selectedHost && isIP(selectedHost) !== 4) throw new Error("remote access selectedHost must be an IPv4 address");
  }
}

function previewToken(token: string | undefined): string | undefined {
  if (!token) return undefined;
  if (token.length <= 8) return "••••";
  return `${token.slice(0, 4)}…${token.slice(-4)}`;
}

