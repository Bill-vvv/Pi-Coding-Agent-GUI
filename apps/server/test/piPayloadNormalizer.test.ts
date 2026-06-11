import assert from "node:assert/strict";
import { appendFileSync, mkdtempSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import test from "node:test";
import { AppDatabase } from "../src/db.js";
import { normalizePiPayload } from "../src/runtime/conversation/piPayloadNormalizer.js";

test("normalizePiPayload turns lifecycle events into busy changes", () => {
  assert.deepEqual(normalizePiPayload({ type: "agent_start" }), [{ type: "busy.changed", busy: true }]);
  assert.deepEqual(normalizePiPayload({ type: "compaction_end" }), [{ type: "busy.changed", busy: false }]);
});

test("normalizePiPayload extracts context and session tokens from state and session stats responses", () => {
  assert.deepEqual(
    normalizePiPayload({
      type: "response",
      command: "get_state",
      success: true,
      data: { model: { contextWindow: 1000 }, isStreaming: false },
    }).map((event) => (event.type === "context.window" ? event : event.type === "busy.changed" ? event : undefined)),
    [
      { type: "context.window", contextWindow: 1000 },
      { type: "busy.changed", busy: false },
    ],
  );

  const [usageEvent] = normalizePiPayload(
    {
      type: "response",
      command: "get_session_stats",
      success: true,
      data: {
        contextUsage: { tokens: 250 },
        tokens: { input: 100, output: 20, cacheRead: 300, cacheWrite: 40, total: 460 },
        cost: 0.1234,
      },
    },
    { currentContextWindow: 1000 },
  );

  assert.equal(usageEvent?.type, "context.usage");
  if (usageEvent?.type === "context.usage") {
    assert.equal(usageEvent.usage.tokens, 250);
    assert.equal(usageEvent.usage.contextWindow, 1000);
    assert.equal(usageEvent.usage.percent, 25);
    assert.deepEqual(usageEvent.usage.sessionTokens, { input: 100, output: 20, cacheRead: 300, cacheWrite: 40, total: 460, cost: 0.1234 });
  }
});

test("normalizePiPayload marks post-compaction context tokens as unknown when Pi reports null", () => {
  const [usageEvent] = normalizePiPayload(
    {
      type: "response",
      command: "get_session_stats",
      success: true,
      data: {
        contextUsage: { tokens: null, contextWindow: 1000, percent: null },
        tokens: { input: 100, output: 20, total: 120 },
      },
    },
    { currentContextWindow: 1000 },
  );

  assert.equal(usageEvent?.type, "context.usage");
  if (usageEvent?.type === "context.usage") {
    assert.equal(usageEvent.usage.tokens, null);
    assert.equal(usageEvent.usage.contextWindow, 1000);
    assert.equal(usageEvent.usage.percent, null);
    assert.deepEqual(usageEvent.usage.sessionTokens, { input: 100, output: 20, cacheRead: undefined, cacheWrite: undefined, total: 120, cost: undefined });
  }
});

test("normalizePiPayload prefers session file usage over compacted stats token totals", () => {
  const dir = mkdtempSync(join(tmpdir(), "pi-gui-current-usage-"));
  const sessionFile = join(dir, "session.jsonl");
  writeFileSync(
    sessionFile,
    [
      { type: "session", id: "session-1", cwd: dir },
      { type: "message", message: { role: "assistant", usage: { input: 100, output: 25, cacheRead: 500, cacheWrite: 0, totalTokens: 625, cost: 0.42 } } },
      { type: "compaction", summary: "older conversation compressed" },
    ].map((record) => JSON.stringify(record)).join("\n"),
  );

  const [usageEvent] = normalizePiPayload(
    {
      type: "response",
      command: "get_session_stats",
      success: true,
      data: {
        contextUsage: { tokens: 80 },
        tokens: { input: 10, output: 5, cacheRead: 20, cacheWrite: 0, total: 35 },
        cost: 0.02,
        sessionFile,
      },
    },
    { currentContextWindow: 1000 },
  );

  assert.equal(usageEvent?.type, "context.usage");
  if (usageEvent?.type === "context.usage") {
    assert.deepEqual(usageEvent.usage.sessionTokens, { input: 100, output: 25, cacheRead: 500, cacheWrite: 0, total: 625, cost: 0.42 });
  }
});

test("normalizePiPayload falls back to session file usage when stats omit token totals", () => {
  const dir = mkdtempSync(join(tmpdir(), "pi-gui-current-usage-"));
  const sessionFile = join(dir, "session.jsonl");
  writeFileSync(
    sessionFile,
    [
      { type: "session", id: "session-1", cwd: dir },
      { type: "message", message: { role: "assistant", usage: { input: 10, output: 5, cacheRead: 20, cacheWrite: 2, totalTokens: 37, cost: 0.01 } } },
      { type: "message", message: { role: "assistant", usage: { prompt_tokens: 7, completion_tokens: 3, cache_read_tokens: 4, cache_creation_tokens: 1 } } },
      { type: "message", message: { role: "user", usage: { totalTokens: 999 } } },
    ].map((record) => JSON.stringify(record)).join("\n"),
  );

  const [usageEvent] = normalizePiPayload(
    {
      type: "response",
      command: "get_session_stats",
      success: true,
      data: { contextUsage: { tokens: 250 }, sessionFile },
    },
    { currentContextWindow: 1000 },
  );

  assert.equal(usageEvent?.type, "context.usage");
  if (usageEvent?.type === "context.usage") {
    assert.deepEqual(usageEvent.usage.sessionTokens, { input: 17, output: 8, cacheRead: 24, cacheWrite: 3, total: 52, cost: 0.01 });
  }
});

test("normalizePiPayload caches session file token usage and invalidates when the file changes", () => {
  const dir = mkdtempSync(join(tmpdir(), "pi-gui-current-usage-cache-"));
  const dbPath = join(dir, "pi-gui.sqlite");
  const sessionFile = join(dir, "session.jsonl");
  writeFileSync(
    sessionFile,
    [
      { type: "session", id: "session-1", cwd: dir },
      { type: "message", message: { role: "assistant", usage: { input: 3, output: 2, totalTokens: 5 } } },
    ].map((record) => JSON.stringify(record)).join("\n") + "\n",
  );

  const firstDb = new AppDatabase(dbPath);
  const [firstEvent] = normalizePiPayload({ type: "response", command: "get_session_stats", success: true, data: { contextUsage: { tokens: 10 }, sessionFile } }, { db: firstDb });
  assert.equal(firstEvent?.type, "context.usage");
  if (firstEvent?.type === "context.usage") assert.equal(firstEvent.usage.sessionTokens?.total, 5);
  firstDb.close();

  const secondDb = new AppDatabase(dbPath);
  const [cachedEvent] = normalizePiPayload({ type: "response", command: "get_session_stats", success: true, data: { contextUsage: { tokens: 10 }, sessionFile } }, { db: secondDb });
  assert.equal(cachedEvent?.type, "context.usage");
  if (cachedEvent?.type === "context.usage") assert.equal(cachedEvent.usage.sessionTokens?.total, 5);

  appendFileSync(sessionFile, `${JSON.stringify({ type: "message", message: { role: "assistant", usage: { input: 4, output: 1, totalTokens: 5 } } })}\n`);
  const [updatedEvent] = normalizePiPayload({ type: "response", command: "get_session_stats", success: true, data: { contextUsage: { tokens: 20 }, sessionFile } }, { db: secondDb });
  assert.equal(updatedEvent?.type, "context.usage");
  if (updatedEvent?.type === "context.usage") assert.equal(updatedEvent.usage.sessionTokens?.total, 10);
  secondDb.close();
});

test("normalizePiPayload converts failed prompt responses into visible errors and clears busy", () => {
  assert.deepEqual(normalizePiPayload({ type: "response", command: "prompt", success: false, error: "No API key found" }), [
    { type: "busy.changed", busy: false },
    { type: "assistant.error", reason: "prompt_failed", errorText: "No API key found" },
  ]);
});

test("normalizePiPayload converts assistant streaming updates", () => {
  assert.deepEqual(normalizePiPayload({ type: "message_update", assistantMessageEvent: { type: "text_delta", delta: "hello" } }), [
    { type: "assistant.delta", appendText: "hello", isStreaming: true },
  ]);

  assert.deepEqual(normalizePiPayload({ type: "message_update", assistantMessageEvent: { type: "error", reason: "oops", error: "failed" } }), [
    { type: "assistant.error", reason: "oops", errorText: "failed" },
  ]);
});

test("normalizePiPayload converts auto retry lifecycle events", () => {
  assert.deepEqual(normalizePiPayload({ type: "auto_retry_start", attempt: 2, maxAttempts: 3, errorMessage: "timeout" }), [
    { type: "retry.started", attempt: 2, maxAttempts: 3, errorMessage: "timeout" },
  ]);

  assert.deepEqual(normalizePiPayload({ type: "auto_retry_end", attempt: 2, success: true }), [{ type: "retry.finished", attempt: 2, success: true, finalError: undefined }]);
  assert.deepEqual(normalizePiPayload({ type: "auto_retry_end", attempt: 3, success: false, finalError: "still down" }), [
    { type: "retry.finished", attempt: 3, success: false, finalError: "still down" },
  ]);
});

test("normalizePiPayload converts message lifecycle events", () => {
  assert.deepEqual(normalizePiPayload({ type: "message_end", message: { id: "assistant-1", role: "assistant", content: "done", timestamp: 100 } }), [
    {
      type: "message.finished",
      message: { id: "assistant-1", role: "assistant", text: "done", thinking: undefined, timestamp: 100, errorMessage: undefined },
    },
  ]);
});

test("normalizePiPayload surfaces provider transport diagnostics on assistant errors", () => {
  const events = normalizePiPayload({
    type: "message_end",
    message: {
      id: "assistant-1",
      role: "assistant",
      content: [],
      timestamp: 100,
      errorMessage: "Codex SSE response headers timed out after 10000ms",
      diagnostics: [
        {
          type: "provider_transport_failure",
          error: { message: "WebSocket closed 1009 message too big", code: 1009, stack: "verbose stack omitted by normalizer" },
          details: { configuredTransport: "websocket-cached", fallbackTransport: "sse", phase: "before_message_stream_start", requestBytes: 28_039_159, eventsEmitted: false },
        },
      ],
    },
  });

  assert.equal(events[0]?.type, "message.finished");
  assert.match(events[0]?.message.errorMessage ?? "", /Codex SSE response headers timed out/);
  assert.match(events[0]?.message.errorMessage ?? "", /WebSocket closed 1009 message too big/);
  assert.match(events[0]?.message.errorMessage ?? "", /request 26\.7 MB/);
  assert.match(events[0]?.message.errorMessage ?? "", /transport websocket-cached → sse/);
  assert.match(events[0]?.message.errorMessage ?? "", /no stream events before failure/);
  assert.doesNotMatch(events[0]?.message.errorMessage ?? "", /verbose stack/);
});

test("normalizePiPayload converts get_messages snapshots including tools", () => {
  assert.deepEqual(
    normalizePiPayload({
      type: "response",
      command: "get_messages",
      success: true,
      data: {
        messages: [
          { id: "user-1", role: "user", content: "请查看项目", timestamp: 100 },
          { id: "assistant-1", role: "assistant", content: [{ type: "text", text: "好的" }], timestamp: 101 },
          { toolCallId: "tool-1", role: "tool", toolName: "read", result: "README.md", timestamp: 102 },
        ],
      },
    }),
    [
      {
        type: "messages.snapshot",
        messages: [
          { id: "user-1", role: "user", text: "请查看项目", thinking: undefined, timestamp: 100, isStreaming: false },
          { id: "assistant-1", role: "assistant", text: "好的", thinking: undefined, timestamp: 101, isStreaming: false },
          { id: "tool-tool-1", role: "tool", title: "read 完成", text: "README.md", timestamp: 102, isStreaming: false },
        ],
      },
    ],
  );
});

test("normalizePiPayload converts tool execution events", () => {
  const [start] = normalizePiPayload({ type: "tool_execution_start", toolCallId: "read-1", toolName: "read" });
  assert.equal(start?.type, "tool.started");
  if (start?.type === "tool.started") {
    assert.equal(start.tool.key, "read-1");
    assert.equal(start.tool.name, "read");
    assert.equal(start.tool.text, "");
    assert.equal(typeof start.tool.timestamp, "number");
  }

  const [end] = normalizePiPayload({ type: "tool_execution_end", toolCallId: "read-1", toolName: "read", result: "README.md", isError: true });
  assert.equal(end?.type, "tool.finished");
  if (end?.type === "tool.finished") {
    assert.equal(end.tool.text, "README.md");
    assert.equal(end.tool.isError, true);
  }
});
