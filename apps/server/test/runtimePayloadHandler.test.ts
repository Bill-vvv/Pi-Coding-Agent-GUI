import assert from "node:assert/strict";
import test from "node:test";
import type { Runtime } from "@pi-gui/shared";
import type { ManagedRuntime } from "../src/runtime/managedRuntime.js";
import { handleRuntimePayload } from "../src/runtime/runtimePayloadHandler.js";

function createManaged(statsRequestId: string | undefined, projected: unknown[], logs: unknown[] = [], sent: unknown[] = [], busy: boolean[] = []): ManagedRuntime {
  const runtime: Runtime = {
    id: "runtime-1",
    projectId: "project-1",
    cwd: process.cwd(),
    status: "running",
    pid: 123,
    startedAt: 1,
  };
  return {
    runtime,
    client: { send: (command: unknown) => sent.push(command) },
    statsRequestId,
    pendingNativeRpcCommands: new Map(),
    configRevision: 0,
    projection: {
      handlePiPayload: (payload: unknown) => projected.push(payload),
      appendLog: (...args: unknown[]) => logs.push(args),
      markBusy: (value: boolean) => busy.push(value),
    },
    subagents: { handlePiPayload: () => undefined },
  } as unknown as ManagedRuntime;
}

test("handleRuntimePayload ignores stale internal stats responses", () => {
  const projected: unknown[] = [];
  const indexed: unknown[] = [];
  const events: unknown[] = [];
  const managed = createManaged("gui-stats-current", projected);

  handleRuntimePayload({
    runtimeId: "runtime-1",
    managed,
    payload: { type: "response", id: "gui-stats-stale", command: "get_session_stats", success: true, data: { contextUsage: { tokens: 900 } } },
    events: { publishGuiEvent: (...args: unknown[]) => events.push(args) } as never,
    liveState: {} as never,
    sessionLinker: { indexSessionFromPiResponse: (...args: unknown[]) => indexed.push(args) } as never,
    broadcast: () => undefined,
  });

  assert.equal(managed.statsRequestId, "gui-stats-current");
  assert.deepEqual(projected, []);
  assert.deepEqual(indexed, []);
  assert.equal(events.length, 1);
});

test("handleRuntimePayload applies the current internal stats response", () => {
  const projected: unknown[] = [];
  const indexed: unknown[] = [];
  const managed = createManaged("gui-stats-current", projected);
  const payload = { type: "response", id: "gui-stats-current", command: "get_session_stats", success: true, data: { contextUsage: { tokens: 80 } } };

  handleRuntimePayload({
    runtimeId: "runtime-1",
    managed,
    payload,
    events: { publishGuiEvent: () => undefined } as never,
    liveState: {} as never,
    sessionLinker: { indexSessionFromPiResponse: (...args: unknown[]) => indexed.push(args) } as never,
    broadcast: () => undefined,
  });

  assert.equal(managed.statsRequestId, undefined);
  assert.deepEqual(projected, [payload]);
  assert.equal(indexed.length, 1);
});

test("handleRuntimePayload stops automatic retry for provider payload-too-large failures", () => {
  const projected: unknown[] = [];
  const logs: unknown[] = [];
  const sent: unknown[] = [];
  const busy: boolean[] = [];
  const events: unknown[] = [];
  const managed = createManaged(undefined, projected, logs, sent, busy);
  const payload = { type: "auto_retry_start", attempt: 1, maxAttempts: 3, errorMessage: "WebSocket closed 1009 message too big" };

  handleRuntimePayload({
    runtimeId: "runtime-1",
    managed,
    payload,
    events: { publishGuiEvent: (...args: unknown[]) => events.push(args) } as never,
    liveState: {} as never,
    sessionLinker: { indexSessionFromPiResponse: () => undefined } as never,
    broadcast: () => undefined,
  });

  assert.equal(projected.length, 0);
  assert.deepEqual(busy, [false]);
  assert.equal(logs.length, 1);
  assert.match(String((logs[0] as unknown[])[1]), /stopped the automatic retry/);
  assert.equal((sent[0] as { type?: unknown }).type, "abort_retry");
  assert.equal(events.length, 2);
  assert.equal((events[0] as unknown[])[1], "error");
  assert.equal(((events[0] as unknown[])[2] as { code?: unknown }).code, "provider_payload_too_large_retry_stopped");
  assert.match(((events[0] as unknown[])[2] as { message: string }).message, /same oversized image\/base64 context/);
  assert.equal((events[1] as unknown[])[1], "pi_event");
});

