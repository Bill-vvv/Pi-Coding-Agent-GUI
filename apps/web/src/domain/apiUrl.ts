import { piGuiRuntimeConfig } from "./runtimeConfig";

const HTTP_URL_RE = /^https?:\/\//i;

export function apiUrl(path: string): string {
  return apiUrlCandidates(path)[0] ?? path;
}

export function apiUrlCandidates(path: string): string[] {
  if (HTTP_URL_RE.test(path)) return [path];
  const config = piGuiRuntimeConfig();
  const explicitBase = apiBaseFromHttpUrl(config.apiBaseUrl);
  const wsBase = config.wsUrl;
  const derivedBase = wsBase ? apiBaseFromWsUrl(wsBase) : undefined;
  const primary = explicitBase ? joinUrl(explicitBase, path) : derivedBase ? joinUrl(derivedBase, path) : path;
  const fallback = config.authToken ? undefined : defaultLocalApiUrl(path);
  return uniqueStrings([primary, fallback]);
}

function apiBaseFromHttpUrl(value: string | undefined): string | undefined {
  if (!value || !HTTP_URL_RE.test(value)) return undefined;
  try {
    const url = new URL(value);
    url.search = "";
    url.hash = "";
    return url.toString();
  } catch {
    return undefined;
  }
}

function apiBaseFromWsUrl(value: string): string | undefined {
  try {
    const url = new URL(value, window.location.href);
    if (url.protocol !== "ws:" && url.protocol !== "wss:") return undefined;
    url.protocol = url.protocol === "wss:" ? "https:" : "http:";
    url.pathname = stripTrailingWsPath(url.pathname);
    url.search = "";
    url.hash = "";
    return url.toString();
  } catch {
    return undefined;
  }
}

function stripTrailingWsPath(pathname: string): string {
  if (pathname === "/ws") return "";
  return pathname.endsWith("/ws") ? pathname.slice(0, -"/ws".length) : "";
}

function defaultLocalApiUrl(path: string): string | undefined {
  if (typeof window === "undefined" || !isLocalBrowserHost() || window.location.port === "8787") return undefined;
  return joinUrl(`${window.location.protocol}//${window.location.hostname}:8787`, path);
}

function isLocalBrowserHost(): boolean {
  return window.location.hostname === "localhost" || window.location.hostname === "127.0.0.1" || window.location.hostname === "[::1]" || window.location.hostname === "::1";
}

function joinUrl(base: string, path: string): string {
  return `${base.replace(/\/$/, "")}/${path.replace(/^\//, "")}`;
}

function uniqueStrings(values: Array<string | undefined>): string[] {
  return [...new Set(values.filter((value): value is string => Boolean(value)))];
}

