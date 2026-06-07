import assert from "node:assert/strict";
import { mkdtempSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import test from "node:test";
import type { Runtime, ServerEvent } from "@pi-gui/shared";
import { AppDatabase } from "../src/db.js";
import { ConversationProjection } from "../src/runtime/conversationProjection.js";
import { runtimeConversationBusyEvents, runtimeConversationSnapshot } from "../src/runtime/runtimeConversationViews.js";
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

test("runtimeConversationBusyEvents exposes persisted busy state for reconnect seeding", () => {
  const { db, runtime } = createHarness();
  db.setConversationBusy(runtime.id, runtime.projectId, true);
  const idleRuntime: Runtime = {
    id: "runtime-2",
    projectId: "project-1",
    cwd: process.cwd(),
    status: "running",
    pid: 456,
    startedAt: 2,
  };
  db.upsertRuntime(idleRuntime);

  assert.deepEqual(runtimeConversationBusyEvents(db, [runtime, idleRuntime]), [
    { type: "conversation.busy", runtimeId: runtime.id, projectId: runtime.projectId, busy: true },
    { type: "conversation.busy", runtimeId: idleRuntime.id, projectId: idleRuntime.projectId, busy: false },
  ]);
  db.close();
});

test("ConversationProjection appends displayed slash command input as a user message", () => {
  const { db, runtime, events, projection } = createHarness();

  projection.appendUserInput("  /goal ship it  ");

  const messages = db.listConversationMessages(runtime.id);
  assert.equal(messages.length, 1);
  assert.equal(messages[0]?.role, "user");
  assert.equal(messages[0]?.text, "/goal ship it");
  assert.ok(messages[0]?.id.startsWith("user-gui-command-"));
  assert.ok(events.some((event) => event.type === "conversation.message" && event.message.text === "/goal ship it"));
  db.close();
});

test("ConversationProjection folds Pi user echo into displayed GUI prompt input", () => {
  const { db, runtime, projection } = createHarness();

  projection.appendUserInput("继续修复这个问题");
  const displayed = db.listConversationMessages(runtime.id)[0];
  assert.ok(displayed?.id.startsWith("user-gui-command-"));

  projection.handlePiPayload({ type: "message_end", message: { id: "pi-user-1", role: "user", content: "继续修复这个问题", timestamp: Date.now() } });

  const messages = db.listConversationMessages(runtime.id);
  assert.equal(messages.length, 1);
  assert.equal(messages[0]?.id, displayed?.id);
  assert.equal(messages[0]?.text, "继续修复这个问题");
  db.close();
});

test("ConversationProjection folds get_messages user echo into displayed GUI prompt input", () => {
  const { db, runtime, projection } = createHarness();

  projection.appendUserInput("恢复后继续处理");
  const displayed = db.listConversationMessages(runtime.id)[0];
  assert.ok(displayed?.id.startsWith("user-gui-command-"));

  projection.handlePiPayload({
    type: "response",
    command: "get_messages",
    success: true,
    data: {
      messages: [
        { id: "pi-user-1", role: "user", content: "恢复后继续处理", timestamp: Date.now() },
        { id: "assistant-1", role: "assistant", content: "好的", timestamp: Date.now() + 1 },
      ],
    },
  });

  const messages = db.listConversationMessages(runtime.id);
  assert.deepEqual(messages.map((message) => message.id), [displayed?.id, "assistant-1"]);
  assert.deepEqual(messages.map((message) => message.text), ["恢复后继续处理", "好的"]);
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

test("ConversationProjection collapses transient auto-retry errors into the successful assistant message", () => {
  const { db, runtime, projection } = createHarness();

  projection.handlePiPayload({
    type: "message_end",
    message: { id: "assistant-retry", role: "assistant", content: [], timestamp: 100, errorMessage: "Codex SSE response headers timed out after 10000ms" },
  });
  projection.handlePiPayload({ type: "auto_retry_start", attempt: 1, maxAttempts: 3, errorMessage: "Codex SSE response headers timed out after 10000ms" });
  projection.handlePiPayload({ type: "message_start", message: { role: "assistant", content: [], timestamp: 110 } });
  projection.handlePiPayload({ type: "message_update", assistantMessageEvent: { type: "text_delta", delta: "recovered" } });
  projection.handlePiPayload({ type: "message_end", message: { role: "assistant", content: "recovered", timestamp: 110 } });
  projection.handlePiPayload({ type: "auto_retry_end", attempt: 1, success: true });

  const messages = db.listConversationMessages(runtime.id);
  assert.equal(messages.length, 1);
  assert.equal(messages[0]?.id, "assistant-retry");
  assert.equal(messages[0]?.role, "assistant");
  assert.equal(messages[0]?.text, "recovered");
  db.close();
});

test("ConversationProjection keeps a single final error when auto retries do not recover", () => {
  const { db, runtime, projection } = createHarness();

  projection.handlePiPayload({
    type: "message_end",
    message: { id: "assistant-retry", role: "assistant", content: [], timestamp: 100, errorMessage: "Codex SSE response headers timed out after 10000ms" },
  });
  projection.handlePiPayload({ type: "auto_retry_start", attempt: 1, maxAttempts: 3, errorMessage: "Codex SSE response headers timed out after 10000ms" });
  projection.handlePiPayload({
    type: "message_end",
    message: { role: "assistant", content: [], timestamp: 110, errorMessage: "Codex SSE response headers timed out after 10000ms" },
  });

  const messages = db.listConversationMessages(runtime.id);
  assert.equal(messages.length, 1);
  assert.equal(messages[0]?.id, "assistant-retry");
  assert.equal(messages[0]?.role, "error");
  assert.equal(messages[0]?.text, "Codex SSE response headers timed out after 10000ms");
  db.close();
});

test("ConversationProjection reuses retry message for deltas without a message_start", () => {
  const { db, runtime, projection } = createHarness();

  projection.handlePiPayload({
    type: "message_end",
    message: { id: "assistant-retry", role: "assistant", content: [], timestamp: 100, errorMessage: "Codex SSE response headers timed out after 10000ms" },
  });
  projection.handlePiPayload({ type: "auto_retry_start", attempt: 1, maxAttempts: 3, errorMessage: "Codex SSE response headers timed out after 10000ms" });
  projection.handlePiPayload({ type: "message_update", assistantMessageEvent: { type: "text_delta", delta: "recovered" } });
  projection.handlePiPayload({ type: "message_end", message: { role: "assistant", content: "recovered", timestamp: 110 } });

  const messages = db.listConversationMessages(runtime.id);
  assert.equal(messages.length, 1);
  assert.equal(messages[0]?.id, "assistant-retry");
  assert.equal(messages[0]?.role, "assistant");
  assert.equal(messages[0]?.text, "recovered");
  db.close();
});

test("ConversationProjection projects retry-end final errors when no final message arrives", () => {
  const { db, runtime, projection } = createHarness();

  projection.handlePiPayload({
    type: "message_end",
    message: { id: "assistant-retry", role: "assistant", content: [], timestamp: 100, errorMessage: "Codex SSE response headers timed out after 10000ms" },
  });
  projection.handlePiPayload({ type: "auto_retry_start", attempt: 1, maxAttempts: 3, errorMessage: "Codex SSE response headers timed out after 10000ms" });
  projection.handlePiPayload({ type: "auto_retry_end", attempt: 1, success: false, finalError: "Retry cancelled" });

  const messages = db.listConversationMessages(runtime.id);
  assert.equal(messages.length, 1);
  assert.equal(messages[0]?.id, "assistant-retry");
  assert.equal(messages[0]?.role, "error");
  assert.equal(messages[0]?.text, "Retry cancelled");
  db.close();
});

test("ConversationProjection snapshots merge persisted history with live cached output", () => {
  const { db, runtime, projection } = createHarness();
  db.upsertConversationMessage({
    id: "user-1",
    runtimeId: runtime.id,
    projectId: runtime.projectId,
    role: "user",
    text: "此前的交互内容",
    timestamp: 100,
    updatedAt: 100,
  });

  projection.handlePiPayload({ type: "message_update", assistantMessageEvent: { type: "text_delta", delta: "很长输出的实时片段" } });

  const snapshot = projection.snapshot();

  assert.equal(snapshot?.type, "conversation.snapshot");
  assert.deepEqual(snapshot?.messages.map((message) => message.text), ["此前的交互内容", "很长输出的实时片段"]);
  assert.deepEqual(db.listConversationMessages(runtime.id).map((message) => message.text), ["此前的交互内容"]);
  db.close();
});

test("ConversationProjection snapshots report whether older persisted messages exist", () => {
  const { db, runtime, projection } = createHarness();
  for (let index = 1; index <= 3; index += 1) {
    db.upsertConversationMessage({
      id: `message-${index}`,
      runtimeId: runtime.id,
      projectId: runtime.projectId,
      role: "assistant",
      text: `message ${index}`,
      timestamp: index,
      updatedAt: index,
    });
  }

  const partialSnapshot = projection.snapshot(2);
  const fullSnapshot = projection.snapshot(3);

  assert.equal(partialSnapshot?.type, "conversation.snapshot");
  assert.deepEqual(partialSnapshot?.messages.map((message) => message.id), ["message-2", "message-3"]);
  assert.equal(partialSnapshot?.hasMoreBefore, true);
  assert.equal(fullSnapshot?.type, "conversation.snapshot");
  assert.deepEqual(fullSnapshot?.messages.map((message) => message.id), ["message-1", "message-2", "message-3"]);
  assert.equal(fullSnapshot?.hasMoreBefore, false);
  db.close();
});

test("persisted runtime snapshots report whether older messages exist", () => {
  const { db, runtime } = createHarness();
  for (let index = 1; index <= 3; index += 1) {
    db.upsertConversationMessage({
      id: `message-${index}`,
      runtimeId: runtime.id,
      projectId: runtime.projectId,
      role: "user",
      text: `message ${index}`,
      timestamp: index,
      updatedAt: index,
    });
  }

  const partialSnapshot = runtimeConversationSnapshot(db, new Map(), runtime.id, 2);
  const fullSnapshot = runtimeConversationSnapshot(db, new Map(), runtime.id, 3);

  assert.equal(partialSnapshot?.type, "conversation.snapshot");
  assert.deepEqual(partialSnapshot?.messages.map((message) => message.id), ["message-2", "message-3"]);
  assert.equal(partialSnapshot?.hasMoreBefore, true);
  assert.equal(fullSnapshot?.type, "conversation.snapshot");
  assert.equal(fullSnapshot?.hasMoreBefore, false);
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

test("RuntimeSupervisor falls back to linked Pi session file summaries when DB messages are not hydrated", () => {
  const { db, runtime } = createHarness();
  const sessionFile = join(mkdtempSync(join(tmpdir(), "pi-gui-session-summary-")), "session-1.jsonl");
  writeFileSync(
    sessionFile,
    [
      JSON.stringify({ type: "session", id: "session-1", cwd: runtime.cwd }),
      JSON.stringify({ type: "message", id: "user-1", timestamp: "2026-06-03T10:00:00.000Z", message: { role: "user", content: [{ type: "text", text: "侧边栏应该显示这个标题" }] } }),
      JSON.stringify({ type: "message", id: "assistant-1", timestamp: "2026-06-03T10:01:00.000Z", message: { role: "assistant", content: [{ type: "text", text: "侧边栏应该显示这个最新回复" }] } }),
    ].join("\n"),
    "utf8",
  );
  const linkedRuntime = { ...runtime, status: "stopped" as const, sessionId: "session-1", updatedAt: 200 };
  db.upsertRuntime(linkedRuntime);
  db.upsertSession({ id: "session-1", projectId: runtime.projectId, piSessionFile: sessionFile, createdAt: 100, updatedAt: 200, runtimeId: runtime.id });
  const supervisor = new RuntimeSupervisor(db, () => undefined);

  const summary = supervisor.listRuntimeConversationSummaries()[0];

  assert.equal(summary?.runtimeId, runtime.id);
  assert.equal(summary?.title, "侧边栏应该显示这个标题");
  assert.equal(summary?.detail, "侧边栏应该显示这个最新回复");
  assert.equal(summary?.messageCount, 2);
  db.close();
});

test("RuntimeSupervisor keeps indexed session title if the linked Pi session file is unreadable", () => {
  const { db, runtime } = createHarness();
  const linkedRuntime = { ...runtime, status: "stopped" as const, sessionId: "session-missing", updatedAt: 200 };
  db.upsertRuntime(linkedRuntime);
  db.upsertSession({ id: "session-missing", projectId: runtime.projectId, piSessionFile: join(runtime.cwd, "missing.jsonl"), title: "索引里的标题", createdAt: 100, updatedAt: 200, runtimeId: runtime.id });
  const supervisor = new RuntimeSupervisor(db, () => undefined);

  const summary = supervisor.listRuntimeConversationSummaries()[0];

  assert.equal(summary?.runtimeId, runtime.id);
  assert.equal(summary?.title, "索引里的标题");
  assert.equal(summary?.detail, undefined);
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
  assert.equal(summary?.messageCount, 2);
  db.close();
});

test("RuntimeSupervisor exposes queue snapshots through standardized runtime.queue events", () => {
  const { db, runtime, projection } = createHarness();
  const events: ServerEvent[] = [];
  const supervisor = new RuntimeSupervisor(db, (event) => events.push(event));
  const privateSupervisor = supervisor as unknown as {
    runtimes: Map<string, unknown>;
    launcher: { handlePiPayload(runtimeId: string, payload: unknown): void };
  };
  privateSupervisor.runtimes.set(runtime.id, { runtime, projection });

  privateSupervisor.launcher.handlePiPayload(runtime.id, { type: "queue_update", steering: ["adjust"], followUp: ["next", 1] });

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

test("ConversationProjection does not persist synthetic snapshot duplicates for live messages", () => {
  const { db, runtime, projection } = createHarness();

  projection.handlePiPayload({ type: "message_end", message: { id: "user-live", role: "user", content: "同一个问题", timestamp: 100 } });
  projection.handlePiPayload({ type: "message_end", message: { id: "assistant-live", role: "assistant", content: "同一个回答", timestamp: 101 } });
  projection.handlePiPayload({
    type: "response",
    command: "get_messages",
    success: true,
    data: {
      messages: [
        { role: "user", content: "同一个问题", timestamp: 100 },
        { role: "assistant", content: "同一个回答", timestamp: 101 },
      ],
    },
  });

  const messages = db.listConversationMessages(runtime.id);
  assert.deepEqual(messages.map((message) => message.id), ["user-live", "assistant-live"]);
  assert.deepEqual(messages.map((message) => message.text), ["同一个问题", "同一个回答"]);
  db.close();
});

test("AppDatabase lists conversation messages before an anchor without dropping full history", () => {
  const { db, runtime } = createHarness();
  for (let index = 1; index <= 6; index += 1) {
    db.upsertConversationMessage({
      id: `message-${index}`,
      runtimeId: runtime.id,
      projectId: runtime.projectId,
      role: index % 2 === 0 ? "assistant" : "user",
      text: `message ${index}`,
      timestamp: index,
      updatedAt: index,
    });
  }

  const page = db.listConversationMessagesBefore(runtime.id, "message-5", 2);

  assert.deepEqual(page.messages.map((message) => message.id), ["message-3", "message-4"]);
  assert.equal(page.hasMoreBefore, true);
  assert.deepEqual(db.listConversationMessages(runtime.id, 10).map((message) => message.id), ["message-1", "message-2", "message-3", "message-4", "message-5", "message-6"]);
  db.close();
});

test("AppDatabase pages messages with duplicate timestamps using stable insertion ordering", () => {
  const { db, runtime } = createHarness();
  for (const id of ["a", "b", "c", "d"]) {
    db.upsertConversationMessage({
      id,
      runtimeId: runtime.id,
      projectId: runtime.projectId,
      role: "assistant",
      text: id,
      timestamp: 10,
      updatedAt: 10,
    });
  }

  const page = db.listConversationMessagesBefore(runtime.id, "d", 2);

  assert.deepEqual(page.messages.map((message) => message.id), ["b", "c"]);
  assert.equal(page.hasMoreBefore, true);
  db.close();
});

test("ConversationProjection compacts long thinking and cache still serves snapshots from persisted history", () => {
  const { db, runtime, projection } = createHarness();
  for (let index = 0; index < 220; index += 1) {
    projection.handlePiPayload({ type: "message_end", message: { id: `assistant-${index}`, role: "assistant", content: `reply ${index}`, timestamp: index } });
  }
  projection.handlePiPayload({ type: "message_update", assistantMessageEvent: { type: "thinking_delta", delta: "x".repeat(210_000) } });

  const snapshot = projection.snapshot(500);

  assert.equal(snapshot?.type, "conversation.snapshot");
  assert.ok(snapshot.messages.some((message) => message.id === "assistant-0"));
  const live = snapshot.messages.find((message) => message.isStreaming);
  assert.ok((live?.thinking?.length ?? 0) < 205_000);
  assert.match(live?.thinking ?? "", /truncated/);
  assert.equal(db.listConversationMessages(runtime.id, 500).length, 220);
  db.close();
});
