const REMOTE_ACCESS_TOKEN_STORAGE_KEY = "pi-gui.remoteAccess.token";
const TOKEN_PARAM_KEYS = ["token", "authToken", "access_token"];

let urlTokenConsumed = false;

export function remoteAccessToken(): string | undefined {
  const tokenFromUrl = consumeRemoteAccessTokenFromUrl();
  if (tokenFromUrl) return tokenFromUrl;
  return storedRemoteAccessToken();
}

export function storedRemoteAccessToken(): string | undefined {
  if (typeof window === "undefined") return undefined;
  try {
    return window.localStorage.getItem(REMOTE_ACCESS_TOKEN_STORAGE_KEY)?.trim() || undefined;
  } catch {
    return undefined;
  }
}

export function saveRemoteAccessToken(token: string): void {
  persistRemoteAccessToken(token);
}

export function forgetRemoteAccessToken(): void {
  if (typeof window === "undefined") return;
  try {
    window.localStorage.removeItem(REMOTE_ACCESS_TOKEN_STORAGE_KEY);
  } catch {
    // Ignore storage failures; auth will fall back to injected/env config.
  }
}

export function consumeRemoteAccessTokenFromUrl(): string | undefined {
  if (urlTokenConsumed || typeof window === "undefined") return undefined;
  urlTokenConsumed = true;

  const token = tokenFromHash(window.location.hash) ?? tokenFromSearch(window.location.search);
  if (!token) return undefined;

  persistRemoteAccessToken(token);
  stripRemoteAccessTokenFromUrl();
  return token;
}

function persistRemoteAccessToken(token: string): void {
  try {
    window.localStorage.setItem(REMOTE_ACCESS_TOKEN_STORAGE_KEY, token);
  } catch {
    // If storage is unavailable, the current call can still use the token.
  }
}

function tokenFromHash(hash: string): string | undefined {
  if (!hash) return undefined;
  const raw = hash.startsWith("#") ? hash.slice(1) : hash;
  const query = raw.startsWith("?") ? raw.slice(1) : raw.includes("?") ? raw.slice(raw.indexOf("?") + 1) : raw;
  const params = new URLSearchParams(query);
  return tokenFromParams(params);
}

function tokenFromSearch(search: string): string | undefined {
  if (!search) return undefined;
  return tokenFromParams(new URLSearchParams(search));
}

function tokenFromParams(params: URLSearchParams): string | undefined {
  for (const key of TOKEN_PARAM_KEYS) {
    const value = params.get(key)?.trim();
    if (value) return value;
  }
  return undefined;
}

function stripRemoteAccessTokenFromUrl(): void {
  try {
    const url = new URL(window.location.href);
    let changed = false;
    for (const key of TOKEN_PARAM_KEYS) {
      if (url.searchParams.has(key)) {
        url.searchParams.delete(key);
        changed = true;
      }
    }
    if (stripTokenFromHash(url)) changed = true;
    if (changed) window.history.replaceState(window.history.state, document.title, `${url.pathname}${url.search}${url.hash}`);
  } catch {
    // Best-effort cleanup only.
  }
}

function stripTokenFromHash(url: URL): boolean {
  if (!url.hash) return false;
  const raw = url.hash.slice(1);
  const queryStart = raw.startsWith("?") ? 0 : raw.indexOf("?");
  const queryText = queryStart >= 0 ? raw.slice(queryStart + 1) : raw;
  const prefix = queryStart > 0 ? raw.slice(0, queryStart + 1) : queryStart === 0 ? "?" : "";
  const params = new URLSearchParams(queryText);
  let changed = false;
  for (const key of TOKEN_PARAM_KEYS) {
    if (params.has(key)) {
      params.delete(key);
      changed = true;
    }
  }
  if (!changed) return false;
  const nextQuery = params.toString();
  url.hash = nextQuery ? `${prefix}${nextQuery}` : prefix && prefix !== "?" ? prefix.slice(0, -1) : "";
  return true;
}
