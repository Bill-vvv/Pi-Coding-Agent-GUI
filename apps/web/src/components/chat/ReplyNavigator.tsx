import { memo, useCallback, useEffect, useMemo, useRef, useState, type KeyboardEvent, type MouseEvent, type PointerEvent as ReactPointerEvent, type RefObject, type WheelEvent } from "react";
import type { ConversationDisplayBlock } from "../../domain/conversationDisplay";
import {
  activeReplyAnchorIndex,
  adjacentReplyAnchorIndex,
  assistantReplyAnchors,
  blockScrollOffset,
  replyMarkerSlotLength,
  replyMarkerWindow,
  replyScrollOffset,
  type ConversationBlockLayoutMetrics,
  type ReplyAnchor,
  type ReplyMarker,
  type ReplyNavigationDirection,
} from "./replyNavigation";

type ReplyNavigatorProps = {
  blocks: ConversationDisplayBlock[];
  layoutMetrics?: ConversationBlockLayoutMetrics;
  surfaceRef: RefObject<HTMLDivElement | null>;
  onNavigateToOffset: (offset: number) => void;
};

type ViewportState = {
  scrollTop: number;
  height: number;
};

type PointerDragState = {
  pointerId: number;
  lastY: number;
  totalY: number;
  accumulatedY: number;
  started: boolean;
};

type RollAnimationMode = "navigate" | "sync";
type DirectionalInputSource = "wheel" | "drag";

type BoundaryMarker = {
  kind: "boundary";
  boundary: ReplyNavigationDirection;
  key: string;
  slotIndex: number;
  length: ReplyMarker["length"];
  title: string;
};

type RenderMarker = ({ kind: "reply" } & ReplyMarker) | BoundaryMarker;

