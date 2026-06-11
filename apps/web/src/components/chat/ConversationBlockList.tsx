import { memo, useCallback, useEffect, useLayoutEffect, useMemo, useRef, useState, type ReactNode, type RefObject } from "react";
import type { SubagentRun } from "@pi-gui/shared";
import { buildConversationDisplayBlocks, type ConversationDisplayBlock, type ConversationDisplayMode } from "../../domain/conversationDisplay";
import { observeElementResize } from "../../domain/resizeObserver";
import { estimateVirtualRange, virtualHeightBefore } from "../../domain/virtualList";
import type { ConversationMessage } from "../../types";
import { renderBlock } from "./ConversationBlockRenderer";
import type { ConversationBlockActions } from "./types";
import type { ConversationBlockLayoutMetrics } from "./replyNavigation";

export const VirtualConversationBlockList = memo(function VirtualConversationBlockList({
  blocks,
  surfaceRef,
  actions,
  onLayoutChange,
  onLayoutMetricsChange,
  navigationOverscanSignal,
}: {
  blocks: ConversationDisplayBlock[];
  surfaceRef: RefObject<HTMLDivElement | null>;
  actions: ConversationBlockActions;
  onLayoutChange?: () => void;
  onLayoutMetricsChange?: (metrics: ConversationBlockLayoutMetrics) => void;
  navigationOverscanSignal?: number;
}) {
  const heightByBlockIdRef = useRef<Map<string, number>>(new Map());
  const latestEstimatedHeightsRef = useRef<number[]>([]);
  const lastLayoutMetricsRef = useRef<ConversationBlockLayoutMetrics | undefined>(undefined);
  const estimatedHeightsCacheRef = useRef<EstimatedConversationHeightsCache | undefined>(undefined);
  const lastViewportSampleRef = useRef<{ scrollTop: number; sampledAt: number } | undefined>(undefined);
  const viewportFrameRef = useRef<number | undefined>(undefined);
  const viewportSettleTimerRef = useRef<number | undefined>(undefined);
  const measurementFrameRef = useRef<number | undefined>(undefined);
  const navigationOverscanTimerRef = useRef<number | undefined>(undefined);
  const [measurementRevision, setMeasurementRevision] = useState(0);
  const [viewport, setViewport] = useState<ConversationViewportState>({ scrollTop: 0, height: 640, scrollVelocity: 0 });
  const [navigationOverscanActive, setNavigationOverscanActive] = useState(false);

  const updateViewport = useCallback(() => {
    const surface = surfaceRef.current;
    if (!surface) return;
    const sampledAt = performance.now();
    const previousSample = lastViewportSampleRef.current;
    const nextScrollTop = surface.scrollTop;
    const elapsedMs = previousSample ? Math.max(1, sampledAt - previousSample.sampledAt) : 0;
    const scrollVelocity = previousSample ? Math.abs(nextScrollTop - previousSample.scrollTop) / elapsedMs : 0;
    lastViewportSampleRef.current = { scrollTop: nextScrollTop, sampledAt };
    const nextViewport = { scrollTop: nextScrollTop, height: surface.clientHeight || 640, scrollVelocity };
    setViewport((current) =>
      current.scrollTop === nextViewport.scrollTop && current.height === nextViewport.height && Math.abs(current.scrollVelocity - nextViewport.scrollVelocity) < 0.05 ? current : nextViewport,
    );
  }, [surfaceRef]);

  const requestViewportUpdate = useCallback(() => {
    if (viewportSettleTimerRef.current !== undefined) {
      window.clearTimeout(viewportSettleTimerRef.current);
      viewportSettleTimerRef.current = undefined;
    }
    if (viewportFrameRef.current !== undefined) return;
    viewportFrameRef.current = window.requestAnimationFrame(() => {
      viewportFrameRef.current = undefined;
      updateViewport();
      viewportSettleTimerRef.current = window.setTimeout(() => {
        viewportSettleTimerRef.current = undefined;
        updateViewport();
      }, SCROLL_VELOCITY_SETTLE_MS);
    });
  }, [updateViewport]);

  useLayoutEffect(() => {
    const surface = surfaceRef.current;
    if (!surface) return;
    updateViewport();
    surface.addEventListener("scroll", requestViewportUpdate, { passive: true });
    window.addEventListener("resize", requestViewportUpdate);
    const disconnectResizeObserver = observeElementResize(surface, requestViewportUpdate);
    return () => {
      surface.removeEventListener("scroll", requestViewportUpdate);
      window.removeEventListener("resize", requestViewportUpdate);
      disconnectResizeObserver();
    };
  }, [requestViewportUpdate, surfaceRef, updateViewport]);

  useEffect(() => {
    return () => {
      if (viewportFrameRef.current !== undefined) window.cancelAnimationFrame(viewportFrameRef.current);
      if (viewportSettleTimerRef.current !== undefined) window.clearTimeout(viewportSettleTimerRef.current);
      if (measurementFrameRef.current !== undefined) window.cancelAnimationFrame(measurementFrameRef.current);
      if (navigationOverscanTimerRef.current !== undefined) window.clearTimeout(navigationOverscanTimerRef.current);
    };
  }, []);

  useLayoutEffect(() => {
    if (navigationOverscanSignal === undefined) return;
    updateViewport();
    setNavigationOverscanActive(true);
    if (navigationOverscanTimerRef.current !== undefined) window.clearTimeout(navigationOverscanTimerRef.current);
    navigationOverscanTimerRef.current = window.setTimeout(() => {
      navigationOverscanTimerRef.current = undefined;
      setNavigationOverscanActive(false);
    }, NAVIGATION_OVERSCAN_SETTLE_MS);
  }, [navigationOverscanSignal, updateViewport]);

  useLayoutEffect(() => {
    updateViewport();
    const frame = window.requestAnimationFrame(updateViewport);
    return () => window.cancelAnimationFrame(frame);
  }, [blocks.length, measurementRevision, updateViewport]);

  const estimatedHeights = useMemo(() => {
    const cache = cachedEstimatedConversationHeights(blocks, heightByBlockIdRef.current, estimatedHeightsCacheRef.current);
    estimatedHeightsCacheRef.current = cache;
    return cache.heights;
  }, [blocks, measurementRevision]);
  latestEstimatedHeightsRef.current = estimatedHeights;

  useEffect(() => {
    const currentBlockIds = new Set(blocks.map((block) => block.id));
    for (const blockId of heightByBlockIdRef.current.keys()) {
      if (!currentBlockIds.has(blockId)) heightByBlockIdRef.current.delete(blockId);
    }
  }, [blocks]);

  useLayoutEffect(() => {
    if (!onLayoutMetricsChange) return;
    const metrics = {
      blockIds: blocks.map((block) => block.id),
      blockHeights: estimatedHeights,
      estimatedBlockHeight: ESTIMATED_CONVERSATION_BLOCK_HEIGHT,
    };
    if (sameLayoutMetrics(lastLayoutMetricsRef.current, metrics)) return;
    lastLayoutMetricsRef.current = metrics;
    onLayoutMetricsChange(metrics);
  }, [blocks, estimatedHeights, onLayoutMetricsChange]);

  const overscan = conversationBlockOverscan(viewport.scrollVelocity, navigationOverscanActive);
  const virtualRange = estimateVirtualRange({
    itemCount: blocks.length,
    scrollTop: viewport.scrollTop,
    viewportHeight: viewport.height,
    itemHeights: estimatedHeights,
    estimatedItemHeight: overscanUnitHeight(estimatedHeights),
    overscan,
  });
  const visibleBlocks = virtualRange.endIndex >= virtualRange.startIndex ? blocks.slice(virtualRange.startIndex, virtualRange.endIndex + 1) : [];

  const requestMeasurementRevision = useCallback(() => {
    if (measurementFrameRef.current !== undefined) return;
    measurementFrameRef.current = window.requestAnimationFrame(() => {
      measurementFrameRef.current = undefined;
      setMeasurementRevision((value) => value + 1);
      onLayoutChange?.();
    });
  }, [onLayoutChange]);

  const handleRowMeasure = useCallback((blockId: string, index: number, height: number) => {
    if (height <= 0) return;
    const estimatedHeights = latestEstimatedHeightsRef.current;
    const previousHeight = heightByBlockIdRef.current.get(blockId) ?? estimatedHeights[index] ?? ESTIMATED_CONVERSATION_BLOCK_HEIGHT;
    const delta = height - previousHeight;
    if (Math.abs(delta) <= 1) return;
    const surface = surfaceRef.current;
    heightByBlockIdRef.current.set(blockId, height);
    const cache = estimatedHeightsCacheRef.current;
    if (cache?.blocks[index]?.id === blockId) {
      const heights = [...cache.heights];
      heights[index] = height;
      estimatedHeightsCacheRef.current = { blocks: cache.blocks, heights };
      latestEstimatedHeightsRef.current = heights;
    }
    if (surface && rowIsFullyAboveViewport(estimatedHeights, index, previousHeight, surface.scrollTop)) {
      surface.scrollTop = Math.max(0, surface.scrollTop + delta);
      lastViewportSampleRef.current = { scrollTop: surface.scrollTop, sampledAt: performance.now() };
    }
    requestMeasurementRevision();
  }, [requestMeasurementRevision, surfaceRef]);

  return (
    <>
      {virtualRange.beforeHeight > 0 ? <div aria-hidden="true" style={{ height: virtualRange.beforeHeight }} /> : null}
      {visibleBlocks.map((block, offset) => {
        const index = virtualRange.startIndex + offset;
        return (
          <VirtualConversationRow actions={actions} block={block} index={index} key={block.id} onMeasure={handleRowMeasure} />
        );
      })}
      {virtualRange.afterHeight > 0 ? <div aria-hidden="true" style={{ height: virtualRange.afterHeight }} /> : null}
    </>
  );
});

