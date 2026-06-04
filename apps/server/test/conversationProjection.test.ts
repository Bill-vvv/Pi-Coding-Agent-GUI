import assert from "node:assert/strict";
import { mkdtempSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import test from "node:test";
import type { Runtime, ServerEvent } from "@pi-gui/shared";
import { AppDatabase } from "../src/db.js";
import { ConversationProjection } from "../src/runtime/conversationProjection.js";
import { RuntimeSupervisor } from "../src/runtime/runtimeSupervisor.js";

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

test("RuntimeSupervisor exposes live projection summaries before messages are persisted", () => {
  const { db, runtime, projection } = createHarness();
  const supervisor = new RuntimeSupervisor(db, () => undefined);

  projection.handlePiPayload({ type: "message_update", assistantMessageEvent: { type: "text_delta", delta: "正在实时回答" } });
  (supervisor as unknown as { runtimes: Map<string, unknown> }).runtimes.set(runtime.id, { runtime, projection });

  const summaries = supervisor.listRuntimeConversationSummaries();

  assert.equal(summaries.length, 1);
  assert.equal(summaries[0]?.runtimeId, runtime.id);
  assert.equal(summaries[0]?.title, "正在实时回答");
  assert.deepEqual(db.listConversationMessages(runtime.id), []);
  db.close();
});

test("RuntimeSupervisor keeps persisted titles when live projections only contain an in-flight reply", () => {
  const { db, runtime, projection } = createHarness();
  const supervisor = new RuntimeSupervisor(db, () => undefined);
  db.upsertConversationMessage({
    id: "user-1",
    runtimeId: runtime.id,
    projectId: runtime.projectId,
    role: "user",
    text: "原始用户问题",
    timestamp: 100,
    updatedAt: 100,
  });

  projection.handlePiPayload({ type: "message_update", assistantMessageEvent: { type: "text_delta", delta: "实时回复片段" } });
  (supervisor as unknown as { runtimes: Map<string, unknown> }).runtimes.set(runtime.id, { runtime, projection });

  const summary = supervisor.listRuntimeConversationSummaries()[0];

  assert.equal(summary?.title, "原始用户问题");
  assert.equal(summary?.detail, "实时回复片段");
  assert.equal(summary?.messageCount, 1);
  db.close();
});

test("RuntimeSupervisor exposes queue snapshots through standardized runtime.queue events", () => {
  const { db, runtime, projection } = createHarness();
  const events: ServerEvent[] = [];
  const supervisor = new RuntimeSupervisor(db, (event) => events.push(event));
  const privateSupervisor = supervisor as unknown as {
    runtimes: Map<string, unknown>;
    handlePiPayload(runtimeId: string, payload: unknown): void;
  };
  privateSupervisor.runtimes.set(runtime.id, { runtime, projection });

  privateSupervisor.handlePiPayload(runtime.id, { type: "queue_update", steering: ["adjust"], followUp: ["next", 1] });

  assert.deepEqual(supervisor.listRuntimeQueues(), [
    {
      runtimeId: runtime.id,
      projectId: runtime.projectId,
      queue: { steering: ["adjust"], followUp: ["next"] },
    },
  ]);
  assert.deepEqual(
    events.filter((event) => event.type === "runtime.queue"),
    [
      {
        type: "runtime.queue",
        runtimeId: runtime.id,
        projectId: runtime.projectId,
        queue: { steering: ["adjust"], followUp: ["next"] },
      },
    ],
  );
  db.close();
});

test("ConversationProjection projects tool execution events through normalized events", () => {
  const { db, runtime, projection } = createHarness();

  projection.handlePiPayload({ type: "tool_execution_start", toolCallId: "read-1", toolName: "read" });
  projection.handlePiPayload({ type: "tool_execution_update", toolCallId: "read-1", toolName: "read", partialResult: "loading" });
  projection.handlePiPayload({ type: "tool_execution_end", toolCallId: "read-1", toolName: "read", result: "README.md" });

  const messages = db.listConversationMessages(runtime.id);
  assert.equal(messages.length, 1);
  assert.equal(messages[0]?.id, "tool-read-1");
  assert.equal(messages[0]?.role, "tool");
  assert.equal(messages[0]?.title, "read 完成");
  assert.equal(messages[0]?.text, "README.md");
  assert.equal(messages[0]?.isStreaming, false);
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

test("ConversationProjection keeps multiple runtime streams isolated", () => {
  const dir = mkdtempSync(join(tmpdir(), "pi-gui-conversation-multi-"));
  const db = new AppDatabase(join(dir, "pi-gui.sqlite"));
  const runtimeA: Runtime = { id: "runtime-a", projectId: "project-a", cwd: join(dir, "project-a"), status: "running", pid: 101, startedAt: 1 };
  const runtimeB: Runtime = { id: "runtime-b", projectId: "project-b", cwd: join(dir, "project-b"), status: "running", pid: 102, startedAt: 2 };
  const events: ServerEvent[] = [];

  db.createProject({ id: runtimeA.projectId, name: "Project A", cwd: runtimeA.cwd, lastOpenedAt: 1 });
  db.createProject({ id: runtimeB.projectId, name: "Project B", cwd: runtimeB.cwd, lastOpenedAt: 2 });
  db.upsertRuntime(runtimeA);
  db.upsertRuntime(runtimeB);

  const projectionA = new ConversationProjection(db, () => runtimeA, (event) => events.push(event));
  const projectionB = new ConversationProjection(db, () => runtimeB, (event) => events.push(event));

  projectionA.handlePiPayload({ type: "agent_start" });
  projectionB.handlePiPayload({ type: "message_update", assistantMessageEvent: { type: "text_delta", delta: "B streaming" } });
  projectionA.handlePiPayload({ type: "message_end", message: { id: "assistant-a", role: "assistant", content: "A final", timestamp: 100 } });
  projectionA.handlePiPayload({ type: "agent_end" });

  assert.deepEqual(db.listConversationMessages(runtimeA.id).map((message) => message.text), ["A final"]);
  assert.deepEqual(db.listConversationMessages(runtimeB.id), []);
  assert.equal(projectionB.snapshot()?.type, "conversation.snapshot");
  assert.equal(projectionB.snapshot()?.messages[0]?.text, "B streaming");
  assert.equal(db.getConversationBusy(runtimeA.id), false);
  assert.equal(db.getConversationBusy(runtimeB.id), false);
  assert.ok(events.some((event) => event.type === "conversation.message" && event.message.runtimeId === runtimeA.id && event.message.text === "A final"));
  assert.ok(events.some((event) => event.type === "conversation.delta" && event.delta.runtimeId === runtimeB.id && event.delta.appendText === "B streaming"));
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