test("handleRuntimePayload broadcasts blocking extension UI requests", () => {
  const projected: unknown[] = [];
  const broadcasts: unknown[] = [];
  const managed = createManaged(undefined, projected);
  const payload = {
    type: "extension_ui_request",
    id: "editor-1",
    method: "editor",
    title: "Edit",
    prefill: "draft",
  };

  handleRuntimePayload({
    runtimeId: "runtime-1",
    managed,
    payload,
    events: { publishGuiEvent: () => undefined } as never,
    liveState: {} as never,
    sessionLinker: { indexSessionFromPiResponse: () => undefined } as never,
    broadcast: (event: unknown) => broadcasts.push(event),
  });

  assert.deepEqual(managed.pendingExtensionUiRequest, payload);
  assert.deepEqual(broadcasts, [{ type: "extension.ui.request", runtimeId: "runtime-1", projectId: "project-1", request: payload }]);
  assert.deepEqual(projected, [payload]);
});

test("handleRuntimePayload remembers blocking extension UI requests for reconnect recovery", () => {
  const projected: unknown[] = [];
  const broadcasts: unknown[] = [];
  const managed = createManaged(undefined, projected);
  const payload = {
    type: "extension_ui_request",
    id: "editor-1",
    method: "editor",
    title: "Edit",
    prefill: "draft",
  };
  handleRuntimePayload({
      runtimeId: "runtime-1",
      managed,
      payload,
      events: { publishGuiEvent: () => undefined } as never,
      liveState: {} as never,
      sessionLinker: { indexSessionFromPiResponse: () => undefined } as never,
      broadcast: (event: unknown) => broadcasts.push(event),
    });

  assert.deepEqual(managed.pendingExtensionUiRequest, payload);
  assert.deepEqual(broadcasts, [{ type: "extension.ui.request", runtimeId: "runtime-1", projectId: "project-1", request: payload }]);
  assert.deepEqual(projected, [payload]);
});

test("handleRuntimePayload does not remember fire-and-forget extension UI requests", () => {
  const projected: unknown[] = [];
  const managed = createManaged(undefined, projected);
  const payload = { type: "extension_ui_request", id: "notice-1", method: "notify", message: "FYI" };

  handleRuntimePayload({
    runtimeId: "runtime-1",
    managed,
    payload,
    events: { publishGuiEvent: () => undefined } as never,
    liveState: {} as never,
    sessionLinker: { indexSessionFromPiResponse: () => undefined } as never,
    broadcast: () => undefined,
  });

  assert.equal(managed.pendingExtensionUiRequest, undefined);
});

test("handleRuntimePayload appends post-compact token notice from refreshed stats", () => {
  const projected: unknown[] = [];
  const logs: unknown[] = [];
  const managed = createManaged("gui-stats-current", projected, logs);
  managed.pendingCompactStatsNotice = { tokensBefore: 243849 };
  const payload = {
    type: "response",
    id: "gui-stats-current",
    command: "get_session_stats",
    success: true,
    data: { contextUsage: { tokens: 1200, contextWindow: 272000, percent: 0.441 } },
  };

  handleRuntimePayload({
    runtimeId: "runtime-1",
    managed,
    payload,
    events: { publishGuiEvent: () => undefined } as never,
    liveState: {} as never,
    sessionLinker: { indexSessionFromPiResponse: () => undefined } as never,
    broadcast: () => undefined,
  });

  assert.equal(managed.pendingCompactStatsNotice, undefined);
  assert.equal(logs.length, 1);
  assert.deepEqual(logs[0], ["log", "上下文压缩后约 1,200 / 272,000 tokens（0.4%），压缩前约 243,849 tokens", "/compact"]);
});

test("handleRuntimePayload does not append post-compact notice while token count is unknown", () => {
  const projected: unknown[] = [];
  const logs: unknown[] = [];
  const managed = createManaged("gui-stats-current", projected, logs);
  managed.pendingCompactStatsNotice = { tokensBefore: 196578 };
  const payload = {
    type: "response",
    id: "gui-stats-current",
    command: "get_session_stats",
    success: true,
    data: { contextUsage: { tokens: null, contextWindow: 272000, percent: null } },
  };

  handleRuntimePayload({
    runtimeId: "runtime-1",
    managed,
    payload,
    events: { publishGuiEvent: () => undefined } as never,
    liveState: {} as never,
    sessionLinker: { indexSessionFromPiResponse: () => undefined } as never,
    broadcast: () => undefined,
  });

  assert.equal(managed.pendingCompactStatsNotice, undefined);
  assert.deepEqual(logs, []);
});
