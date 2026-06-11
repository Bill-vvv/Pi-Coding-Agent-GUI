import assert from "node:assert/strict";
import test from "node:test";
import type { ConversationMessage, SubagentRun } from "@pi-gui/shared";
import { buildConversationDisplayBlocks, buildConversationDisplayBlocksCached, type ConversationDisplayBuildCache } from "../src/domain/conversationDisplay";

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

function cachedBlocks(messages: ConversationMessage[], previous?: ConversationDisplayBuildCache) {
  return buildConversationDisplayBlocksCached(messages, "compact", {}, previous);
}

function subagentRun(overrides: Partial<SubagentRun> = {}): SubagentRun {
  return {
    id: "runtime-1:subagent-1",
    projectId: "project-1",
    parentRuntimeId: "runtime-1",
    parentToolCallId: "subagent-1",
    parentToolMessageId: "tool-subagent-1",
    agent: "review-agent",
    mode: "single",
    status: "succeeded",
    startedAt: 1,
    updatedAt: 3,
    runs: [{ id: "review-agent-1", agent: "review-agent", status: "succeeded", finalText: "child final" }],
    finalText: "child final",
    ...overrides,
  };
}

test("buildConversationDisplayBlocksCached incrementally updates a streaming tail segment", () => {
  const baseMessages = [
    message({ id: "user-1", role: "user", text: "开始", timestamp: 1, updatedAt: 1 }),
    message({ id: "assistant-1", role: "assistant", text: "初稿", timestamp: 2, updatedAt: 2, isStreaming: true }),
  ];
  const initial = cachedBlocks(baseMessages);
  const nextMessages = [baseMessages[0]!, { ...baseMessages[1]!, text: "初稿继续", updatedAt: 3 }];
  const next = cachedBlocks(nextMessages, initial);

  assert.deepEqual(next.blocks, buildConversationDisplayBlocks(nextMessages));
  assert.equal(next.blocks.find((block) => block.type === "message" && block.message.id === "assistant-1")?.message.text, "初稿继续");
});

test("buildConversationDisplayBlocksCached falls back safely when a user turn changes dedupe boundaries", () => {
  const baseMessages = [
    message({ id: "user-gui-command-1", role: "user", text: "继续", timestamp: 1, updatedAt: 1 }),
    message({ id: "assistant-1", role: "assistant", text: "处理中", timestamp: 2, updatedAt: 2 }),
  ];
  const initial = cachedBlocks(baseMessages);
  const nextMessages = [...baseMessages, message({ id: "pi-user-1", role: "user", text: "继续", timestamp: 3, updatedAt: 3 })];
  const next = cachedBlocks(nextMessages, initial);

  assert.deepEqual(next.blocks, buildConversationDisplayBlocks(nextMessages));
});

test("buildConversationDisplayBlocks folds matching subagent tool into the process group", () => {
  const blocks = buildConversationDisplayBlocks(
    [
      message({ id: "user-1", role: "user", text: "检查一下", timestamp: 1, updatedAt: 1 }),
      message({ id: "tool-subagent-1", role: "tool", title: "agent_run 完成", text: "raw subagent output", timestamp: 2, updatedAt: 2 }),
      message({ id: "tool-read-1", role: "tool", title: "read 完成", text: "README.md", timestamp: 3, updatedAt: 3 }),
    ],
    "compact",
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
    "compact",
    { subagentRuns: [subagentRun({ parentToolMessageId: "tool-other" })] },
  );

  assert.equal((blocks as Array<{ type: string }>).some((block) => block.type === "subagent_group"), false);
  const toolGroups = blocks.filter((block) => block.type === "tool_group");
  assert.equal(toolGroups.length, 1);
  assert.deepEqual(toolGroups[0]?.tools.map((tool) => tool.id), ["tool-read-1"]);
});