const VirtualConversationRow = memo(function VirtualConversationRow({
  actions,
  block,
  index,
  onMeasure,
}: {
  actions: ConversationBlockActions;
  block: ConversationDisplayBlock;
  index: number;
  onMeasure: (blockId: string, index: number, height: number) => void;
}) {
  return (
    <MeasuredVirtualRow blockId={block.id} index={index} onMeasure={onMeasure}>
      {renderBlock(block, actions)}
    </MeasuredVirtualRow>
  );
});

function MeasuredVirtualRow({ blockId, index, onMeasure, children }: { blockId: string; index: number; onMeasure: (blockId: string, index: number, height: number) => void; children: ReactNode }) {
  const rowRef = useRef<HTMLDivElement | null>(null);
  const measureRow = useCallback((entry?: ResizeObserverEntry) => {
    const element = rowRef.current;
    if (!element) return;
    onMeasure(blockId, index, resizeObserverEntryHeight(entry) ?? element.getBoundingClientRect().height);
  }, [blockId, index, onMeasure]);

  useLayoutEffect(() => {
    measureRow();
  });

  useLayoutEffect(() => {
    const element = rowRef.current;
    if (!element) return;
    return observeElementResize(element, (entries) => measureRow(entries[0]));
  }, [measureRow]);

  return (
    <div className="conversation-virtual-row" data-virtual-index={index} ref={rowRef}>
      {children}
    </div>
  );
}

