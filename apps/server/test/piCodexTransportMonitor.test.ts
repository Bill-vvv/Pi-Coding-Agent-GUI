import assert from "node:assert/strict";
import test from "node:test";
import {
  codexTransportUserErrorFromStderr,
  formatCodexTransportMonitorLine,
  isCodexProviderRequest,
  isCodexSseHeaderTimeoutText,
  isCodexTransportMonitorEnabled,
  normalizeCodexTransportStats,
  parseCodexTransportMonitorLine,
  shouldEmitCodexTransportSnapshot,
} from "../src/runtime/piCodexTransportMonitor.js";

test("isCodexTransportMonitorEnabled defaults on and accepts opt-out", () => {
  assert.equal(isCodexTransportMonitorEnabled({}), true);
  assert.equal(isCodexTransportMonitorEnabled({ PI_GUI_CODEX_TRANSPORT_MONITOR: "1" }), true);
  assert.equal(isCodexTransportMonitorEnabled({ PI_GUI_CODEX_TRANSPORT_MONITOR: "0" }), false);
});

test("isCodexProviderRequest detects Codex provider context", () => {
  assert.equal(isCodexProviderRequest({ model: "gpt-5.5" }, { model: { provider: "openai-codex", api: "openai-codex-responses" } }), true);
  assert.equal(isCodexProviderRequest({ model: "codex-test" }, {}), true);
  assert.equal(isCodexProviderRequest({ model: "gpt-5.5" }, { model: { provider: "openai", api: "openai-responses" } }), false);
  assert.equal(isCodexProviderRequest(undefined, { model: { provider: "openai-codex" } }), false);
});

test("normalizeCodexTransportStats coerces counters and sanitizes error text", () => {
  const snapshot = normalizeCodexTransportStats({
    requests: 2.7,
    connectionsCreated: 1,
    connectionsReused: -1,
    cachedContextRequests: 1,
    fullContextRequests: 1,
    deltaRequests: 1,
    websocketFailures: 1,
    sseFallbacks: 2,
    websocketFallbackActive: true,
    lastInputItems: 5,
    lastWebSocketError: "proxy http://user:secret@example.test failed with Bearer abc.def.ghi and sk-secret123456",
    sseHeaderTimeouts: 3,
  });

  assert.deepEqual(snapshot, {
    requests: 2,
    connectionsCreated: 1,
    connectionsReused: 0,
    cachedContextRequests: 1,
    fullContextRequests: 1,
    deltaRequests: 1,
    websocketFailures: 1,
    sseFallbacks: 2,
    websocketFallbackActive: true,
    lastInputItems: 5,
    lastDeltaInputItems: undefined,
    lastWebSocketError: "proxy http://[redacted]@example.test failed with Bearer [redacted] and [redacted]",
    sseHeaderTimeouts: 3,
  });
});

test("shouldEmitCodexTransportSnapshot emits only meaningful changes", () => {
  const empty = normalizeCodexTransportStats({});
  const first = normalizeCodexTransportStats({ requests: 1, connectionsCreated: 1 });
  const changed = normalizeCodexTransportStats({ requests: 2, connectionsCreated: 1, connectionsReused: 1 });

  assert.equal(shouldEmitCodexTransportSnapshot(undefined, undefined), false);
  assert.equal(shouldEmitCodexTransportSnapshot(undefined, empty), false);
  assert.equal(shouldEmitCodexTransportSnapshot(undefined, normalizeCodexTransportStats({ sseHeaderTimeouts: 1 })), true);
  assert.equal(shouldEmitCodexTransportSnapshot(undefined, first), true);
  assert.equal(shouldEmitCodexTransportSnapshot(first, first), false);
  assert.equal(shouldEmitCodexTransportSnapshot(first, changed), true);
});

test("formatCodexTransportMonitorLine includes only sanitized counters and shortened session id", () => {
  const snapshot = normalizeCodexTransportStats({ requests: 3, connectionsCreated: 1, connectionsReused: 2, websocketFailures: 1, sseFallbacks: 2, websocketFallbackActive: true });
  assert.ok(snapshot);

  const line = formatCodexTransportMonitorLine("1234567890abcdef", snapshot);
  assert.match(line, /^\[pi-gui-codex-transport\] /);
  const payload = JSON.parse(line.replace(/^\[pi-gui-codex-transport\] /, "")) as Record<string, unknown>;

  assert.equal(payload.sessionId, "1234567890ab");
  assert.equal(payload.requests, 3);
  assert.equal(payload.connectionsCreated, 1);
  assert.equal(payload.connectionsReused, 2);
  assert.equal(payload.websocketFailures, 1);
  assert.equal(payload.sseFallbacks, 2);
  assert.equal(payload.websocketFallbackActive, true);
});

test("isCodexSseHeaderTimeoutText detects Codex SSE header timeouts", () => {
  assert.equal(isCodexSseHeaderTimeoutText("Codex SSE response headers timed out after 10000ms"), true);
  assert.equal(isCodexSseHeaderTimeoutText("WebSocket connect timeout after 30000ms"), false);
});

test("parseCodexTransportMonitorLine decodes sanitized monitor stderr", () => {
  const snapshot = normalizeCodexTransportStats({ websocketFailures: 1, sseFallbacks: 1, lastWebSocketError: "1009 message too big" });
  assert.ok(snapshot);

  assert.deepEqual(parseCodexTransportMonitorLine(formatCodexTransportMonitorLine("session-id", snapshot)), snapshot);
  assert.equal(parseCodexTransportMonitorLine("ordinary stderr"), undefined);
});

test("codexTransportUserErrorFromStderr explains 1009 and SSE fallback failures", () => {
  const messageTooBig = codexTransportUserErrorFromStderr(
    `${formatCodexTransportMonitorLine("session-id", normalizeCodexTransportStats({ websocketFailures: 1, sseFallbacks: 1, lastWebSocketError: "WebSocket close 1009: message too big" })!)}\n`,
  );
  assert.match(messageTooBig ?? "", /oversized embedded image\/base64 context/);
  assert.match(messageTooBig ?? "", /WebSocket 1009/);
  assert.match(messageTooBig ?? "", /Reduce or remove embedded image payloads/);

  const timeout = codexTransportUserErrorFromStderr(
    formatCodexTransportMonitorLine("session-id", normalizeCodexTransportStats({ websocketFailures: 1, sseFallbacks: 1, sseHeaderTimeouts: 2 })!),
  );
  assert.match(timeout ?? "", /SSE header timeouts: 2/);

  assert.equal(codexTransportUserErrorFromStderr(formatCodexTransportMonitorLine("session-id", normalizeCodexTransportStats({ requests: 1 })!)), undefined);
});
