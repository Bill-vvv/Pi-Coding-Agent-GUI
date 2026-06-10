import assert from "node:assert/strict";
import test from "node:test";
import { apiUrl, apiUrlCandidates } from "../src/domain/apiUrl";
import { authHeaders, authToken, piGuiRuntimeConfig } from "../src/domain/runtimeConfig";
import { replayCursorAfterServerEvent, wsUrl } from "../src/hooks/useGuiSocket";

test("runtime config reads Electron-injected API, WebSocket, and auth token values", () => {
  withWindow({ apiBaseUrl: "http://127.0.0.1:4567", wsUrl: "ws://127.0.0.1:4567/ws", authToken: "secret" }, () => {
    assert.deepEqual(piGuiRuntimeConfig(), { apiBaseUrl: "http://127.0.0.1:4567", wsUrl: "ws://127.0.0.1:4567/ws", authToken: "secret" });
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

test("replay cursor resets stale values from hello snapshots", () => {
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
});

function withWindow(config: { apiBaseUrl?: string; wsUrl?: string; authToken?: string } | undefined, run: () => void, options: { href?: string } = {}): void {
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