test("buildConversationDisplayBlocks carries edit diff metadata into tool display models", () => {
  const diff = " 1 before\n-2 old\n+2 new";
  const blocks = buildConversationDisplayBlocks([
    message({
      id: "tool-edit-1",
      role: "tool",
      title: "edit 完成",
      text: "Successfully replaced 1 block(s) in src/example.ts.",
      timestamp: 2,
      updatedAt: 2,
      toolDetails: { path: "src/example.ts", diff, firstChangedLine: 2 },
    }),
  ]);

  const toolGroups = blocks.filter((block) => block.type === "tool_group");
  assert.equal(toolGroups.length, 1);
  assert.equal(toolGroups[0]?.model.tools[0]?.detailLabel, "编辑差异");
  assert.deepEqual(toolGroups[0]?.model.tools[0]?.toolDetails, { path: "src/example.ts", diff, firstChangedLine: 2 });
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

test("buildConversationDisplayBlocks hides synthetic slash command duplicates of Pi user messages", () => {
  const blocks = buildConversationDisplayBlocks([
    message({ id: "user-gui-command-1", role: "user", text: "/goal ship it", timestamp: 100, updatedAt: 100 }),
    message({ id: "pi-user-1", role: "user", text: "/goal ship it", timestamp: 102, updatedAt: 102 }),
    message({ id: "assistant-1", role: "assistant", text: "Goal updated", timestamp: 103, updatedAt: 103 }),
  ]);

  const messageBlocks = blocks.filter((block) => block.type === "message");
  assert.deepEqual(messageBlocks.map((block) => block.message.id), ["pi-user-1", "assistant-1"]);
});

test("buildConversationDisplayBlocks hides synthetic GUI prompt duplicates of Pi user messages", () => {
  const blocks = buildConversationDisplayBlocks([
    message({ id: "user-gui-command-1", role: "user", text: "继续修复这个问题", timestamp: 100, updatedAt: 100 }),
    message({ id: "pi-user-1", role: "user", text: "继续修复这个问题", timestamp: 102, updatedAt: 102 }),
    message({ id: "assistant-1", role: "assistant", thinking: "分析中", timestamp: 103, updatedAt: 103, isStreaming: true }),
  ]);

  const messageBlocks = blocks.filter((block) => block.type === "message");
  assert.deepEqual(messageBlocks.map((block) => block.message.id), ["pi-user-1"]);
});

test("buildConversationDisplayBlocks keeps a repeated synthetic slash command after an earlier Pi message", () => {
  const blocks = buildConversationDisplayBlocks([
    message({ id: "pi-user-1", role: "user", text: "/session", timestamp: 100, updatedAt: 100 }),
    message({ id: "assistant-1", role: "assistant", text: "Stats 1", timestamp: 101, updatedAt: 101 }),
    message({ id: "user-gui-command-2", role: "user", text: "/session", timestamp: 102, updatedAt: 102 }),
  ]);

  const messageBlocks = blocks.filter((block) => block.type === "message");
  assert.deepEqual(messageBlocks.map((block) => block.message.id), ["pi-user-1", "assistant-1", "user-gui-command-2"]);
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

test("buildConversationDisplayBlocks groups assistant thinking before the final answer in chronological mode", () => {
  const blocks = buildConversationDisplayBlocks(
    [message({ id: "assistant-1", role: "assistant", text: "最终回答", thinking: "推理过程", timestamp: 100, updatedAt: 100 })],
    "chronological",
  );

  assert.deepEqual(blocks.map((block) => block.type), ["tool_group", "message"]);
  const toolGroups = blocks.filter((block) => block.type === "tool_group");
  assert.deepEqual(toolGroups[0]?.thinkingMessages.map((item) => item.id), ["assistant-1"]);

  const messageBlocks = blocks.filter((block) => block.type === "message");
  assert.equal(messageBlocks.length, 1);
  assert.equal(messageBlocks[0]?.message.text, "最终回答");
  assert.equal(messageBlocks[0]?.message.thinking, undefined);
});

test("buildConversationDisplayBlocks groups adjacent tools in chronological mode", () => {
  const blocks = buildConversationDisplayBlocks(
    [
      message({ id: "user-1", role: "user", text: "读文件", timestamp: 1, updatedAt: 1 }),
      message({ id: "tool-subagent-1", role: "tool", title: "agent_run 完成", text: "raw subagent output", timestamp: 2, updatedAt: 2 }),
      message({ id: "tool-read-1", role: "tool", title: "read 完成", text: "README.md", timestamp: 3, updatedAt: 3 }),
      message({ id: "assistant-1", role: "assistant", text: "读完了", timestamp: 4, updatedAt: 4 }),
    ],
    "chronological",
    { subagentRuns: [subagentRun()] },
  );

  assert.deepEqual(blocks.map((block) => block.type), ["message", "tool_group", "message"]);
  const toolGroups = blocks.filter((block) => block.type === "tool_group");
  assert.deepEqual(toolGroups[0]?.subagentRuns.map((run) => run.id), ["runtime-1:subagent-1"]);
  assert.deepEqual(toolGroups[0]?.tools.map((tool) => tool.id), ["tool-read-1"]);

  const messageBlocks = blocks.filter((block) => block.type === "message");
  assert.deepEqual(messageBlocks.map((block) => block.message.id), ["user-1", "assistant-1"]);
  assert.deepEqual(messageBlocks.map((block) => block.displayKind), ["markdown", "markdown"]);
});

test("buildConversationDisplayBlocks keeps TUI mode as one event per process item", () => {
  const blocks = buildConversationDisplayBlocks(
    [
      message({ id: "user-1", role: "user", text: "读文件", timestamp: 1, updatedAt: 1 }),
      message({ id: "assistant-thinking", role: "assistant", text: "我会先读", thinking: "先定位文件", timestamp: 2, updatedAt: 2 }),
      message({ id: "tool-read-1", role: "tool", title: "read 完成", text: "README.md", timestamp: 3, updatedAt: 3 }),
      message({ id: "tool-bash-1", role: "tool", title: "bash 完成", text: "ok", timestamp: 4, updatedAt: 4 }),
      message({ id: "assistant-1", role: "assistant", text: "读完了", timestamp: 5, updatedAt: 5 }),
    ],
    "tui",
  );

  assert.deepEqual(blocks.map((block) => block.type), ["message", "tui_process", "message", "tui_process", "tui_process", "message"]);
  const processBlocks = blocks.filter((block) => block.type === "tui_process");
  assert.deepEqual(processBlocks.map((block) => block.model.kind), ["thinking", "tool", "tool"]);
  assert.deepEqual(processBlocks.map((block) => block.model.tool?.name), [undefined, "read", "bash"]);
  assert.equal(processBlocks[0]?.model.thinking?.id, "assistant-thinking-thinking");

  const messageBlocks = blocks.filter((block) => block.type === "message");
  assert.deepEqual(messageBlocks.map((block) => block.message.id), ["user-1", "assistant-thinking", "assistant-1"]);
  assert.equal(messageBlocks.find((block) => block.message.id === "assistant-thinking")?.message.thinking, undefined);
});

test("buildConversationDisplayBlocks maps matching subagent tool to an individual TUI process event", () => {
  const blocks = buildConversationDisplayBlocks(
    [
      message({ id: "tool-subagent-1", role: "tool", title: "agent_run 完成", text: "raw subagent output", timestamp: 2, updatedAt: 2 }),
      message({ id: "tool-read-1", role: "tool", title: "read 完成", text: "README.md", timestamp: 3, updatedAt: 3 }),
    ],
    "tui",
    { subagentRuns: [subagentRun()] },
  );

  const processBlocks = blocks.filter((block) => block.type === "tui_process");
  assert.equal(processBlocks.length, 2);
  assert.deepEqual(processBlocks.map((block) => block.model.kind), ["subagent", "tool"]);
  assert.equal(processBlocks[0]?.model.subagent?.run.id, "runtime-1:subagent-1");
  assert.equal(processBlocks[1]?.model.tool?.name, "read");
});

test("buildConversationDisplayBlocks strips serialized tool-call payloads in chronological mode", () => {
  const blocks = buildConversationDisplayBlocks(
    [
      message({ id: "assistant-tool-call", role: "assistant", text: '{"type":"toolCall","name":"read"}', timestamp: 1, updatedAt: 1 }),
      message({ id: "assistant-answer", role: "assistant", text: '完成 {"type":"toolCall","name":"read"} done', thinking: "先读文件", timestamp: 2, updatedAt: 2 }),
    ],
    "chronological",
  );

  const toolGroups = blocks.filter((block) => block.type === "tool_group");
  assert.equal(toolGroups.length, 1);
  assert.deepEqual(toolGroups[0]?.thinkingMessages.map((item) => item.id), ["assistant-answer"]);

  const messageBlocks = blocks.filter((block) => block.type === "message");
  assert.deepEqual(messageBlocks.map((block) => block.message.id), ["assistant-answer"]);
  assert.equal(messageBlocks[0]?.message.text, "完成 done");
  assert.equal(messageBlocks[0]?.message.thinking, undefined);
});

test("buildConversationDisplayBlocks merges thinking and subagent runs into one process group", () => {
  const blocks = buildConversationDisplayBlocks(
    [
      message({ id: "user-1", role: "user", text: "检查", timestamp: 1, updatedAt: 1 }),
      message({ id: "assistant-thinking", role: "assistant", text: "我会先分析", thinking: "先分析", timestamp: 2, updatedAt: 2 }),
      message({ id: "tool-subagent-1", role: "tool", title: "agent_run 完成", text: "raw subagent output", timestamp: 3, updatedAt: 3 }),
    ],
    "compact",
    { subagentRuns: [subagentRun()] },
  );

  const toolGroups = blocks.filter((block) => block.type === "tool_group");
  assert.equal(toolGroups.length, 1);
  assert.deepEqual(toolGroups[0]?.thinkingMessages.map((item) => item.id), ["assistant-thinking"]);
  assert.deepEqual(toolGroups[0]?.subagentRuns.map((run) => run.id), ["runtime-1:subagent-1"]);

  const messageBlocks = blocks.filter((block) => block.type === "message");
  assert.equal(messageBlocks.find((block) => block.message.id === "assistant-thinking")?.message.thinking, undefined);
});
