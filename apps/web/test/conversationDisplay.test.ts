import assert from "node:assert/strict";
import test from "node:test";
import type { ConversationMessage, SubagentRun } from "@pi-gui/shared";
import { buildConversationDisplayBlocks } from "../src/domain/conversationDisplay";

function message(overrides: Partial<ConversationMessage>): ConversationMessage {
  return {
    id: "message-1",
    runtimeId: "runtime-1",
    projectId: "project-1",
    role: "assistant",
    text: "",
    timestamp: 1,
    updatedAt: 1,
    ...overrides,
  };
}

function subagentRun(overrides: Partial<SubagentRun> = {}): SubagentRun {
  return {
    id: "runtime-1:subagent-1",
    projectId: "project-1",
    parentRuntimeId: "runtime-1",
    parentToolCallId: "subagent-1",
    parentToolMessageId: "tool-subagent-1",
    agent: "trellis-check",
    mode: "single",
    status: "succeeded",
    startedAt: 1,
    updatedAt: 3,
    runs: [{ id: "trellis-check-1", agent: "trellis-check", status: "succeeded", finalText: "child final" }],
    finalText: "child final",
    ...overrides,
  };
}

test("buildConversationDisplayBlocks folds matching subagent tool into the process group", () => {
  const blocks = buildConversationDisplayBlocks(
    [
      message({ id: "user-1", role: "user", text: "检查一下", timestamp: 1, updatedAt: 1 }),
      message({ id: "tool-subagent-1", role: "tool", title: "trellis_subagent 完成", text: "raw subagent output", timestamp: 2, updatedAt: 2 }),
      message({ id: "tool-read-1", role: "tool", title: "read 完成", text: "README.md", timestamp: 3, updatedAt: 3 }),
    ],
    "normal",
    { subagentRuns: [subagentRun()] },
  );

  const rawBlocks = blocks as Array<{ type: string }>;
  const toolGroups = blocks.filter((block) => block.type === "tool_group");

  assert.equal(rawBlocks.some((block) => block.type === "subagent_group"), false);
  assert.equal(toolGroups.length, 1);
  assert.deepEqual(toolGroups[0]?.subagentRuns.map((run) => run.id), ["runtime-1:subagent-1"]);
  assert.deepEqual(toolGroups[0]?.tools.map((tool) => tool.id), ["tool-read-1"]);
});

test("buildConversationDisplayBlocks keeps ordinary tools grouped when no subagent run matches", () => {
  const blocks = buildConversationDisplayBlocks(
    [
      message({ id: "user-1", role: "user", text: "读文件", timestamp: 1, updatedAt: 1 }),
      message({ id: "tool-read-1", role: "tool", title: "read 完成", text: "README.md", timestamp: 2, updatedAt: 2 }),
    ],
    "normal",
    { subagentRuns: [subagentRun({ parentToolMessageId: "tool-other" })] },
  );

  assert.equal((blocks as Array<{ type: string }>).some((block) => block.type === "subagent_group"), false);
  const toolGroups = blocks.filter((block) => block.type === "tool_group");
  assert.equal(toolGroups.length, 1);
  assert.deepEqual(toolGroups[0]?.tools.map((tool) => tool.id), ["tool-read-1"]);
});

test("buildConversationDisplayBlocks hides synthetic snapshot duplicates of live messages", () => {
  const blocks = buildConversationDisplayBlocks([
    message({ id: "snapshot-0-100", role: "user", text: "同一个问题", timestamp: 100, updatedAt: 110 }),
    message({ id: "user-live", role: "user", text: "同一个问题", timestamp: 100, updatedAt: 101 }),
    message({ id: "assistant-live", role: "assistant", text: "同一个回答", timestamp: 200, updatedAt: 201 }),
    message({ id: "snapshot-1-200", role: "assistant", text: "同一个回答", timestamp: 200, updatedAt: 210 }),
  ]);

  const messageBlocks = blocks.filter((block) => block.type === "message");
  assert.deepEqual(messageBlocks.map((block) => block.message.id), ["user-live", "assistant-live"]);
});

test("buildConversationDisplayBlocks keeps repeated messages with different timestamps", () => {
  const blocks = buildConversationDisplayBlocks([
    message({ id: "snapshot-0-100", role: "user", text: "重复输入", timestamp: 100, updatedAt: 100 }),
    message({ id: "snapshot-1-200", role: "user", text: "重复输入", timestamp: 200, updatedAt: 200 }),
  ]);

  const messageBlocks = blocks.filter((block) => block.type === "message");
  assert.deepEqual(messageBlocks.map((block) => block.message.id), ["snapshot-0-100", "snapshot-1-200"]);
});

test("buildConversationDisplayBlocks splits assistant thinking into the process group before its final answer", () => {
  const blocks = buildConversationDisplayBlocks([
    message({ id: "assistant-1", role: "assistant", text: "最终回答", thinking: "推理过程", timestamp: 100, updatedAt: 100 }),
  ]);

  const toolGroups = blocks.filter((block) => block.type === "tool_group");
  assert.equal(toolGroups.length, 1);
  assert.deepEqual(toolGroups[0]?.thinkingMessages.map((item) => item.id), ["assistant-1"]);

  const messageBlocks = blocks.filter((block) => block.type === "message");
  assert.equal(messageBlocks.length, 1);
  assert.equal(messageBlocks[0]?.message.text, "最终回答");
  assert.equal(messageBlocks[0]?.message.thinking, undefined);
});

test("buildConversationDisplayBlocks still groups thinking-only assistant updates as process state", () => {
  const blocks = buildConversationDisplayBlocks([
    message({ id: "assistant-thinking", role: "assistant", text: "", thinking: "仍在思考", timestamp: 100, updatedAt: 100 }),
  ]);

  const toolGroups = blocks.filter((block) => block.type === "tool_group");
  assert.equal(toolGroups.length, 1);
  assert.deepEqual(toolGroups[0]?.thinkingMessages.map((item) => item.id), ["assistant-thinking"]);
});

test("buildConversationDisplayBlocks merges thinking and subagent runs into one process group", () => {
  const blocks = buildConversationDisplayBlocks(
    [
      message({ id: "user-1", role: "user", text: "检查", timestamp: 1, updatedAt: 1 }),
      message({ id: "assistant-thinking", role: "assistant", text: "我会先分析", thinking: "先分析", timestamp: 2, updatedAt: 2 }),
      message({ id: "tool-subagent-1", role: "tool", title: "trellis_subagent 完成", text: "raw subagent output", timestamp: 3, updatedAt: 3 }),
    ],
    "normal",
    { subagentRuns: [subagentRun()] },
  );

  const toolGroups = blocks.filter((block) => block.type === "tool_group");
  assert.equal(toolGroups.length, 1);
  assert.deepEqual(toolGroups[0]?.thinkingMessages.map((item) => item.id), ["assistant-thinking"]);
  assert.deepEqual(toolGroups[0]?.subagentRuns.map((run) => run.id), ["runtime-1:subagent-1"]);

  const messageBlocks = blocks.filter((block) => block.type === "message");
  assert.equal(messageBlocks.find((block) => block.message.id === "assistant-thinking")?.message.thinking, undefined);
});
