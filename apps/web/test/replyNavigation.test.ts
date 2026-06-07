import assert from "node:assert/strict";
import test from "node:test";
import type { ConversationMessage } from "@pi-gui/shared";
import type { ConversationDisplayBlock } from "../src/domain/conversationDisplay";
import {
  activeReplyAnchorIndex,
  adjacentReplyAnchorIndex,
  assistantReplyAnchors,
  blockScrollOffset,
  replyMarkerWindow,
  replyScrollOffset,
  stepReplyIndexFromDelta,
  type ConversationBlockLayoutMetrics,
  type ReplyAnchor,
} from "../src/components/chat/replyNavigation";

function message(overrides: Partial<ConversationMessage>): ConversationMessage {
  return {
    id: overrides.id ?? "message-1",
    runtimeId: "runtime-1",
    projectId: "project-1",
    role: overrides.role ?? "assistant",
    text: overrides.text ?? "text",
    timestamp: overrides.timestamp ?? 1,
    updatedAt: overrides.updatedAt ?? overrides.timestamp ?? 1,
    ...overrides,
  } as ConversationMessage;
}

function messageBlock(id: string, role: ConversationMessage["role"], text = "text"): ConversationDisplayBlock {
  return {
    type: "message",
    id,
    message: message({ id, role, text }),
    displayKind: role === "assistant" || role === "user" ? "markdown" : "plain",
    isStreaming: false,
  };
}

function layout(blockIds: string[], blockHeights: number[] = blockIds.map(() => 100)): ConversationBlockLayoutMetrics {
  return { blockIds, blockHeights, estimatedBlockHeight: 100 };
}

function anchor(blockId: string, blockIndex: number, targetBlockId = blockId, targetBlockIndex = blockIndex): ReplyAnchor {
  return {
    blockId,
    blockIndex,
    messageId: blockId,
    targetBlockId,
    targetBlockIndex,
    targetMessageId: targetBlockId,
    summary: `用户消息 ${targetBlockId}`,
  };
}

test("assistantReplyAnchors includes only assistant message blocks", () => {
  const blocks: ConversationDisplayBlock[] = [
    messageBlock("user-1", "user", "请解释这个问题"),
    messageBlock("assistant-1", "assistant"),
    {
      type: "tool_group",
      id: "process-group-user-1",
      tools: [],
      thinkingMessages: [],
      subagentRuns: [],
      model: {
        title: "",
        status: "completed",
        statusLabel: "完成",
        summary: "",
        thinkingCount: 0,
        toolCount: 0,
        subagentCount: 0,
        runningCount: 0,
        failedCount: 0,
        completedCount: 0,
        toolNameCounts: [],
        thinking: [],
        tools: [],
        subagents: [],
      },
      isStreaming: false,
    },
    messageBlock("assistant-2", "assistant"),
    messageBlock("tool-1", "tool"),
  ];

  assert.deepEqual(assistantReplyAnchors(blocks), [
    {
      blockId: "assistant-1",
      blockIndex: 1,
      messageId: "assistant-1",
      targetBlockId: "user-1",
      targetBlockIndex: 0,
      targetMessageId: "user-1",
      summary: "请解释这个问题",
    },
    {
      blockId: "assistant-2",
      blockIndex: 3,
      messageId: "assistant-2",
      targetBlockId: "user-1",
      targetBlockIndex: 0,
      targetMessageId: "user-1",
      summary: "请解释这个问题",
    },
  ]);
});

test("activeReplyAnchorIndex chooses the last assistant reply above the scroll position", () => {
  const anchors = [
    anchor("assistant-1", 1, "user-1", 0),
    anchor("assistant-2", 3, "user-2", 2),
    anchor("assistant-3", 5, "user-3", 4),
  ];
  const metrics = layout(["user-1", "assistant-1", "user-2", "assistant-2", "user-3", "assistant-3"]);

  assert.equal(activeReplyAnchorIndex(anchors, metrics, 0), 0);
  assert.equal(activeReplyAnchorIndex(anchors, metrics, 260), 1);
  assert.equal(activeReplyAnchorIndex(anchors, metrics, 600), 2);
});

test("activeReplyAnchorIndex returns no active reply before the first target context", () => {
  const anchors = [anchor("assistant-1", 2, "user-1", 1), anchor("assistant-2", 4, "user-2", 3)];
  const metrics = layout(["intro", "user-1", "assistant-1", "user-2", "assistant-2"]);

  assert.equal(activeReplyAnchorIndex(anchors, metrics, 0), -1);
  assert.equal(activeReplyAnchorIndex(anchors, metrics, 60), 0);
});

test("adjacentReplyAnchorIndex and delta stepping map upward to older and downward to newer", () => {
  assert.equal(adjacentReplyAnchorIndex(2, 5, "older"), 1);
  assert.equal(adjacentReplyAnchorIndex(2, 5, "newer"), 3);
  assert.equal(adjacentReplyAnchorIndex(0, 5, "older"), 0);
  assert.equal(adjacentReplyAnchorIndex(4, 5, "newer"), 4);
  assert.equal(adjacentReplyAnchorIndex(-1, 5, "older"), -1);
  assert.equal(adjacentReplyAnchorIndex(-1, 5, "newer"), 0);
  assert.equal(stepReplyIndexFromDelta(2, 5, -12), 1);
  assert.equal(stepReplyIndexFromDelta(2, 5, 12), 3);
});

test("replyMarkerWindow returns a nine item rolling window near start, middle, and end", () => {
  const anchors = Array.from({ length: 13 }, (_value, index) => anchor(`assistant-${index + 1}`, index));

  const startWindow = replyMarkerWindow(anchors, 0);
  assert.deepEqual(startWindow.map((marker) => marker.anchor.messageId), [
    "assistant-1",
    "assistant-2",
    "assistant-3",
    "assistant-4",
    "assistant-5",
  ]);
  assert.deepEqual(startWindow.map((marker) => marker.slotIndex), [4, 5, 6, 7, 8]);
  assert.deepEqual(replyMarkerWindow(anchors, 6).map((marker) => marker.anchor.messageId), [
    "assistant-3",
    "assistant-4",
    "assistant-5",
    "assistant-6",
    "assistant-7",
    "assistant-8",
    "assistant-9",
    "assistant-10",
    "assistant-11",
  ]);
  const endWindow = replyMarkerWindow(anchors, 12);
  assert.deepEqual(endWindow.map((marker) => marker.anchor.messageId), [
    "assistant-9",
    "assistant-10",
    "assistant-11",
    "assistant-12",
    "assistant-13",
  ]);
  assert.deepEqual(endWindow.map((marker) => marker.slotIndex), [0, 1, 2, 3, 4]);
  const middleWindow = replyMarkerWindow(anchors, 6);
  assert.equal(middleWindow[4]?.isActive, true);
  assert.deepEqual(middleWindow.map((marker) => marker.slotIndex), [0, 1, 2, 3, 4, 5, 6, 7, 8]);
  assert.deepEqual(middleWindow.map((marker) => marker.length), ["tiny", "short", "medium", "long", "peak", "long", "medium", "short", "tiny"]);
  assert.equal(startWindow[0]?.length, "peak");
});

test("scroll offsets use measured heights and fall back to estimated heights", () => {
  const metrics = layout(["user-1", "assistant-1", "tool-1", "assistant-2"], [80, 120, 0, 200]);
  const replyAnchor = anchor("assistant-2", 3, "user-1", 0);

  assert.equal(blockScrollOffset(metrics, 3), 300);
  assert.equal(replyScrollOffset(replyAnchor, metrics), 0);
});

