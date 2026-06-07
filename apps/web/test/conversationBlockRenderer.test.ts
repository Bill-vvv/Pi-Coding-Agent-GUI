import assert from "node:assert/strict";
import { test } from "node:test";
import { createElement } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import type { ConversationMessage } from "@pi-gui/shared";
import { buildConversationDisplayBlocks } from "../src/domain/conversationDisplay";
import { renderBlock } from "../src/components/chat/ConversationBlockRenderer";

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

test("chronological thinking is placed inline but collapsed by default", () => {
  const blocks = buildConversationDisplayBlocks(
    [message({ id: "assistant-thinking", role: "assistant", text: "正文", thinking: "大量思考内容", isStreaming: true })],
    "chronological",
  );
  const block = blocks.find((item) => item.type === "message");
  assert.ok(block);

  const html = renderToStaticMarkup(createElement(() => renderBlock(block)));

  assert.match(html, /chat-message-thinking/);
  assert.match(html, /思考过程（进行中）/);
  assert.doesNotMatch(html, /<details[^>]*open/);
});

test("chronological tool calls are placed inline but collapsed by default", () => {
  const blocks = buildConversationDisplayBlocks(
    [message({ id: "tool-read", role: "tool", title: "read 完成", text: "very long tool output", timestamp: 2, updatedAt: 2 })],
    "chronological",
  );
  const block = blocks.find((item) => item.type === "message");
  assert.ok(block);

  const html = renderToStaticMarkup(createElement(() => renderBlock(block)));

  assert.match(html, /chat-message-tool-call/);
  assert.match(html, /read 完成/);
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
