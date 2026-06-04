import assert from "node:assert/strict";
import test from "node:test";
import { normalizePiPayload } from "../src/runtime/conversation/piPayloadNormalizer.js";

test("normalizePiPayload turns lifecycle events into busy changes", () => {
  assert.deepEqual(normalizePiPayload({ type: "agent_start" }), [{ type: "busy.changed", busy: true }]);
  assert.deepEqual(normalizePiPayload({ type: "compaction_end" }), [{ type: "busy.changed", busy: false }]);
});

test("normalizePiPayload extracts context from state and session stats responses", () => {
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
      data: { contextUsage: { tokens: 250 } },
    },
    { currentContextWindow: 1000 },
  );

  assert.equal(usageEvent?.type, "context.usage");
  if (usageEvent?.type === "context.usage") {
    assert.equal(usageEvent.usage.tokens, 250);
    assert.equal(usageEvent.usage.contextWindow, 1000);
    assert.equal(usageEvent.usage.percent, 25);
  }
});

test("normalizePiPayload converts assistant streaming updates", () => {
  assert.deepEqual(normalizePiPayload({ type: "message_update", assistantMessageEvent: { type: "text_delta", delta: "hello" } }), [
    { type: "assistant.delta", appendText: "hello", isStreaming: true },
  ]);

  assert.deepEqual(normalizePiPayload({ type: "message_update", assistantMessageEvent: { type: "error", reason: "oops", error: "failed" } }), [
    { type: "assistant.error", reason: "oops", errorText: "failed" },
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