export const ReplyNavigator = memo(function ReplyNavigator({ blocks, layoutMetrics, surfaceRef, onNavigateToOffset }: ReplyNavigatorProps) {
  const anchors = useMemo(() => assistantReplyAnchors(blocks), [blocks]);
  const metrics = useMemo<ConversationBlockLayoutMetrics>(
    () => (layoutMetrics && layoutMetricsMatchBlocks(layoutMetrics, blocks) ? layoutMetrics : fallbackLayoutMetrics(blocks)),
    [blocks, layoutMetrics],
  );
  const [viewport, setViewport] = useState<ViewportState>({ scrollTop: 0, height: 640 });
  const [rollDirection, setRollDirection] = useState<ReplyNavigationDirection | undefined>();
  const [rollMagnitude, setRollMagnitude] = useState(1);
  const [rollPulse, setRollPulse] = useState(0);
  const [rollMode, setRollMode] = useState<RollAnimationMode>("navigate");
  const [isDragging, setIsDragging] = useState(false);
  const dragRef = useRef<PointerDragState | undefined>(undefined);
  const wheelDeltaRef = useRef(0);
  const nextWheelStepAtRef = useRef(0);
  const nextDragStepAtRef = useRef(0);
  const previousActiveIndexRef = useRef<number | undefined>(undefined);
  const suppressActiveRollIndexRef = useRef<number | undefined>(undefined);
  const rollTimerRef = useRef<number | undefined>(undefined);
  const suppressClickTimerRef = useRef<number | undefined>(undefined);
  const suppressNextClickRef = useRef(false);

  const updateViewport = useCallback(() => {
    const surface = surfaceRef.current;
    if (!surface) return;
    const nextViewport = { scrollTop: surface.scrollTop, height: surface.clientHeight || 640 };
    setViewport((current) => (current.scrollTop === nextViewport.scrollTop && current.height === nextViewport.height ? current : nextViewport));
  }, [surfaceRef]);

  useEffect(() => {
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
      if (rollTimerRef.current !== undefined) window.clearTimeout(rollTimerRef.current);
      if (suppressClickTimerRef.current !== undefined) window.clearTimeout(suppressClickTimerRef.current);
    };
  }, []);

  useEffect(() => {
    if (!isDragging) return;
    document.body.classList.add(REPLY_NAVIGATOR_DRAGGING_CLASS);
    return () => document.body.classList.remove(REPLY_NAVIGATOR_DRAGGING_CLASS);
  }, [isDragging]);

  const activeIndex = activeReplyAnchorIndex(anchors, metrics, viewport.scrollTop);
  const markers = replyMarkerWindow(anchors, activeIndex);
  const surface = surfaceRef.current;
  const hasContentAbove = viewport.scrollTop > CONTENT_BOUNDARY_TOLERANCE_PX;
  const hasContentBelow = surface ? viewport.scrollTop + viewport.height < surface.scrollHeight - CONTENT_BOUNDARY_TOLERANCE_PX : false;
  const hasPrevious = activeIndex > 0;
  const hasNext = anchors.length > 0 && activeIndex < anchors.length - 1;
  const renderMarkers = useMemo<RenderMarker[]>(() => {
    const items: RenderMarker[] = markers.map((marker) => ({ ...marker, kind: "reply" }));
    if (activeIndex >= 0 && activeIndex === 0 && hasContentAbove) {
      items.push({
        kind: "boundary",
        boundary: "older",
        key: "older-content-boundary",
        slotIndex: REPLY_NAVIGATOR_CENTER_SLOT_INDEX - 1,
        length: replyMarkerSlotLength(REPLY_NAVIGATOR_CENTER_SLOT_INDEX - 1),
        title: "跳转到更早内容",
      });
    }
    if (activeIndex >= 0 && activeIndex === anchors.length - 1 && hasContentBelow) {
      items.push({
        kind: "boundary",
        boundary: "newer",
        key: "newer-content-boundary",
        slotIndex: REPLY_NAVIGATOR_CENTER_SLOT_INDEX + 1,
        length: replyMarkerSlotLength(REPLY_NAVIGATOR_CENTER_SLOT_INDEX + 1),
        title: "跳转到最新内容",
      });
    }
    return items.sort((left, right) => left.slotIndex - right.slotIndex);
  }, [activeIndex, anchors.length, hasContentAbove, hasContentBelow, markers]);

  const triggerRoll = useCallback((direction: ReplyNavigationDirection, magnitude = 1, mode: RollAnimationMode = "navigate") => {
    setRollDirection(direction);
    setRollMagnitude(clampRollMagnitude(magnitude));
    setRollMode(mode);
    setRollPulse((value) => (value + 1) % 2);
    if (rollTimerRef.current !== undefined) window.clearTimeout(rollTimerRef.current);
    rollTimerRef.current = window.setTimeout(() => {
      rollTimerRef.current = undefined;
      setRollDirection(undefined);
      setRollMagnitude(1);
      setRollMode("navigate");
    }, ROLL_ANIMATION_MS);
  }, []);

  useEffect(() => {
    const previousActiveIndex = previousActiveIndexRef.current;
    previousActiveIndexRef.current = activeIndex;
    if (suppressActiveRollIndexRef.current === activeIndex) {
      suppressActiveRollIndexRef.current = undefined;
      return;
    }
    if (previousActiveIndex === undefined || previousActiveIndex < 0 || activeIndex < 0 || previousActiveIndex === activeIndex) return;
    triggerRoll(activeIndex < previousActiveIndex ? "older" : "newer", Math.abs(activeIndex - previousActiveIndex), "sync");
  }, [activeIndex, triggerRoll]);

  const navigateToAnchorIndex = useCallback(
    (anchorIndex: number, direction?: ReplyNavigationDirection, rollSteps = 1) => {
      const anchor = anchors[anchorIndex];
      if (!anchor) return;
      const offset = replyScrollOffset(anchor, metrics);
      suppressActiveRollIndexRef.current = anchorIndex;
      onNavigateToOffset(offset);
      setViewport((current) => ({ ...current, scrollTop: offset }));
      if (direction) triggerRoll(direction, rollSteps);
    },
    [anchors, metrics, onNavigateToOffset, triggerRoll],
  );

  const navigateDirection = useCallback(
    (direction: ReplyNavigationDirection, rollSteps = 1): boolean => {
      const currentActiveIndex = activeReplyAnchorIndex(anchors, metrics, surfaceRef.current?.scrollTop ?? viewport.scrollTop);
      const targetIndex = adjacentReplyAnchorIndex(currentActiveIndex, anchors.length, direction);
      if (targetIndex < 0 || targetIndex === currentActiveIndex) return false;
      navigateToAnchorIndex(targetIndex, direction, rollSteps);
      return true;
    },
    [anchors, metrics, navigateToAnchorIndex, surfaceRef, viewport.scrollTop],
  );

  const consumeDirectionalDelta = useCallback(
    (delta: number, threshold: number, source: DirectionalInputSource): number => {
      if (Math.abs(delta) < threshold) return delta;

      const now = nowMs();
      const stepGateRef = source === "drag" ? nextDragStepAtRef : nextWheelStepAtRef;
      if (now < stepGateRef.current) return clampDeltaCarry(delta, threshold);

      const direction: ReplyNavigationDirection = delta < 0 ? "older" : "newer";
      if (!navigateDirection(direction)) return 0;

      stepGateRef.current = now + (source === "drag" ? DRAG_STEP_COOLDOWN_MS : WHEEL_STEP_COOLDOWN_MS);
      return clampDeltaCarry(delta - Math.sign(delta) * threshold, threshold);
    },
    [navigateDirection],
  );

  const handleWheel = useCallback(
    (event: WheelEvent<HTMLDivElement>) => {
      event.preventDefault();
      wheelDeltaRef.current += normalizeWheelDelta(event, viewport.height);
      wheelDeltaRef.current = consumeDirectionalDelta(wheelDeltaRef.current, WHEEL_STEP_THRESHOLD_PX, "wheel");
    },
    [consumeDirectionalDelta, viewport.height],
  );

  const movePointerDrag = useCallback(
    (pointerId: number, clientY: number): boolean => {
      const drag = dragRef.current;
      if (!drag || drag.pointerId !== pointerId) return false;
      const deltaY = clientY - drag.lastY;
      drag.lastY = clientY;
      drag.totalY += deltaY;

      if (!drag.started) {
        if (Math.abs(drag.totalY) < DRAG_ACTIVATION_THRESHOLD_PX) return false;
        drag.started = true;
        drag.accumulatedY = -drag.totalY;
        suppressNextClickRef.current = true;
        setIsDragging(true);
      } else {
        drag.accumulatedY -= deltaY;
      }

      drag.accumulatedY = consumeDirectionalDelta(drag.accumulatedY, DRAG_STEP_THRESHOLD_PX, "drag");
      return true;
    },
    [consumeDirectionalDelta],
  );

  const finishPointerDragById = useCallback((pointerId: number, preventDefault?: () => void) => {
    const drag = dragRef.current;
    if (!drag || drag.pointerId !== pointerId) return;
    dragRef.current = undefined;
    setIsDragging(false);

    if (suppressNextClickRef.current) {
      preventDefault?.();
      if (suppressClickTimerRef.current !== undefined) window.clearTimeout(suppressClickTimerRef.current);
      suppressClickTimerRef.current = window.setTimeout(() => {
        suppressClickTimerRef.current = undefined;
        suppressNextClickRef.current = false;
      }, 0);
    }
  }, []);

  const handlePointerDown = useCallback((event: ReactPointerEvent<HTMLDivElement>) => {
    if (event.button > 0) return;
    dragRef.current = { pointerId: event.pointerId, lastY: event.clientY, totalY: 0, accumulatedY: 0, started: false };
  }, []);

  const handlePointerMove = useCallback(
    (event: ReactPointerEvent<HTMLDivElement>) => {
      if (!movePointerDrag(event.pointerId, event.clientY)) return;
      event.preventDefault();
    },
    [movePointerDrag],
  );

  const finishPointerDrag = useCallback(
    (event: ReactPointerEvent<HTMLDivElement>) => {
      finishPointerDragById(event.pointerId, () => event.preventDefault());
    },
    [finishPointerDragById],
  );

  useEffect(() => {
    function handleWindowPointerMove(event: PointerEvent) {
      if (!movePointerDrag(event.pointerId, event.clientY)) return;
      event.preventDefault();
    }

    function handleWindowPointerFinish(event: PointerEvent) {
      finishPointerDragById(event.pointerId, () => event.preventDefault());
    }

    window.addEventListener("pointermove", handleWindowPointerMove, { passive: false });
    window.addEventListener("pointerup", handleWindowPointerFinish);
    window.addEventListener("pointercancel", handleWindowPointerFinish);
    return () => {
      window.removeEventListener("pointermove", handleWindowPointerMove);
      window.removeEventListener("pointerup", handleWindowPointerFinish);
      window.removeEventListener("pointercancel", handleWindowPointerFinish);
    };
  }, [finishPointerDragById, movePointerDrag]);

  const handleKeyDown = useCallback(
    (event: KeyboardEvent<HTMLDivElement>) => {
      if (event.key !== "ArrowUp" && event.key !== "ArrowDown" && event.key !== "PageUp" && event.key !== "PageDown") return;
      event.preventDefault();
      navigateDirection(event.key === "ArrowUp" || event.key === "PageUp" ? "older" : "newer");
    },
    [navigateDirection],
  );

  const handleClickCapture = useCallback((event: MouseEvent<HTMLDivElement>) => {
    if (!suppressNextClickRef.current) return;
    if (suppressClickTimerRef.current !== undefined) {
      window.clearTimeout(suppressClickTimerRef.current);
      suppressClickTimerRef.current = undefined;
    }
    suppressNextClickRef.current = false;
    event.preventDefault();
    event.stopPropagation();
  }, []);

  const handleMarkerClick = useCallback(
    (anchorIndex: number) => {
      const direction = anchorIndex < activeIndex ? "older" : anchorIndex > activeIndex ? "newer" : undefined;
      navigateToAnchorIndex(anchorIndex, direction);
    },
    [activeIndex, navigateToAnchorIndex],
  );

  const handleMarkerRailClick = useCallback(
    (event: MouseEvent<HTMLDivElement>) => {
      if ((event.target as HTMLElement).closest(".reply-navigator-marker")) return;
      const markerButtons = Array.from(event.currentTarget.querySelectorAll<HTMLButtonElement>(".reply-navigator-marker"));
      if (markerButtons.length === 0) return;
      const nearestMarker = markerButtons.reduce(
        (nearest, button) => {
          const rect = button.getBoundingClientRect();
          const distance = Math.abs(event.clientY - (rect.top + rect.height / 2));
          return distance < nearest.distance ? { button, distance } : nearest;
        },
        { button: markerButtons[0], distance: Number.POSITIVE_INFINITY },
      ).button;
      const markerIndex = Number(nearestMarker.dataset.anchorIndex);
      if (!Number.isInteger(markerIndex)) return;
      handleMarkerClick(markerIndex);
    },
    [handleMarkerClick],
  );

  const jumpToBoundary = useCallback(
    (direction: ReplyNavigationDirection) => {
      const offset = userBoundaryScrollOffset(blocks, metrics, anchors, direction);
      if (offset === undefined) return;
      onNavigateToOffset(offset);
      setViewport((current) => ({ ...current, scrollTop: offset }));
      triggerRoll(direction, MAX_ROLL_MAGNITUDE);
    },
    [anchors, blocks, metrics, onNavigateToOffset, triggerRoll],
  );

  if (anchors.length < 2) return null;

  return (
    <div
      className={`reply-navigator${isDragging ? " is-dragging" : ""}${rollDirection ? ` rolling-${rollDirection} roll-steps-${rollMagnitude} roll-pulse-${rollPulse} roll-mode-${rollMode}` : ""}`}
      role="navigation"
      aria-label="LLM 回复快速导航"
      onKeyDown={handleKeyDown}
      onClickCapture={handleClickCapture}
      onPointerDown={handlePointerDown}
      onPointerMove={handlePointerMove}
      onPointerUp={finishPointerDrag}
      onPointerCancel={finishPointerDrag}
      onWheel={handleWheel}
    >
      <button
        className="reply-navigator-triangle previous"
        type="button"
        title="单击跳转到上一个 LLM 回复；双击跳到顶部"
        aria-label="单击跳转到上一个 LLM 回复；双击跳到顶部"
        aria-disabled={!hasPrevious}
        onClick={() => navigateDirection("older")}
        onDoubleClick={(event) => {
          event.preventDefault();
          jumpToBoundary("older");
        }}
      >
        ▲
      </button>
      <div className="reply-navigator-markers" aria-label="附近 LLM 回复" onClick={handleMarkerRailClick}>
        {renderMarkers.map((marker) =>
          marker.kind === "boundary" ? (
            <button
              className={`reply-navigator-marker boundary ${marker.length}`}
              type="button"
              key={marker.key}
              title={marker.title}
              aria-label={marker.title}
              style={{ gridRow: marker.slotIndex + 1 }}
              onClick={() => jumpToBoundary(marker.boundary)}
            >
              <span />
            </button>
          ) : (
            <button
              className={`reply-navigator-marker ${marker.length}${marker.isActive ? " active" : ""}`}
              type="button"
              key={marker.anchor.messageId}
              title={marker.anchor.summary ? `跳转到用户消息：${marker.anchor.summary}` : `跳转到第 ${marker.anchorIndex + 1} 个 LLM 回复的用户消息`}
              aria-label={marker.anchor.summary ? `跳转到用户消息：${marker.anchor.summary}` : `跳转到第 ${marker.anchorIndex + 1} 个 LLM 回复的用户消息`}
              aria-current={marker.isActive ? "location" : undefined}
              data-anchor-index={marker.anchorIndex}
              data-summary={marker.anchor.summary || undefined}
              style={{ gridRow: marker.slotIndex + 1 }}
              onClick={() => handleMarkerClick(marker.anchorIndex)}
            >
              <span />
            </button>
          ),
        )}
      </div>
      <button
        className="reply-navigator-triangle next"
        type="button"
        title="单击跳转到下一个 LLM 回复；双击跳到底部"
        aria-label="单击跳转到下一个 LLM 回复；双击跳到底部"
        aria-disabled={!hasNext}
        onClick={() => navigateDirection("newer")}
        onDoubleClick={(event) => {
          event.preventDefault();
          jumpToBoundary("newer");
        }}
      >
        ▼
      </button>
    </div>
  );
});