export function ConversationBlockList({
  messages,
  displayMode = "compact",
  activeRuntimeIsBusy = false,
  subagentRuns = [],
  onOpenSubagentRun,
  onCopySubagentOutput,
}: {
  messages: ConversationMessage[];
  displayMode?: ConversationDisplayMode;
  activeRuntimeIsBusy?: boolean;
  subagentRuns?: SubagentRun[];
  onOpenSubagentRun?: (runId: string) => void;
  onCopySubagentOutput?: (run: SubagentRun) => void;
}) {
  const blocks = buildConversationDisplayBlocks(messages, displayMode, { activeRuntimeIsBusy, subagentRuns });
  return <>{blocks.map((block) => renderBlock(block, { onOpenSubagentRun, onCopySubagentOutput }))}</>;
}

type ConversationViewportState = {
  scrollTop: number;
  height: number;
  scrollVelocity: number;
};

type EstimatedConversationHeightsCache = {
  blocks: ConversationDisplayBlock[];
  heights: number[];
};

function sameLayoutMetrics(left: ConversationBlockLayoutMetrics | undefined, right: ConversationBlockLayoutMetrics): boolean {
  if (!left) return false;
  return left.estimatedBlockHeight === right.estimatedBlockHeight && sameStringArray(left.blockIds, right.blockIds) && sameNumberArray(left.blockHeights, right.blockHeights);
}

