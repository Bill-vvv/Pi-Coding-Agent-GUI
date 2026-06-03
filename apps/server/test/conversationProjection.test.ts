import assert from "node:assert/strict";
import { mkdtempSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import test from "node:test";
import type { Runtime, ServerEvent } from "@pi-gui/shared";
import { AppDatabase } from "../src/db.js";
import { ConversationProjection } from "../src/runtime/conversationProjection.js";

function createHarness() {
  const dir = mkdtempSync(join(tmpdir(), "pi-gui-conversation-"));
  const db = new AppDatabase(join(dir, "pi-gui.sqlite"));
  const runtime: Runtime = {
    id: "runtime-1",
    projectId: "project-1",
    cwd: process.cwd(),
    status: "running",
    pid: 123,
    startedAt: 1,
  };
  db.createProject({ id: runtime.projectId, name: "Project", cwd: runtime.cwd, lastOpenedAt: 1 });
  db.upsertRuntime(runtime);
  const events: ServerEvent[] = [];
  const projection = new ConversationProjection(db, () => runtime, (event) => events.push(event));
  return { db, runtime, events, projection };
}

test("ConversationProjection tracks busy state for agent lifecycle events", () => {
  const { db, runtime, events, projection } = createHarness();

  projection.handlePiPayload({ type: "agent_start" });
  projection.handlePiPayload({ type: "agent_start" });
  projection.handlePiPayload({ type: "agent_end" });

  assert.equal(db.getConversationBusy(runtime.id), false);
  assert.deepEqual(
    events.filter((event) => event.type === "conversation.busy").map((event) => event.busy),
    [true, false],
  );
  db.close();
});

test("ConversationProjection turns streaming assistant deltas into snapshot messages", () => {
  const { db, runtime, events, projection } = createHarness();

  projection.handlePiPayload({ type: "message_update", assistantMessageEvent: { type: "thinking_delta", delta: "plan" } });
  projection.handlePiPayload({ type: "message_update", assistantMessageEvent: { type: "text_delta", delta: "hello" } });
  projection.handlePiPayload({ type: "message_update", assistantMessageEvent: { type: "text_delta", delta: " world" } });

  const snapshot = projection.snapshot();
  assert.equal(snapshot?.type, "conversation.snapshot");
  assert.equal(snapshot?.messages.length, 1);
  assert.equal(snapshot?.messages[0]?.role, "assistant");
  assert.equal(snapshot?.messages[0]?.text, "hello world");
  assert.equal(snapshot?.messages[0]?.thinking, "plan");
  assert.equal(snapshot?.messages[0]?.isStreaming, true);

  assert.ok(events.some((event) => event.type === "conversation.message" && event.message.text === ""));
  assert.deepEqual(
    events.filter((event) => event.type === "conversation.delta" && event.delta.appendText).map((event) => event.delta.appendText),
    ["hello", " world"],
  );
  assert.deepEqual(db.listConversationMessages(runtime.id), []);
  db.close();
});

test("ConversationProjection persists assistant message_end and strips serialized tool calls", () => {
  const { db, runtime, projection } = createHarness();

  projection.handlePiPayload({
    type: "message_end",
    message: {
      id: "assistant-1",
      role: "assistant",
      content: [
        { type: "thinking", thinking: "reasoning" },
        { type: "text", text: "final answer" },
        { type: "tool_use", name: "bash", input: { command: "ls" } },
      ],
      timestamp: 100,
    },
  });

  const messages = db.listConversationMessages(runtime.id);
  assert.equal(messages.length, 1);
  assert.equal(messages[0]?.id, "assistant-1");
  assert.equal(messages[0]?.role, "assistant");
  assert.equal(messages[0]?.text, "final answer");
  assert.equal(messages[0]?.thinking, "reasoning");
  assert.equal(messages[0]?.isStreaming, false);
  db.close();
});

test("ConversationProjection applies get_messages snapshots into persistent conversation history", () => {
  const { db, runtime, events, projection } = createHarness();

  projection.handlePiPayload({
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
  });

  const messages = db.listConversationMessages(runtime.id);
  assert.deepEqual(messages.map((message) => message.role), ["user", "assistant", "tool"]);
  assert.deepEqual(messages.map((message) => message.text), ["请查看项目", "好的", "README.md"]);
  assert.ok(events.some((event) => event.type === "conversation.snapshot" && event.messages.length === 3));
  db.close();
});