function fallbackLayoutMetrics(blocks: ConversationDisplayBlock[]): ConversationBlockLayoutMetrics {
  return {
    blockIds: blocks.map((block) => block.id),
    blockHeights: blocks.map(() => FALLBACK_BLOCK_HEIGHT),
    estimatedBlockHeight: FALLBACK_BLOCK_HEIGHT,
  };
}

function layoutMetricsMatchBlocks(metrics: ConversationBlockLayoutMetrics, blocks: ConversationDisplayBlock[]): boolean {
  if (metrics.blockIds.length !== blocks.length) return false;
  return blocks.every((block, index) => metrics.blockIds[index] === block.id);
}

function normalizeWheelDelta(event: WheelEvent<HTMLDivElement>, viewportHeight: number): number {
  if (event.deltaMode === WHEEL_DELTA_LINE) {
    const lineSteps = Math.max(1, Math.round(Math.abs(event.deltaY) / WHEEL_LINES_PER_NOTCH));
    return Math.sign(event.deltaY) * WHEEL_STEP_THRESHOLD_PX * lineSteps;
  }

  if (event.deltaMode === WHEEL_DELTA_PAGE) {
    const pageDelta = event.deltaY * Math.max(WHEEL_LINE_HEIGHT_PX, viewportHeight);
    return pageDelta * WHEEL_DAMPING_FACTOR;
  }

  const absDelta = Math.abs(event.deltaY);
  if (absDelta >= WHEEL_PIXEL_NOTCH_DELTA_PX) {
    const notchSteps = Math.max(1, Math.round(absDelta / WHEEL_PIXEL_NOTCH_DELTA_PX));
    return Math.sign(event.deltaY) * WHEEL_STEP_THRESHOLD_PX * notchSteps;
  }

  return event.deltaY * WHEEL_DAMPING_FACTOR;
}

