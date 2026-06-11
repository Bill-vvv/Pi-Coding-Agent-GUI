import { spawnSync } from "node:child_process";
import { randomBytes } from "node:crypto";
import { createServer } from "node:net";
import { posix, resolve, win32 } from "node:path";

export type RendererRuntimeConfig = {
  apiBaseUrl: string;
  wsUrl: string;
  authToken: string;
};

export type DesktopMode = "dev" | "built";

export type DesktopBackendHostKind = "wsl" | "windows";

export type DesktopBackendHost =
  | { kind: "wsl"; distro?: string; cwd: string }
  | { kind: "windows"; cwd: string };

export type DesktopLaunchConfig = {
  mode: DesktopMode;
  repoRoot: string;
  webUrl?: string;
  webIndexPath: string;
  backendPort: number;
  dataDir?: string;
  authToken: string;
  desktopLaunchId: string;
  rendererConfig: RendererRuntimeConfig;
  backendHost: DesktopBackendHost;
  backendCommand: string;
  backendReadyTimeoutMs: number;
};

const DEFAULT_DEV_WEB_URL = "http://127.0.0.1:5173";
const DEFAULT_BACKEND_READY_TIMEOUT_MS = 30_000;

export async function createDesktopLaunchConfig(options: {
  env?: NodeJS.ProcessEnv;
  isPackaged: boolean;
  repoRoot: string;
}): Promise<DesktopLaunchConfig> {
  const env = options.env ?? process.env;
  const mode = desktopMode(env, options.isPackaged);
  const inheritedBackendEnv = looksLikeInheritedBackendEnv(env);
  const backendPort = parsePort(firstNonBlank(env.PI_GUI_DESKTOP_BACKEND_PORT, inheritedBackendEnv ? undefined : env.PORT)) ?? await findAvailableLoopbackPort();
  const authToken = env.PI_GUI_DESKTOP_AUTH_TOKEN?.trim() || generateAuthToken();
  const desktopLaunchId = env.PI_GUI_DESKTOP_LAUNCH_ID?.trim() || generateAuthToken();
  const apiBaseUrl = `http://127.0.0.1:${backendPort}`;
  const wsUrl = `ws://127.0.0.1:${backendPort}/ws`;
  const backendHost = resolveBackendHost(options.repoRoot, env);

  return {
    mode,
    repoRoot: options.repoRoot,
    webUrl: mode === "dev" ? trimmed(env.PI_GUI_DESKTOP_WEB_URL) ?? DEFAULT_DEV_WEB_URL : undefined,
    webIndexPath: trimmed(env.PI_GUI_DESKTOP_WEB_INDEX_PATH) ?? resolve(options.repoRoot, "apps", "web", "dist", "index.html"),
    backendPort,
    dataDir: resolveDesktopDataDir(backendHost, env, inheritedBackendEnv),
    authToken,
    desktopLaunchId,
    rendererConfig: { apiBaseUrl, wsUrl, authToken },
    backendHost,
    backendCommand: trimmed(env.PI_GUI_DESKTOP_BACKEND_COMMAND) ?? defaultBackendCommand(mode, backendHost.kind),
    backendReadyTimeoutMs: parsePositiveInt(env.PI_GUI_DESKTOP_BACKEND_READY_TIMEOUT_MS) ?? DEFAULT_BACKEND_READY_TIMEOUT_MS,
  };
}

export function defaultBackendCommand(mode: DesktopMode, hostKind: DesktopBackendHostKind = "wsl"): string {
  const execPrefix = hostKind === "wsl" ? "exec " : "";
  return mode === "dev"
    ? `npm run build -w @pi-gui/shared && ${execPrefix}npm run dev -w @pi-gui/server`
    : `npm run build -w @pi-gui/shared && npm run build -w @pi-gui/server && ${execPrefix}npm run start -w @pi-gui/server`;
}

