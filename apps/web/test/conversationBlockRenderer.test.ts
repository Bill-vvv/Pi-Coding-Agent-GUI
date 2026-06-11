import assert from "node:assert/strict";
import { test } from "node:test";
import { createElement } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import type { ConversationMessage, SubagentRun } from "@pi-gui/shared";
import { buildConversationDisplayBlocks } from "../src/domain/conversationDisplay";
import { renderBlock } from "../src/components/chat/ConversationBlockRenderer";
import { SubagentProcessDetail } from "../src/components/chat/SubagentProcessBlock";

function message(overrides: Partial<ConversationMessage>): ConversationMessage {
  return {
    id: overrides.id ?? "m1",
    runtimeId: "r1",
    projectId: "p1",
    role: overrides.role ?? "assistant",
    text: overrides.text ?? "",
    timestamp: overrides.timestamp ?? 1,
    updatedAt: overrides.updatedAt ?? overrides.timestamp ?? 1,
    ...overrides,
  } as ConversationMessage;
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
    status: "running",
    startedAt: 100,
    updatedAt: 200,
    runs: [
      {
        id: "review-agent-1",
        agent: "review-agent",
        status: "running",
        startedAt: 110,
        finalText: "子代理输出\n\n```ts\nconst subagentValue = 1;\n```",
      },
    ],
    ...overrides,
  };
}

test("chronological thinking reuses the collapsed process group renderer", () => {
  const blocks = buildConversationDisplayBlocks(
    [message({ id: "assistant-thinking", role: "assistant", text: "正文", thinking: "大量思考内容", isStreaming: true })],
    "chronological",
  );
  const block = blocks.find((item) => item.type === "tool_group");
  assert.ok(block);

  const html = renderToStaticMarkup(createElement(() => renderBlock(block)));

  assert.match(html, /tool-group-details running/);
  assert.match(html, /思考/);
  assert.doesNotMatch(html, /<details[^>]*open/);
});

test("chronological tool calls reuse the collapsed process group renderer", () => {
  const blocks = buildConversationDisplayBlocks(
    [message({ id: "tool-read", role: "tool", title: "read 完成", text: "very long tool output", timestamp: 2, updatedAt: 2 })],
    "chronological",
  );
  const block = blocks.find((item) => item.type === "tool_group");
  assert.ok(block);

  const html = renderToStaticMarkup(createElement(() => renderBlock(block)));

  assert.match(html, /tool-group-details completed/);
  assert.match(html, /read/);
  assert.doesNotMatch(html, /<details[^>]*open/);
});

test("TUI process events render through the dedicated transcript row", () => {
  const blocks = buildConversationDisplayBlocks(
    [message({ id: "tool-read", role: "tool", title: "read 完成", text: "very long tool output", timestamp: 2, updatedAt: 2 })],
    "tui",
  );
  const block = blocks.find((item) => item.type === "tui_process");
  assert.ok(block);

  const html = renderToStaticMarkup(createElement(() => renderBlock(block)));

  assert.match(html, /tui-process-details completed/);
  assert.match(html, /read/);
  assert.doesNotMatch(html, /<details[^>]*open/);
});

test("compact process groups also stay collapsed until the user expands them", () => {
  const blocks = buildConversationDisplayBlocks(
    [message({ id: "assistant-thinking", role: "assistant", text: "", thinking: "仍在思考", isStreaming: true })],
    "compact",
    { activeRuntimeIsBusy: true },
  );
  const block = blocks.find((item) => item.type === "tool_group");
  assert.ok(block);

  const html = renderToStaticMarkup(createElement(() => renderBlock(block)));

  assert.match(html, /tool-group-details running/);
  assert.doesNotMatch(html, /<details[^>]*open/);
});

test("edit tool details render a TUI-style diff instead of only the success text", () => {
  const blocks = buildConversationDisplayBlocks([
    message({
      id: "tool-edit-1",
      role: "tool",
      title: "edit 完成",
      text: "Successfully replaced 1 block(s) in src/example.ts.",
      timestamp: 2,
      updatedAt: 2,
      toolDetails: {
        path: "src/example.ts",
        diff: " 1 const value = oldValue;\n-2 oldValue();\n+2 newValue();",
        firstChangedLine: 2,
      },
    }),
  ]);
  const block = blocks.find((item) => item.type === "tool_group");
  assert.ok(block);

  const html = renderToStaticMarkup(createElement(() => renderBlock(block)));

  assert.match(html, /tool-diff/);
  assert.match(html, /src\/example.ts/);
  assert.match(html, /tool-diff-line removed/);
  assert.match(html, /oldValue\(\)/);
  assert.match(html, /tool-diff-line added/);
  assert.match(html, /newValue\(\)/);
  assert.match(html, /Successfully replaced 1 block/);
});

test("streaming thinking content keeps the full markdown path in grouped process rendering", () => {
  const blocks = buildConversationDisplayBlocks(
    [message({ id: "assistant-thinking", role: "assistant", text: "正文", thinking: "思考中\n\n```ts\nconst thought = 1;\n```", isStreaming: true })],
    "chronological",
  );
  const block = blocks.find((item) => item.type === "tool_group");
  assert.ok(block);

  const html = renderToStaticMarkup(createElement(() => renderBlock(block)));

  assert.doesNotMatch(html, /large-markdown-preview/);
  assert.match(html, /const thought = 1;/);
  assert.match(html, /markdown-code-block/);
});

test("subagent detail rendering keeps the full markdown path for streaming markdown output", () => {
  const html = renderToStaticMarkup(createElement(SubagentProcessDetail, {
    run: subagentRun(),
    actions: {},
    active: true,
  }));

  assert.doesNotMatch(html, /large-markdown-preview/);
  assert.match(html, /const subagentValue = 1;/);
  assert.match(html, /markdown-code-block/);
});