function userBoundaryScrollOffset(blocks: ConversationDisplayBlock[], layout: ConversationBlockLayoutMetrics, anchors: ReplyAnchor[], direction: ReplyNavigationDirection): number | undefined {
  const userBlock = direction === "older" ? blocks.find(isUserMessageBlock) : [...blocks].reverse().find(isUserMessageBlock);
  if (userBlock) return blockOffset(layout, blocks, userBlock.id, blocks.indexOf(userBlock));
  const fallbackAnchor = direction === "older" ? anchors[0] : anchors[anchors.length - 1];
  return fallbackAnchor ? replyScrollOffset(fallbackAnchor, layout) : undefined;
}

function isUserMessageBlock(block: ConversationDisplayBlock): boolean {
  return block.type === "message" && block.message.role === "user";
}

function blockOffset(layout: ConversationBlockLayoutMetrics, blocks: ConversationDisplayBlock[], blockId: string, fallbackIndex: number): number {
  const layoutIndex = layout.blockIds.indexOf(blockId);
  return blockScrollOffset(layout, layoutIndex >= 0 ? layoutIndex : fallbackIndex >= 0 ? fallbackIndex : blocks.findIndex((block) => block.id === blockId));
}

function clampRollMagnitude(value: number): number {
  return Math.min(MAX_ROLL_MAGNITUDE, Math.max(1, Math.floor(value)));
}