export function desktopBackendHostKind(env: NodeJS.ProcessEnv = process.env): DesktopBackendHostKind {
  const explicit = firstNonBlank(env.PI_GUI_DESKTOP_HOST, env.PI_GUI_DESKTOP_BACKEND_HOST)?.toLowerCase();
  if (!explicit || explicit === "auto" || explicit === "wsl") return "wsl";
  if (explicit === "windows" || explicit === "win32" || explicit === "native") return "windows";
  throw new Error(`Unsupported PI_GUI_DESKTOP_HOST '${explicit}'. Expected wsl, windows, or auto.`);
}

export function resolveBackendHost(repoRoot: string, env: NodeJS.ProcessEnv = process.env): DesktopBackendHost {
  const kind = desktopBackendHostKind(env);
  if (kind === "windows") {
    return { kind, cwd: trimmed(env.PI_GUI_DESKTOP_WINDOWS_CWD) ?? repoRoot };
  }

  const distro = trimmed(env.PI_GUI_DESKTOP_WSL_DISTRO);
  return { kind, distro, cwd: trimmed(env.PI_GUI_DESKTOP_WSL_CWD) ?? resolveWslCwd(repoRoot, { env, distro }) };
}

export function desktopMode(env: NodeJS.ProcessEnv = process.env, isPackaged = false): DesktopMode {
  const explicit = env.PI_GUI_DESKTOP_MODE?.trim().toLowerCase();
  if (explicit === "built" || explicit === "production" || explicit === "prod") return "built";
  if (explicit === "dev" || explicit === "development") return "dev";
  return isPackaged ? "built" : "dev";
}

export function desktopTransparentWindow(env: NodeJS.ProcessEnv = process.env, platform = process.platform, osRelease = ""): boolean {
  const explicit = firstNonBlank(env.PI_GUI_DESKTOP_TRANSPARENT_WINDOW, env.PI_GUI_DESKTOP_WINDOW_TRANSPARENT);
  if (explicit) {
    const parsed = parseBooleanFlag(explicit);
    if (parsed === undefined) throw new Error(`Unsupported PI_GUI_DESKTOP_TRANSPARENT_WINDOW '${explicit}'. Expected true or false.`);
    return parsed;
  }

  if (platform !== "win32") return false;
  return !windowsHasNativeRoundedCorners(osRelease);
}

export function windowsHasNativeRoundedCorners(osRelease: string): boolean {
  const build = Number(osRelease.split(".")[2]);
  return Number.isInteger(build) && build >= 22000;
}

export function encodeRendererConfig(config: RendererRuntimeConfig): string {
  return Buffer.from(JSON.stringify(config), "utf8").toString("base64url");
}

export function decodeRendererConfig(value: string | undefined): RendererRuntimeConfig | undefined {
  if (!value) return undefined;
  try {
    const parsed = JSON.parse(Buffer.from(value, "base64url").toString("utf8")) as Partial<RendererRuntimeConfig>;
    if (!parsed.apiBaseUrl || !parsed.wsUrl || !parsed.authToken) return undefined;
    return { apiBaseUrl: parsed.apiBaseUrl, wsUrl: parsed.wsUrl, authToken: parsed.authToken };
  } catch {
    return undefined;
  }
}

export function resolveWslCwd(repoRoot: string, options: { env?: NodeJS.ProcessEnv; distro?: string } = {}): string {
  const env = options.env ?? process.env;
  const explicit = trimmed(env.PI_GUI_DESKTOP_WSL_CWD);
  if (explicit) return explicit;

  const args = [...(options.distro ? ["-d", options.distro] : []), "--", "wslpath", "-a", repoRoot];
  const result = spawnSync("wsl.exe", args, { encoding: "utf8", windowsHide: true });
  const cwd = result.status === 0 ? result.stdout.trim() : "";
  if (cwd.startsWith("/")) return cwd;

  throw new Error("Unable to resolve the repository path inside WSL. Set PI_GUI_DESKTOP_WSL_CWD to the pi-gui checkout path in WSL, for example /home/user/projects/pi-gui.");
}

export function resolveDesktopDataDir(host: DesktopBackendHost, env: NodeJS.ProcessEnv = process.env, inheritedBackendEnv = looksLikeInheritedBackendEnv(env)): string {
  const explicit = firstNonBlank(env.PI_GUI_DESKTOP_DATA_DIR, inheritedBackendEnv ? undefined : env.PI_GUI_DATA_DIR);
  const relative = explicit ?? ".pi-gui";
  if (host.kind === "wsl") return isAbsoluteWslPath(relative) ? relative : posix.join(host.cwd, "apps", "server", relative);
  return isAbsoluteWindowsPath(relative) ? relative : win32.join(host.cwd, "apps", "server", relative);
}

