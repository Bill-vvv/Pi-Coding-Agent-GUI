import { memo, useCallback, useEffect, useLayoutEffect, useMemo, useRef, useState, type ReactNode, type RefObject } from "react";
import type { SubagentRun } from "@pi-gui/shared";
import { buildConversationDisplayBlocks, type ConversationDisplayBlock, type ConversationDisplayMode } from "../../domain/conversationDisplay";
import { estimateVirtualRange } from "../../domain/virtualList";
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
  const measurementFrameRef = useRef<number | undefined>(undefined);
  const navigationOverscanTimerRef = useRef<number | undefined>(undefined);
  const [measurementRevision, setMeasurementRevision] = useState(0);
  const [viewport, setViewport] = useState({ scrollTop: 0, height: 640 });
  const [navigationOverscanActive, setNavigationOverscanActive] = useState(false);

  const updateViewport = useCallback(() => {
    const surface = surfaceRef.current;
    if (!surface) return;
    const nextViewport = { scrollTop: surface.scrollTop, height: surface.clientHeight || 640 };
    setViewport((current) => (current.scrollTop === nextViewport.scrollTop && current.height === nextViewport.height ? current : nextViewport));
  }, [surfaceRef]);

  useLayoutEffect(() => {
    const surface = surfaceRef.current;
    if (!surface) return;
    updateViewport();
    surface.addEventListener("scroll", updateViewport, { passive: true });
    window.addEventListener("resize", updateViewport);
    const resizeObserver = new ResizeObserver(updateViewport);
    resizeObserver.observe(surface);
    return () => {
      surface.removeEventListener("scroll", updateViewport);
      window.removeEventListener("resize", updateViewport);
      resizeObserver.disconnect();
    };
  }, [surfaceRef, updateViewport]);

  useEffect(() => {
    return () => {
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

  const measuredHeights = useMemo(
    () => blocks.map((block) => heightByBlockIdRef.current.get(block.id) ?? ESTIMATED_CONVERSATION_BLOCK_HEIGHT),
    [blocks, measurementRevision],
  );

  useLayoutEffect(() => {
    onLayoutMetricsChange?.({
      blockIds: blocks.map((block) => block.id),
      blockHeights: measuredHeights,
      estimatedBlockHeight: ESTIMATED_CONVERSATION_BLOCK_HEIGHT,
    });
  }, [blocks, measuredHeights, onLayoutMetricsChange]);

  const virtualRange = estimateVirtualRange({
    itemCount: blocks.length,
    scrollTop: viewport.scrollTop,
    viewportHeight: viewport.height,
    itemHeights: measuredHeights,
    estimatedItemHeight: ESTIMATED_CONVERSATION_BLOCK_HEIGHT,
    overscan: navigationOverscanActive ? NAVIGATION_CONVERSATION_BLOCK_OVERSCAN : CONVERSATION_BLOCK_OVERSCAN,
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

  const handleRowMeasure = useCallback((blockId: string, height: number) => {
    if (height <= 0 || Math.abs((heightByBlockIdRef.current.get(blockId) ?? 0) - height) <= 1) return;
    heightByBlockIdRef.current.set(blockId, height);
    requestMeasurementRevision();
  }, [requestMeasurementRevision]);

  return (
    <>
      {virtualRange.beforeHeight > 0 ? <div aria-hidden="true" style={{ height: virtualRange.beforeHeight }} /> : null}
      {visibleBlocks.map((block, offset) => {
        const index = virtualRange.startIndex + offset;
        return (
          <MeasuredVirtualRow blockId={block.id} index={index} key={block.id} onMeasure={handleRowMeasure}>
            {renderBlock(block, actions)}
          </MeasuredVirtualRow>
        );
      })}
      {virtualRange.afterHeight > 0 ? <div aria-hidden="true" style={{ height: virtualRange.afterHeight }} /> : null}
    </>
  );
});

function MeasuredVirtualRow({ blockId, index, onMeasure, children }: { blockId: string; index: number; onMeasure: (blockId: string, height: number) => void; children: ReactNode }) {
  const rowRef = useRef<HTMLDivElement | null>(null);

  useLayoutEffect(() => {
    const element = rowRef.current;
    if (!element) return;
    onMeasure(blockId, element.getBoundingClientRect().height);
    const observer = new ResizeObserver(() => {
      onMeasure(blockId, element.getBoundingClientRect().height);
    });
    observer.observe(element);
    return () => observer.disconnect();
  }, [blockId, onMeasure]);

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

const ESTIMATED_CONVERSATION_BLOCK_HEIGHT = 220;
const CONVERSATION_BLOCK_OVERSCAN = 4;
const NAVIGATION_CONVERSATION_BLOCK_OVERSCAN = 12;
const NAVIGATION_OVERSCAN_SETTLE_MS = 650;
