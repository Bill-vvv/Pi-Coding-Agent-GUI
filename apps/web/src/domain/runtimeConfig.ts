import { remoteAccessToken } from "./remoteAuth";

export type PiGuiRuntimeConfig = {
  apiBaseUrl?: string;
  wsUrl?: string;
  authToken?: string;
};

declare global {
  interface Window {
    __PI_GUI_CONFIG__?: PiGuiRuntimeConfig;
  }
}

export function piGuiRuntimeConfig(): PiGuiRuntimeConfig {
  const injected = typeof window !== "undefined" ? normalizeRuntimeConfig(window.__PI_GUI_CONFIG__) : undefined;
  const env = (import.meta as { env?: Record<string, unknown> }).env;
  return {
    apiBaseUrl: injected?.apiBaseUrl ?? stringEnv(env?.VITE_API_URL),
    wsUrl: injected?.wsUrl ?? stringEnv(env?.VITE_WS_URL),
    authToken: injected?.authToken ?? stringEnv(env?.VITE_PI_GUI_AUTH_TOKEN) ?? remoteAccessToken(),
  };
}

export function authHeaders(headers?: HeadersInit): HeadersInit | undefined {
  const token = piGuiRuntimeConfig().authToken;
  if (!token) return headers;
  const merged = new Headers(headers);
  merged.set("Authorization", `Bearer ${token}`);
  return merged;
}

export function authToken(): string | undefined {
  return piGuiRuntimeConfig().authToken;
}

function normalizeRuntimeConfig(value: unknown): PiGuiRuntimeConfig | undefined {
  if (!value || typeof value !== "object") return undefined;
  const record = value as Record<string, unknown>;
  return {
    apiBaseUrl: stringEnv(record.apiBaseUrl),
    wsUrl: stringEnv(record.wsUrl),
    authToken: stringEnv(record.authToken),
  };
}

function stringEnv(value: unknown): string | undefined {
  return typeof value === "string" && value.trim() ? value.trim() : undefined;
}