function sameStringArray(left: string[], right: string[]): boolean {
  if (left.length !== right.length) return false;
  return left.every((value, index) => value === right[index]);
}

function sameNumberArray(left: number[], right: number[]): boolean {
  if (left.length !== right.length) return false;
  return left.every((value, index) => value === right[index]);
}

function cachedEstimatedConversationHeights(
  blocks: ConversationDisplayBlock[],
  measuredHeights: Map<string, number>,
  previous: EstimatedConversationHeightsCache | undefined,
): EstimatedConversationHeightsCache {
  if (previous?.blocks === blocks) return previous;

  const startIndex = incrementalHeightEstimateStartIndex(previous?.blocks, blocks);
  if (previous && startIndex !== undefined) {
    const heights = previous.heights.slice(0, startIndex);
    for (let index = startIndex; index < blocks.length; index += 1) heights.push(measuredHeights.get(blocks[index]!.id) ?? estimateConversationBlockHeight(blocks[index]!));
    return { blocks, heights };
  }

  return { blocks, heights: blocks.map((block) => measuredHeights.get(block.id) ?? estimateConversationBlockHeight(block)) };
}

function incrementalHeightEstimateStartIndex(previousBlocks: ConversationDisplayBlock[] | undefined, blocks: ConversationDisplayBlock[]): number | undefined {
  if (!previousBlocks || previousBlocks.length === 0) return undefined;
  if (blocks.length === previousBlocks.length) {
    const lastIndex = blocks.length - 1;
    return previousBlocks[lastIndex] !== blocks[lastIndex] && (lastIndex === 0 || previousBlocks[lastIndex - 1] === blocks[lastIndex - 1]) ? lastIndex : undefined;
  }
  if (blocks.length > previousBlocks.length && previousBlocks[previousBlocks.length - 1] === blocks[previousBlocks.length - 1]) return previousBlocks.length;
  return undefined;
}

function estimateConversationBlockHeight(block: ConversationDisplayBlock): number {
  if (block.type === "tool_group") {
    const processCount = block.tools.length + block.thinkingMessages.length + block.subagentRuns.length;
    return clampHeight(150 + processCount * 28 + (block.model.current?.content ? estimateTextHeight(block.model.current.content, { collapsed: true }) : 0));
  }

  if (block.type === "tui_process") {
    return clampHeight(72 + estimateTextHeight(block.model.summary || block.model.detail, { collapsed: true }));
  }

  const message = block.message;
  const contentHeight = estimateTextHeight(message.text, { role: message.role });
  const thinkingHeight = message.thinking ? 58 : 0;
  const titleHeight = message.title ? 24 : 0;
  const statusHeight = message.isStreaming ? 24 : 0;
  return clampHeight(44 + titleHeight + contentHeight + thinkingHeight + statusHeight);
}

function estimateTextHeight(text: string | undefined, options: { collapsed?: boolean; role?: ConversationMessage["role"] } = {}): number {
  if (!text) return 0;
  if (options.collapsed) return Math.min(180, 34 + lineCount(text) * 6 + Math.ceil(text.length / 240) * 18);
  const lineHeight = options.role === "user" ? 22 : 20;
  const explicitLines = lineCount(text);
  const wrappedLines = Math.ceil(text.length / (options.role === "user" ? 58 : 96));
  const fencedBlocks = fencedCodeBlockCount(text);
  return Math.min(4_800, Math.max(explicitLines, wrappedLines) * lineHeight + fencedBlocks * 48);
}

function lineCount(text: string): number {
  return text ? text.split(/\r?\n/).length : 0;
}