function clampDeltaCarry(value: number, threshold: number): number {
  const maxCarry = threshold * DELTA_CARRY_MAX_RATIO;
  return Math.sign(value) * Math.min(Math.abs(value), maxCarry);
}

function nowMs(): number {
  return typeof performance !== "undefined" && typeof performance.now === "function" ? performance.now() : Date.now();
}

const FALLBACK_BLOCK_HEIGHT = 220;
const WHEEL_STEP_THRESHOLD_PX = 44;
const DRAG_ACTIVATION_THRESHOLD_PX = 4;
const DRAG_STEP_THRESHOLD_PX = 26;
const WHEEL_PIXEL_NOTCH_DELTA_PX = 80;
const WHEEL_LINES_PER_NOTCH = 3;
const WHEEL_LINE_HEIGHT_PX = 18;
const WHEEL_DAMPING_FACTOR = 0.9;
const WHEEL_STEP_COOLDOWN_MS = 180;
const DRAG_STEP_COOLDOWN_MS = 135;
const DELTA_CARRY_MAX_RATIO = 0.65;
const CONTENT_BOUNDARY_TOLERANCE_PX = 48;
const REPLY_NAVIGATOR_CENTER_SLOT_INDEX = 4;
const WHEEL_DELTA_LINE = 1;
const WHEEL_DELTA_PAGE = 2;
const MAX_ROLL_MAGNITUDE = 5;
const ROLL_ANIMATION_MS = 430;
const REPLY_NAVIGATOR_DRAGGING_CLASS = "reply-navigator-dragging";
