import assert from "node:assert/strict";
import test from "node:test";
import { apiUrl, apiUrlCandidates } from "../src/domain/apiUrl";
import { authHeaders, authToken, piGuiRuntimeConfig } from "../src/domain/runtimeConfig";
import { sanitizeWebSocketUrlForDiagnostics, webSocketCloseClue } from "../src/domain/webSocketDiagnostics";
import { connectionStateAfterServerEvent, diagnosticsAfterServerEvent, isUnauthorizedCloseEvent, replayCursorAfterServerEvent, wsUrl } from "../src/hooks/useGuiSocket";

test("runtime config reads Electron-injected API, WebSocket, auth token, and optional instance tag values", () => {
  withWindow({ apiBaseUrl: "http://127.0.0.1:4567", wsUrl: "ws://127.0.0.1:4567/ws", authToken: "secret", instanceTag: "DEV" }, () => {
    assert.deepEqual(piGuiRuntimeConfig(), { apiBaseUrl: "http://127.0.0.1:4567", wsUrl: "ws://127.0.0.1:4567/ws", authToken: "secret", instanceTag: "DEV" });
    assert.equal(apiUrl("/api/models"), "http://127.0.0.1:4567/api/models");
    assert.deepEqual(apiUrlCandidates("/api/models"), ["http://127.0.0.1:4567/api/models"]);
    assert.equal(wsUrl(42), "ws://127.0.0.1:4567/ws?token=secret&sinceEventId=42");
    assert.equal(authToken(), "secret");
    assert.equal(new Headers(authHeaders()).get("authorization"), "Bearer secret");
  });
});

test("runtime config saves remote access token from URL hash and uses it for API/WS auth", () => {
  withWindow(undefined, () => {
    assert.equal(authToken(), "phone-secret");
    assert.equal(new Headers(authHeaders()).get("authorization"), "Bearer phone-secret");
    assert.equal(wsUrl(), "ws://localhost:5173/ws?token=phone-secret");
  }, { href: "http://localhost:5173/#token=phone-secret" });
});

test("wsUrl derives a direct WebSocket endpoint from injected apiBaseUrl", () => {
  withWindow({ apiBaseUrl: "http://127.0.0.1:4567/api", authToken: "secret" }, () => {
    assert.equal(wsUrl(42), "ws://127.0.0.1:4567/ws?token=secret&sinceEventId=42");
  });
  withWindow({ apiBaseUrl: "https://example.test/gui", authToken: "secret" }, () => {
    assert.equal(wsUrl(), "wss://example.test/gui/ws?token=secret");
  });
});

test("runtime config preserves default relative API URL without injected config", () => {
  withWindow(undefined, () => {
    assert.equal(apiUrl("/api/models"), "/api/models");
    assert.deepEqual(apiUrlCandidates("/api/models"), ["/api/models", "http://localhost:8787/api/models"]);
    assert.equal(new Headers(authHeaders({ "Content-Type": "application/json" })).get("authorization"), null);
  });
});

test("replay cursor advances to latest event after replay gaps", () => {
  assert.equal(
    replayCursorAfterServerEvent(12, {
      type: "event.replay.gap",
      requestedSinceEventId: 12,
      firstAvailableEventId: 50,
      lastEventId: 80,
      replayedEvents: 31,
      reason: "pruned",
    }),
    80,
  );
  assert.equal(
    replayCursorAfterServerEvent(80, {
      type: "gui.event",
      event: { id: 70, runtimeId: "runtime-1", projectId: "project-1", timestamp: 1, kind: "pi_event", payload: {} },
    }),
    80,
  );
});

test("replay cursor resets stale values from hello and ready events", () => {
  assert.equal(
    replayCursorAfterServerEvent(500, {
      type: "hello",
      serverTime: 1,
      projects: [],
      runtimes: [],
      settings: {},
      lastEventId: 30,
    }),
    30,
  );
  assert.equal(replayCursorAfterServerEvent(500, { type: "bootstrap.complete", connectionId: "1", serverTime: 2, lastEventId: 35 }), 35);
  assert.equal(replayCursorAfterServerEvent(500, { type: "replay.complete", connectionId: "1", serverTime: 2, lastEventId: 38, replayedEvents: 5 }), 38);
  assert.equal(replayCursorAfterServerEvent(500, { type: "connection.ready", serverTime: 2, lastEventId: 40 }), 40);
});