export function backendEnv(config: Pick<DesktopLaunchConfig, "backendPort" | "authToken" | "dataDir"> & { desktopLaunchId?: string; backendHost?: DesktopBackendHost }): Record<string, string> {
  const hostEnv = config.backendHost ? executionHostEnv(config.backendHost) : {};
  return {
    PI_GUI_MODE: "desktop",
    PI_GUI_HOST: "127.0.0.1",
    PORT: String(config.backendPort),
    PI_GUI_AUTH_TOKEN: config.authToken,
    ...(config.desktopLaunchId ? { PI_GUI_DESKTOP_LAUNCH_ID: config.desktopLaunchId } : {}),
    ...hostEnv,
    ...(config.dataDir ? { PI_GUI_DATA_DIR: config.dataDir } : {}),
  };
}

function executionHostEnv(host: DesktopBackendHost): Record<string, string> {
  if (host.kind === "wsl") {
    return {
      PI_GUI_EXECUTION_HOST_KIND: "wsl",
      PI_GUI_EXECUTION_HOST_ID: `wsl:${host.distro ?? "default"}`,
      PI_GUI_EXECUTION_HOST_LABEL: `WSL${host.distro ? ` (${host.distro})` : ""}`,
      ...(host.distro ? { PI_GUI_DESKTOP_WSL_DISTRO: host.distro } : {}),
    };
  }

  return {
    PI_GUI_EXECUTION_HOST_KIND: "windows",
    PI_GUI_EXECUTION_HOST_ID: "windows:local",
    PI_GUI_EXECUTION_HOST_LABEL: "Windows native",
  };
}

export function generateAuthToken(): string {
  return randomBytes(32).toString("base64url");
}

export function parsePort(value: string | undefined): number | undefined {
  if (!value?.trim()) return undefined;
  const parsed = Number(value);
  return Number.isInteger(parsed) && parsed > 0 && parsed <= 65535 ? parsed : undefined;
}

export function parsePositiveInt(value: string | undefined): number | undefined {
  if (!value?.trim()) return undefined;
  const parsed = Number(value);
  return Number.isInteger(parsed) && parsed > 0 ? parsed : undefined;
}

export async function findAvailableLoopbackPort(): Promise<number> {
  return new Promise((resolvePort, reject) => {
    const server = createServer();
    server.once("error", reject);
    server.listen(0, "127.0.0.1", () => {
      const address = server.address();
      server.close(() => {
        if (typeof address === "object" && address?.port) resolvePort(address.port);
        else reject(new Error("Unable to allocate a local backend port"));
      });
    });
  });
}

function looksLikeInheritedBackendEnv(env: NodeJS.ProcessEnv): boolean {
  return trimmed(env.PI_GUI_MODE)?.toLowerCase() === "desktop" && Boolean(trimmed(env.PI_GUI_AUTH_TOKEN) || trimmed(env.PI_GUI_SERVICE_TIER_FILE) || trimmed(env.PI_GUI_EXECUTION_HOST_KIND));
}

function isAbsoluteWslPath(value: string): boolean {
  return value.startsWith("/");
}

function isAbsoluteWindowsPath(value: string): boolean {
  return /^[a-zA-Z]:[\\/]/.test(value) || value.startsWith("\\\\");
}

function firstNonBlank(...values: Array<string | undefined>): string | undefined {
  for (const value of values) {
    const candidate = trimmed(value);
    if (candidate) return candidate;
  }
  return undefined;
}

function trimmed(value: string | undefined): string | undefined {
  return value?.trim() || undefined;
}

function parseBooleanFlag(value: string): boolean | undefined {
  switch (value.trim().toLowerCase()) {
    case "1":
    case "true":
    case "yes":
    case "on":
      return true;
    case "0":
    case "false":
    case "no":
    case "off":
      return false;
    default:
      return undefined;
  }
}
