import { isLoopbackHost } from "./hostUtils.js";

export type ServerRuntimeConfig = {
  host: string;
  port: number;
  mode: string;
  authToken?: string;
  authRequired: boolean;
  remoteLan: boolean;
  authTokenSource?: "env" | "persisted";
};

export type PersistedRemoteAccessConfig = {
  enabled: boolean;
  authToken?: string;
};

export function readServerRuntimeConfig(env: NodeJS.ProcessEnv = process.env, persistedRemoteAccess?: PersistedRemoteAccessConfig): ServerRuntimeConfig {
  const envAuthToken = env.PI_GUI_AUTH_TOKEN?.trim() || undefined;
  const requestedMode = env.PI_GUI_MODE?.trim() || env.NODE_ENV?.trim() || "development";
  const explicitRemoteLan = isRemoteLanMode(requestedMode);
  const persistedRemoteEnabled = persistedRemoteAccess?.enabled === true;
  const remoteLan = explicitRemoteLan || persistedRemoteEnabled;
  const persistedAuthToken = remoteLan ? persistedRemoteAccess?.authToken?.trim() || undefined : undefined;
  const authToken = envAuthToken ?? persistedAuthToken;
  const authTokenSource = envAuthToken ? "env" : persistedAuthToken ? "persisted" : undefined;
  const host = resolveHost(env, remoteLan);
  const mode = remoteLan ? "remote-lan" : requestedMode;

  if (remoteLan) {
    if (!authToken) throw new Error("PI_GUI_AUTH_TOKEN or a persisted remote access token is required for remote-lan server mode");
  } else if (requiresAuthToken(requestedMode)) {
    if (!authToken) {
      throw new Error("PI_GUI_AUTH_TOKEN is required for desktop/production-managed server mode");
    }
    if (!isLoopbackHost(host)) {
      throw new Error("PI_GUI_HOST/HOST must be a loopback address in desktop/production-managed server mode");
    }
  }

  return {
    host,
    port: parsePort(env.PORT),
    mode,
    authToken,
    authRequired: remoteLan || Boolean(authToken),
    remoteLan,
    ...(authTokenSource ? { authTokenSource } : {}),
  };
}

function resolveHost(env: NodeJS.ProcessEnv, remoteLan: boolean): string {
  const explicitHost = env.PI_GUI_HOST?.trim();
  if (explicitHost) return explicitHost;
  if (remoteLan) return "0.0.0.0";
  const genericHost = env.HOST?.trim();
  if (genericHost) return genericHost;
  return "127.0.0.1";
}

function requiresAuthToken(mode: string): boolean {
  const normalized = mode.trim().toLowerCase();
  return normalized === "desktop" || normalized === "production" || normalized === "prod";
}

function isRemoteLanMode(mode: string): boolean {
  return mode.trim().toLowerCase() === "remote-lan";
}


function parsePort(value: string | undefined): number {
  if (!value?.trim()) return 8787;
  const parsed = Number(value);
  return Number.isInteger(parsed) && parsed >= 0 && parsed <= 65535 ? parsed : 8787;
}