test("connection state reaches ready only after connection.ready", () => {
  assert.equal(
    connectionStateAfterServerEvent("connected_waiting_hello", {
      type: "hello",
      serverTime: 1,
      projects: [],
      runtimes: [],
      settings: {},
      lastEventId: 30,
    }),
    "bootstrapping",
  );
  assert.equal(connectionStateAfterServerEvent("bootstrapping", { type: "bootstrap.complete", connectionId: "1", serverTime: 2, lastEventId: 35 }), "replaying");
  assert.equal(connectionStateAfterServerEvent("replaying", { type: "replay.complete", connectionId: "1", serverTime: 2, lastEventId: 38, replayedEvents: 5 }), "replaying");
  assert.equal(connectionStateAfterServerEvent("replaying", { type: "connection.ready", serverTime: 2, lastEventId: 40 }), "ready");
  assert.equal(
    connectionStateAfterServerEvent("bootstrapping", {
      type: "event.replay.gap",
      requestedSinceEventId: 10,
      lastEventId: 40,
      replayedEvents: 0,
      reason: "truncated",
    }),
    "degraded",
  );
});

test("unauthorized close events are distinct", () => {
  assert.equal(isUnauthorizedCloseEvent({ code: 1008, reason: "" } as CloseEvent), true);
  assert.equal(isUnauthorizedCloseEvent({ code: 1006, reason: "Unauthorized" } as CloseEvent), true);
  assert.equal(isUnauthorizedCloseEvent({ code: 1006, reason: "" } as CloseEvent), false);
});

test("websocket diagnostics redact tokens and classify close clues", () => {
  const sanitized = sanitizeWebSocketUrlForDiagnostics("wss://user:secret@example.test/ws?token=top-secret&sinceEventId=42&x=1#frag");
  assert.equal(sanitized, "wss://example.test/ws?sinceEventId=42&x=1");
  assert.equal(sanitized.includes("top-secret"), false);
  assert.equal(sanitized.includes("user:secret"), false);
  assert.equal(webSocketCloseClue({ code: 1013, reason: "backpressure", wasClean: false, at: 1, reconnectAttempt: 2 })?.label, "可能是慢客户端/背压断开");
  assert.equal(webSocketCloseClue({ code: 1008, reason: "Unauthorized", wasClean: true, at: 1, reconnectAttempt: 0 })?.severity, "error");
});

test("websocket diagnostics keeps cursor and replay gap details", () => {
  const base = { endpoint: "ws://localhost/ws", authPresent: false, reconnectAttempt: 0, lastGuiEventId: 0 };
  const afterEvent = diagnosticsAfterServerEvent(base, {
    type: "gui.event",
    event: { id: 70, runtimeId: "runtime-1", projectId: "project-1", timestamp: 1, kind: "pi_event", payload: {} },
  }, 70);
  assert.equal(afterEvent.lastGuiEventId, 70);
  const afterGap = diagnosticsAfterServerEvent(afterEvent, {
    type: "event.replay.gap",
    requestedSinceEventId: 70,
    firstAvailableEventId: 90,
    lastEventId: 120,
    replayedEvents: 10,
    reason: "pruned",
  }, 120);
  assert.equal(afterGap.lastGuiEventId, 120);
  assert.equal(afterGap.lastReplayGap?.reason, "pruned");
});

function withWindow(config: { apiBaseUrl?: string; wsUrl?: string; authToken?: string; instanceTag?: string } | undefined, run: () => void, options: { href?: string } = {}): void {
  const global = globalThis as unknown as { window?: unknown; document?: unknown };
  const previousWindow = global.window;
  const previousDocument = global.document;
  const storage = new Map<string, string>();
  const href = options.href ?? "http://localhost:5173/";
  const url = new URL(href);
  global.document = { title: "Pi GUI" };
  global.window = {
    __PI_GUI_CONFIG__: config,
    location: {
      href,
      protocol: url.protocol,
      host: url.host,
      hostname: url.hostname,
      port: url.port,
      search: url.search,
      hash: url.hash,
    },
    history: {
      state: undefined,
      replaceState() {},
    },
    localStorage: {
      getItem(key: string) {
        return storage.get(key) ?? null;
      },
      setItem(key: string, value: string) {
        storage.set(key, value);
      },
      removeItem(key: string) {
        storage.delete(key);
      },
    },
  };
  try {
    run();
  } finally {
    global.window = previousWindow;
    global.document = previousDocument;
  }
}
