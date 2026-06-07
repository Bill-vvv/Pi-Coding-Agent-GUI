import assert from "node:assert/strict";
import test from "node:test";
import type { ConversationMessage, Runtime, RuntimeConversationSummary } from "@pi-gui/shared";
import { moveOrderedId, normalizeProjectOrder, normalizeSessionOrderByProject, orderedById } from "../src/components/sidebar/sidebarOrdering";
import { completedAssistantReplyAt, sessionDotState, sessionDotTitle } from "../src/components/sidebar/sidebarUnread";

test("sidebar ordering normalizes persisted project order without losing new ids", () => {
  assert.deepEqual(normalizeProjectOrder(["stale", "b", "a"], ["a", "b", "c"]), ["b", "a", "c"]);
});

test("sidebar ordering keeps object order from persisted ids and appends missing items", () => {
  const items = [{ id: "a" }, { id: "b" }, { id: "c" }];
  assert.deepEqual(orderedById(items, ["c", "a"]).map((item) => item.id), ["c", "a", "b"]);
});

test("sidebar drag ordering moves ids relative to normalized visible order", () => {
  assert.deepEqual(moveOrderedId(["b", "a"], ["a", "b", "c"], "c", "b", "before"), ["c", "b", "a"]);
  assert.deepEqual(moveOrderedId(["b", "a", "c"], ["a", "b", "c"], "b", "c", "after"), ["a", "c", "b"]);
});

test("sidebar session order normalization removes stale projects and sessions", () => {
  const runtimeIdsByProject = new Map<string, string[]>([
    ["p1", ["r1", "r2"]],
    ["p2", ["r3"]],
  ]);

  assert.deepEqual(normalizeSessionOrderByProject({ p1: ["stale", "r2"], old: ["gone"] }, ["p1", "p2"], runtimeIdsByProject), {
    p1: ["r2", "r1"],
    p2: ["r3"],
  });
});

test("sidebar unread derivation prefers latest completed assistant timestamp", () => {
  const messages: ConversationMessage[] = [
    { id: "m1", role: "assistant", text: "old", timestamp: 10, isStreaming: false },
    { id: "m2", role: "assistant", text: "streaming", timestamp: 20, isStreaming: true },
    { id: "m3", role: "assistant", text: "done", timestamp: 30, updatedAt: 40, isStreaming: false },
  ];

  assert.equal(completedAssistantReplyAt(undefined, messages), 40);
});

test("sidebar unread derivation falls back to summary update only for non-trivial conversations", () => {
  const summary: RuntimeConversationSummary = {
    runtimeId: "r1",
    projectId: "p1",
    updatedAt: 50,
    messageCount: 2,
  };

  assert.equal(completedAssistantReplyAt(summary, undefined), 50);
  assert.equal(completedAssistantReplyAt({ ...summary, messageCount: 1 }, undefined), undefined);
});

test("sidebar session dot state and title classify busy unread and crashed runtimes", () => {
  const runtime: Runtime = { id: "r1", projectId: "p1", cwd: "/tmp", status: "running", startedAt: 1 };

  assert.equal(sessionDotState(runtime, true, true), "task-busy");
  assert.equal(sessionDotState(runtime, false, true), "task-unread");
  assert.equal(sessionDotTitle("running", "task-unread"), "有未读回复，点击查看");
  assert.equal(sessionDotState({ ...runtime, status: "crashed" }, false, true), "crashed");
  assert.equal(sessionDotState({ ...runtime, status: "crashed" }, false, true, true), "recoverable");
  assert.equal(sessionDotTitle("crashed", "recoverable"), "GUI 已重启，可恢复会话");
});
