// Dynamic runtime entry. Loaded by path, not by TypeScript import.
import {
  formatCodexTransportMonitorLine,
  isCodexProviderRequest,
  isCodexSseHeaderTimeoutText,
  isCodexTransportMonitorEnabled,
  normalizeCodexTransportStats,
  shouldEmitCodexTransportSnapshot,
  type CodexTransportSnapshot,
  type CodexTransportStats,
} from "./piCodexTransportMonitor.js";

type ProviderRequestEvent = { payload: unknown };
type MessageEndEvent = { message?: { errorMessage?: unknown } };
type ProviderRequestContext = {
  model?: unknown;
  sessionManager?: {
    getSessionId?: () => string;
  };
};

interface CodexTransportMonitorExtensionApi {
  on(event: "before_provider_request", handler: (event: ProviderRequestEvent, context: ProviderRequestContext) => unknown): void;
  on(event: "message_end", handler: (event: MessageEndEvent, context: ProviderRequestContext) => unknown): void;
  on(event: "agent_end", handler: (event: unknown, context: ProviderRequestContext) => unknown | Promise<unknown>): void;
}

type CodexProviderDebugModule = {
  getOpenAICodexWebSocketDebugStats?: (sessionId: string) => CodexTransportStats | undefined;
};

const CODEX_PROVIDER_DEBUG_MODULE = "@earendil-works/pi-ai/openai-codex-responses";

export default function codexTransportMonitorExtension(pi: CodexTransportMonitorExtensionApi) {
  let sawCodexRequest = false;
  let sseHeaderTimeouts = 0;
  const lastSnapshots = new Map<string, CodexTransportSnapshot>();

  pi.on("before_provider_request", (event, context) => {
    if (!isCodexTransportMonitorEnabled()) return undefined;
    if (isCodexProviderRequest(event.payload, context)) sawCodexRequest = true;
    return undefined;
  });

  pi.on("message_end", (event) => {
    if (!isCodexTransportMonitorEnabled()) return undefined;
    if (isCodexSseHeaderTimeoutText(event.message?.errorMessage)) {
      sawCodexRequest = true;
      sseHeaderTimeouts += 1;
    }
    return undefined;
  });

  pi.on("agent_end", async (_event, context) => {
    if (!isCodexTransportMonitorEnabled() || !sawCodexRequest) return undefined;
    sawCodexRequest = false;

    const sessionId = context.sessionManager?.getSessionId?.();
    if (!sessionId) return undefined;

    try {
      const providerDebug = (await import(CODEX_PROVIDER_DEBUG_MODULE)) as CodexProviderDebugModule;
      const snapshot = normalizeCodexTransportStats({
        ...providerDebug.getOpenAICodexWebSocketDebugStats?.(sessionId),
        sseHeaderTimeouts,
      });
      const previous = lastSnapshots.get(sessionId);
      if (!shouldEmitCodexTransportSnapshot(previous, snapshot)) return undefined;
      lastSnapshots.set(sessionId, snapshot);
      process.stderr.write(`${formatCodexTransportMonitorLine(sessionId, snapshot)}\n`);
    } catch {
      // Fail open: provider debug exports are version-dependent and monitoring must
      // never break the GUI-managed Pi runtime.
    }
    return undefined;
  });
}
