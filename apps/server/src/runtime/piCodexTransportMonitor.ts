export type CodexTransportStats = {
  requests?: number;
  connectionsCreated?: number;
  connectionsReused?: number;
  cachedContextRequests?: number;
  storeTrueRequests?: number;
  fullContextRequests?: number;
  deltaRequests?: number;
  websocketFailures?: number;
  sseFallbacks?: number;
  websocketFallbackActive?: boolean;
  lastInputItems?: number;
  lastDeltaInputItems?: number;
  lastWebSocketError?: string;
  sseHeaderTimeouts?: number;
};

export type CodexTransportSnapshot = Required<
  Pick<
    CodexTransportStats,
    | "requests"
    | "connectionsCreated"
    | "connectionsReused"
    | "cachedContextRequests"
    | "fullContextRequests"
    | "deltaRequests"
    | "websocketFailures"
    | "sseFallbacks"
  >
> & {
  websocketFallbackActive: boolean;
  lastInputItems?: number;
  lastDeltaInputItems?: number;
  lastWebSocketError?: string;
  sseHeaderTimeouts?: number;
};

export function isCodexTransportMonitorEnabled(env: NodeJS.ProcessEnv = process.env): boolean {
  return env.PI_GUI_CODEX_TRANSPORT_MONITOR !== "0";
}

export function isCodexProviderRequest(payload: unknown, context: unknown): boolean {
  if (!payload || typeof payload !== "object" || Array.isArray(payload)) return false;

  const model = contextModelFromContext(context);
  const api = model && typeof model === "object" && "api" in model ? (model as { api?: unknown }).api : undefined;
  const provider = model && typeof model === "object" && "provider" in model ? (model as { provider?: unknown }).provider : undefined;
  if (provider === "openai-codex" || api === "openai-codex-responses") return true;

  const payloadModel = "model" in payload ? (payload as { model?: unknown }).model : undefined;
  return typeof payloadModel === "string" && /codex/i.test(payloadModel);
}

export function normalizeCodexTransportStats(stats: CodexTransportStats | undefined): CodexTransportSnapshot | undefined {
  if (!stats) return undefined;
  return {
    requests: integerStat(stats.requests),
    connectionsCreated: integerStat(stats.connectionsCreated),
    connectionsReused: integerStat(stats.connectionsReused),
    cachedContextRequests: integerStat(stats.cachedContextRequests),
    fullContextRequests: integerStat(stats.fullContextRequests),
    deltaRequests: integerStat(stats.deltaRequests),
    websocketFailures: integerStat(stats.websocketFailures),
    sseFallbacks: integerStat(stats.sseFallbacks),
    websocketFallbackActive: stats.websocketFallbackActive === true,
    lastInputItems: optionalIntegerStat(stats.lastInputItems),
    lastDeltaInputItems: optionalIntegerStat(stats.lastDeltaInputItems),
    lastWebSocketError: sanitizeErrorText(stats.lastWebSocketError),
    sseHeaderTimeouts: optionalIntegerStat(stats.sseHeaderTimeouts),
  };
}

export function shouldEmitCodexTransportSnapshot(previous: CodexTransportSnapshot | undefined, next: CodexTransportSnapshot | undefined): next is CodexTransportSnapshot {
  if (!next) return false;
  if (!previous) return hasNonZeroCounters(next) || next.websocketFallbackActive;
  return JSON.stringify(previous) !== JSON.stringify(next);
}

const CODEX_TRANSPORT_PREFIX = "[pi-gui-codex-transport] ";

export function formatCodexTransportMonitorLine(sessionId: string | undefined, snapshot: CodexTransportSnapshot): string {
  const payload = {
    sessionId: shortenSessionId(sessionId),
    requests: snapshot.requests,
    connectionsCreated: snapshot.connectionsCreated,
    connectionsReused: snapshot.connectionsReused,
    cachedContextRequests: snapshot.cachedContextRequests,
    fullContextRequests: snapshot.fullContextRequests,
    deltaRequests: snapshot.deltaRequests,
    websocketFailures: snapshot.websocketFailures,
    sseFallbacks: snapshot.sseFallbacks,
    websocketFallbackActive: snapshot.websocketFallbackActive,
    lastInputItems: snapshot.lastInputItems,
    lastDeltaInputItems: snapshot.lastDeltaInputItems,
    lastWebSocketError: snapshot.lastWebSocketError,
    sseHeaderTimeouts: snapshot.sseHeaderTimeouts,
  };
  return `${CODEX_TRANSPORT_PREFIX}${JSON.stringify(payload)}`;
}

