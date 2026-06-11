import type { ConversationDisplayBlock } from "../../domain/conversationDisplay";
import { virtualHeightBefore } from "../../domain/virtualList";

export type ReplyNavigationDirection = "older" | "newer";

export type ReplyAnchor = {
  blockId: string;
  blockIndex: number;
  messageId: string;
  targetBlockId: string;
  targetBlockIndex: number;
  targetMessageId: string;
  summary: string;
};

export type ReplyMarker = {
  anchor: ReplyAnchor;
  anchorIndex: number;
  slotIndex: number;
  isActive: boolean;
  length: "tiny" | "short" | "medium" | "long" | "peak";
};

export type ConversationBlockLayoutMetrics = {
  blockIds: string[];
  blockHeights: number[];
  estimatedBlockHeight: number;
};

export const REPLY_NAVIGATOR_MARKER_COUNT = 9;

export function assistantReplyAnchors(blocks: ConversationDisplayBlock[]): ReplyAnchor[] {
  const anchors: ReplyAnchor[] = [];
  let latestUserTarget: Pick<ReplyAnchor, "targetBlockId" | "targetBlockIndex" | "targetMessageId" | "summary"> | undefined;

  blocks.forEach((block, blockIndex) => {
    if (block.type !== "message") return;

    if (block.message.role === "user") {
      latestUserTarget = {
        targetBlockId: block.id,
        targetBlockIndex: blockIndex,
        targetMessageId: block.message.id,
        summary: summarizeAnchorMessage(block.message.title || block.message.text),
      };
      return;
    }

    if (block.message.role !== "assistant") return;
    const fallbackSummary = summarizeAnchorMessage(block.message.title || block.message.text) || `第 ${anchors.length + 1} 个 LLM 回复`;
    anchors.push({
      blockId: block.id,
      blockIndex,
      messageId: block.message.id,
      targetBlockId: latestUserTarget?.targetBlockId ?? block.id,
      targetBlockIndex: latestUserTarget?.targetBlockIndex ?? blockIndex,
      targetMessageId: latestUserTarget?.targetMessageId ?? block.message.id,
      summary: latestUserTarget?.summary || fallbackSummary,
    });
  });

  return anchors;
}

export function activeReplyAnchorIndex(anchors: ReplyAnchor[], layout: ConversationBlockLayoutMetrics, scrollTop: number): number {
  if (anchors.length === 0) return -1;
  const targetTop = Math.max(0, scrollTop) + ACTIVE_REPLY_TOP_TOLERANCE_PX;
  let low = 0;
  let high = anchors.length;

  while (low < high) {
    const middle = Math.floor((low + high) / 2);
    const offset = replyScrollOffset(anchors[middle]!, layout);
    if (offset <= targetTop) low = middle + 1;
    else high = middle;
  }

  return low - 1;
}

export function adjacentReplyAnchorIndex(activeIndex: number, anchorCount: number, direction: ReplyNavigationDirection): number {
  if (anchorCount <= 0) return -1;
  if (activeIndex < 0) return direction === "newer" ? 0 : -1;
  const nextIndex = direction === "older" ? activeIndex - 1 : activeIndex + 1;
  return clamp(nextIndex, 0, anchorCount - 1);
}

export function replyMarkerWindow(
  anchors: ReplyAnchor[],
  activeIndex: number,
  markerCount = REPLY_NAVIGATOR_MARKER_COUNT,
): ReplyMarker[] {
  if (anchors.length === 0 || markerCount <= 0) return [];
  const safeMarkerCount = Math.max(1, Math.floor(markerCount));
  const centerSlotIndex = Math.floor(safeMarkerCount / 2);
  const safeActiveIndex = clamp(activeIndex >= 0 ? activeIndex : 0, 0, anchors.length - 1);
  const startIndex = Math.max(0, safeActiveIndex - centerSlotIndex);
  const endIndex = Math.min(anchors.length - 1, safeActiveIndex + centerSlotIndex);

  return anchors.slice(startIndex, endIndex + 1).map((anchor, offset) => {
    const anchorIndex = startIndex + offset;
    const slotIndex = centerSlotIndex + anchorIndex - safeActiveIndex;
    const isActive = anchorIndex === safeActiveIndex;
    return {
      anchor,
      anchorIndex,
      slotIndex,
      isActive,
      length: replyMarkerSlotLength(slotIndex, safeMarkerCount),
    };
  });
}

export function blockScrollOffset(layout: ConversationBlockLayoutMetrics, blockIndex: number): number {
  const safeIndex = clamp(Math.floor(blockIndex), 0, layout.blockIds.length);
  return virtualHeightBefore({ itemHeights: layout.blockHeights, itemCount: layout.blockIds.length, index: safeIndex, estimatedItemHeight: layout.estimatedBlockHeight });
}

export function replyScrollOffset(anchor: ReplyAnchor, layout: ConversationBlockLayoutMetrics): number {
  return blockScrollOffset(layout, resolvedLayoutIndex(layout, anchor.targetBlockId, anchor.targetBlockIndex));
}

export function lastUserMessageScrollOffset(blocks: ConversationDisplayBlock[], layout: ConversationBlockLayoutMetrics): number | undefined {
  for (let index = blocks.length - 1; index >= 0; index -= 1) {
    const block = blocks[index];
    if (block?.type !== "message" || block.message.role !== "user") continue;
    return blockScrollOffset(layout, resolvedLayoutIndex(layout, block.id, index));
  }
  return undefined;
}

export function shouldDeferLastUserMessageScrollTarget(input: { loadedMessageCount: number; summaryMessageCount?: number; runtimeHasSession?: boolean }): boolean {
  if (input.loadedMessageCount > 0) return false;
  if (typeof input.summaryMessageCount === "number") return input.summaryMessageCount > 0;
  return input.runtimeHasSession === true;
}

export function stepReplyIndexFromDelta(activeIndex: number, anchorCount: number, delta: number): number {
  if (delta === 0) return activeIndex;
  return adjacentReplyAnchorIndex(activeIndex, anchorCount, delta < 0 ? "older" : "newer");
}

export function replyMarkerSlotLength(offset: number, visibleCount = REPLY_NAVIGATOR_MARKER_COUNT): ReplyMarker["length"] {
  const center = (visibleCount - 1) / 2;
  const distanceFromCenter = Math.abs(offset - center);
  if (distanceFromCenter <= 0.5) return "peak";
  if (distanceFromCenter <= 1.5) return "long";
  if (distanceFromCenter <= 2.5) return "medium";
  if (distanceFromCenter <= 3.5) return "short";
  return "tiny";
}

function summarizeAnchorMessage(text: string | undefined): string {
  const normalized = (text ?? "").replace(/\s+/g, " ").trim();
  if (normalized.length <= ANCHOR_SUMMARY_MAX_CHARS) return normalized;
  return `${normalized.slice(0, ANCHOR_SUMMARY_MAX_CHARS - 1)}…`;
}

function resolvedLayoutIndex(layout: ConversationBlockLayoutMetrics, blockId: string, fallbackIndex: number): number {
  if (layout.blockIds[fallbackIndex] === blockId) return fallbackIndex;
  const layoutIndex = layout.blockIds.indexOf(blockId);
  return layoutIndex >= 0 ? layoutIndex : fallbackIndex;
}

function clamp(value: number, min: number, max: number): number {
  return Math.min(max, Math.max(min, value));
}

const ACTIVE_REPLY_TOP_TOLERANCE_PX = 48;
const ANCHOR_SUMMARY_MAX_CHARS = 72;