function fencedCodeBlockCount(text: string): number {
  return Math.ceil((text.match(/```/g)?.length ?? 0) / 2);
}

function clampHeight(height: number): number {
  return Math.max(MIN_ESTIMATED_CONVERSATION_BLOCK_HEIGHT, Math.min(MAX_ESTIMATED_CONVERSATION_BLOCK_HEIGHT, Math.ceil(height)));
}

function overscanUnitHeight(heights: number[]): number {
  if (heights.length === 0) return ESTIMATED_CONVERSATION_BLOCK_HEIGHT;
  const sample = heights.slice(0, MAX_OVERSCAN_HEIGHT_SAMPLE_ITEMS).sort((left, right) => left - right);
  const median = sample[Math.floor(sample.length / 2)] ?? ESTIMATED_CONVERSATION_BLOCK_HEIGHT;
  return Math.max(MIN_OVERSCAN_UNIT_HEIGHT, Math.min(MAX_OVERSCAN_UNIT_HEIGHT, median));
}

function conversationBlockOverscan(scrollVelocity: number, navigationOverscanActive: boolean): number {
  if (navigationOverscanActive) return NAVIGATION_CONVERSATION_BLOCK_OVERSCAN;
  if (scrollVelocity >= VERY_FAST_SCROLL_PX_PER_MS) return VERY_FAST_CONVERSATION_BLOCK_OVERSCAN;
  if (scrollVelocity >= FAST_SCROLL_PX_PER_MS) return FAST_CONVERSATION_BLOCK_OVERSCAN;
  if (scrollVelocity >= MEDIUM_SCROLL_PX_PER_MS) return MEDIUM_CONVERSATION_BLOCK_OVERSCAN;
  return CONVERSATION_BLOCK_OVERSCAN;
}

function rowIsFullyAboveViewport(heights: number[], index: number, rowHeight: number, scrollTop: number): boolean {
  const offset = virtualHeightBefore({ itemHeights: heights, itemCount: heights.length, index, estimatedItemHeight: ESTIMATED_CONVERSATION_BLOCK_HEIGHT });
  return offset + rowHeight <= scrollTop;
}

function resizeObserverEntryHeight(entry: ResizeObserverEntry | undefined): number | undefined {
  if (!entry) return undefined;
  const borderBox = Array.isArray(entry.borderBoxSize) ? entry.borderBoxSize[0] : entry.borderBoxSize;
  const borderBoxHeight = borderBox?.blockSize;
  if (typeof borderBoxHeight === "number" && Number.isFinite(borderBoxHeight) && borderBoxHeight > 0) return borderBoxHeight;
  const contentHeight = entry.contentRect.height;
  return Number.isFinite(contentHeight) && contentHeight > 0 ? contentHeight : undefined;
}

const ESTIMATED_CONVERSATION_BLOCK_HEIGHT = 220;
const MIN_ESTIMATED_CONVERSATION_BLOCK_HEIGHT = 96;
const MAX_ESTIMATED_CONVERSATION_BLOCK_HEIGHT = 4_800;
const CONVERSATION_BLOCK_OVERSCAN = 8;
const MEDIUM_CONVERSATION_BLOCK_OVERSCAN = 14;
const FAST_CONVERSATION_BLOCK_OVERSCAN = 22;
const VERY_FAST_CONVERSATION_BLOCK_OVERSCAN = 32;
const NAVIGATION_CONVERSATION_BLOCK_OVERSCAN = 24;
const MEDIUM_SCROLL_PX_PER_MS = 0.9;
const FAST_SCROLL_PX_PER_MS = 1.8;
const VERY_FAST_SCROLL_PX_PER_MS = 3.2;
const MIN_OVERSCAN_UNIT_HEIGHT = 180;
const MAX_OVERSCAN_UNIT_HEIGHT = 520;
const MAX_OVERSCAN_HEIGHT_SAMPLE_ITEMS = 250;
const SCROLL_VELOCITY_SETTLE_MS = 160;
const NAVIGATION_OVERSCAN_SETTLE_MS = 650;