export function parseCodexTransportMonitorLine(line: string): CodexTransportSnapshot | undefined {
  if (!line.startsWith(CODEX_TRANSPORT_PREFIX)) return undefined;
  try {
    return normalizeCodexTransportStats(JSON.parse(line.slice(CODEX_TRANSPORT_PREFIX.length)));
  } catch {
    return undefined;
  }
}

export function codexTransportUserErrorFromStderr(chunk: string): string | undefined {
  for (const line of chunk.split(/\r?\n/)) {
    const snapshot = parseCodexTransportMonitorLine(line.trim());
    if (!snapshot || !isUserVisibleTransportFailure(snapshot)) continue;
    const lastError = snapshot.lastWebSocketError ? ` Last WebSocket error: ${snapshot.lastWebSocketError}.` : "";
    const sse = snapshot.sseHeaderTimeouts ? ` SSE header timeouts: ${snapshot.sseHeaderTimeouts}.` : "";
    return [
      "Provider transport failed while sending this conversation.",
      "The session likely contains oversized embedded image/base64 context, which can trigger WebSocket 1009 'message too big' and repeated SSE fallback timeouts.",
      `${lastError}${sse}`.trim(),
      "Start a new conversation, or sanitize the affected Pi session before resuming it.",
      "Reduce or remove embedded image payloads before retrying so the GUI/RPC path stays within provider transport limits.",
    ].filter(Boolean).join(" ");
  }
  return undefined;
}

function contextModelFromContext(context: unknown): unknown {
  return context && typeof context === "object" && "model" in context ? (context as { model?: unknown }).model : undefined;
}

function integerStat(value: unknown): number {
  return typeof value === "number" && Number.isFinite(value) && value > 0 ? Math.floor(value) : 0;
}

function optionalIntegerStat(value: unknown): number | undefined {
  return typeof value === "number" && Number.isFinite(value) && value >= 0 ? Math.floor(value) : undefined;
}

function hasNonZeroCounters(snapshot: CodexTransportSnapshot): boolean {
  return (
    snapshot.requests > 0 ||
    snapshot.connectionsCreated > 0 ||
    snapshot.connectionsReused > 0 ||
    snapshot.websocketFailures > 0 ||
    snapshot.sseFallbacks > 0 ||
    (snapshot.sseHeaderTimeouts ?? 0) > 0
  );
}

export function isCodexSseHeaderTimeoutText(value: unknown): boolean {
  return typeof value === "string" && /Codex SSE response headers timed out after \d+ms/.test(value);
}

export function isProviderPayloadTooLargeErrorText(value: unknown): boolean {
  return typeof value === "string" && /1009|message too big|request body|payload too large/i.test(value);
}

export function providerPayloadTooLargeUserMessage(errorText: string | undefined): string {
  const detail = errorText ? ` Provider error: ${sanitizeErrorText(errorText)}.` : "";
  return [
    "Provider transport payload is too large; Pi GUI stopped the automatic retry for this turn.",
    "The same oversized image/base64 context is unlikely to recover by falling back to another transport.",
    detail.trim(),
    "Reduce or remove embedded image payloads, use editable file path references where possible, or start a clean conversation before retrying.",
  ].filter(Boolean).join(" ");
}

function isUserVisibleTransportFailure(snapshot: CodexTransportSnapshot): boolean {
  const error = snapshot.lastWebSocketError ?? "";
  return (
    isProviderPayloadTooLargeErrorText(error) ||
    ((snapshot.sseHeaderTimeouts ?? 0) > 0 && (snapshot.websocketFailures > 0 || snapshot.sseFallbacks > 0 || snapshot.websocketFallbackActive))
  );
}

function shortenSessionId(sessionId: string | undefined): string | undefined {
  if (!sessionId) return undefined;
  return sessionId.length <= 12 ? sessionId : sessionId.slice(0, 12);
}

function sanitizeErrorText(value: unknown): string | undefined {
  if (typeof value !== "string" || !value.trim()) return undefined;
  return value
    .replace(/Bearer\s+[A-Za-z0-9._~+/-]+=*/gi, "Bearer [redacted]")
    .replace(/(sk-[A-Za-z0-9_-]{8,})/g, "[redacted]")
    .replace(/(https?:\/\/)[^\s/@:]+:[^\s/@]+@/g, "$1[redacted]@")
    .slice(0, 300);
}
