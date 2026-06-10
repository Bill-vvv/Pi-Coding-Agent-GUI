import { memo, useCallback, useEffect, useLayoutEffect, useMemo, useRef, useState, type KeyboardEvent } from "react";
import type { Runtime, RuntimeConversationSummary, SubagentRun } from "@pi-gui/shared";
import type { ConversationMessage } from "../../types";
import { isTransportConnectionError } from "../../domain/connection";
import { buildConversationDisplayBlocks, type ConversationDisplayMode } from "../../domain/conversationDisplay";
import type { RuntimeExtensionUiChrome } from "../../domain/extensionUiChrome";
import { prependScrollTop } from "../../domain/virtualList";
import { ExtensionUiStatusStrip } from "../ExtensionUiChrome";
import { ThinkingStatus } from "../ThinkingAnimation";
import { VirtualConversationBlockList } from "./ConversationBlockList";
import { ReplyNavigator } from "./ReplyNavigator";
import { useStealthScrollbar } from "./ScrollableContent";
import { lastUserMessageScrollOffset, shouldDeferLastUserMessageScrollTarget, type ConversationBlockLayoutMetrics } from "./replyNavigation";

type ChatViewProps = {
  operationError?: string;
  notice?: string;
  connectionWarning?: string;
  activeRuntime?: Runtime;
  conversationSummary?: RuntimeConversationSummary;
  messages: ConversationMessage[];
  activeRuntimeIsBusy: boolean;
  hasMoreBefore?: boolean;
  subagentRuns?: SubagentRun[];
  extensionUi?: RuntimeExtensionUiChrome;
  displayMode?: ConversationDisplayMode;
  scrollToBottomSignal?: number;
  scrollToLastUserMessageRequest?: { runtimeId: string; sequence: number };
  onScrollToLastUserMessageRequestHandled?: (sequence: number) => void;
  bottomClearanceSignal?: number;
  onLoadOlderMessages?: () => void;
  onOpenSubagentRun?: (runId: string) => void;
  onCopySubagentOutput?: (run: SubagentRun) => void;
  onDismissOperationError?: (expectedError?: string) => void;
  onDismissNotice?: (expectedNotice?: string) => void;
};

export const ChatView = memo(function ChatView({
  operationError,
  notice,
  connectionWarning,
  activeRuntime,
  conversationSummary,
  messages,
  activeRuntimeIsBusy,
  hasMoreBefore = false,
  subagentRuns = [],
  extensionUi,
  displayMode = "compact",
  scrollToBottomSignal,
  scrollToLastUserMessageRequest,
  onScrollToLastUserMessageRequestHandled,
  bottomClearanceSignal,
  onLoadOlderMessages,
  onOpenSubagentRun,
  onCopySubagentOutput,
  onDismissOperationError,
  onDismissNotice,
}: ChatViewProps) {
  const surfaceRef = useRef<HTMLDivElement | null>(null);
  const shouldAutoFollowRef = useRef(true);
  const [blockLayoutMetrics, setBlockLayoutMetrics] = useState<ConversationBlockLayoutMetrics | undefined>();
  const [navigationOverscanSignal, setNavigationOverscanSignal] = useState(0);
  const conversationScrollbar = useStealthScrollbar();
  const prependAnchorRef = useRef<{ scrollTop: number; scrollHeight: number } | undefined>(undefined);
  const followBottomFrameRef = useRef<number | undefined>(undefined);
  const forcedAutoFollowFramesRef = useRef(0);
  const observedScrollToBottomSignalRef = useRef<number | undefined>(undefined);
  const observedBottomClearanceSignalRef = useRef<number | undefined>(undefined);
  const handledLastUserMessageScrollRequestRef = useRef(0);
  const blocks = useMemo(() => buildConversationDisplayBlocks(messages, displayMode, { activeRuntimeIsBusy, subagentRuns }), [activeRuntimeIsBusy, displayMode, messages, subagentRuns]);
  const historicalCapabilityNotice = historicalCapabilityNoticeForRuntime(activeRuntime, subagentRuns);
  const transportError = isTransportConnectionError(operationError) ? operationError : undefined;
  const visibleOperationError = transportError ? undefined : operationError;
  const connectionStatusMessage = connectionWarning ?? transportError;
  const visibleOperationErrorRef = useRef(visibleOperationError);
  const noticeRef = useRef(notice);
  const dismissOperationErrorRef = useRef(onDismissOperationError);
  const dismissNoticeRef = useRef(onDismissNotice);
  const blockActions = useMemo(() => ({ onOpenSubagentRun, onCopySubagentOutput }), [onCopySubagentOutput, onOpenSubagentRun]);
  const requestAutoFollowBottom = useCallback((options?: { force?: boolean }) => {
    if (options?.force) {
      forcedAutoFollowFramesRef.current = Math.max(forcedAutoFollowFramesRef.current, FORCED_AUTO_FOLLOW_SETTLE_FRAMES);
      shouldAutoFollowRef.current = true;
    }

    const scheduleFollowBottomFrame = () => {
      if (prependAnchorRef.current) return;
      const isForced = forcedAutoFollowFramesRef.current > 0;
      if (!isForced && !shouldAutoFollowRef.current) return;
      if (followBottomFrameRef.current !== undefined) return;

      followBottomFrameRef.current = window.requestAnimationFrame(() => {
        followBottomFrameRef.current = undefined;
        if (prependAnchorRef.current) return;
        const forceFrame = forcedAutoFollowFramesRef.current > 0;
        if (!forceFrame && !shouldAutoFollowRef.current) return;
        scrollConversationToBottom(surfaceRef.current);
        if (forceFrame) {
          forcedAutoFollowFramesRef.current -= 1;
          shouldAutoFollowRef.current = true;
          scheduleFollowBottomFrame();
        }
      });
    };

    scheduleFollowBottomFrame();
  }, []);

  useLayoutEffect(() => {
    visibleOperationErrorRef.current = visibleOperationError;
    noticeRef.current = notice;
    dismissOperationErrorRef.current = onDismissOperationError;
    dismissNoticeRef.current = onDismissNotice;
  });

  useEffect(() => {
    if (!visibleOperationError) return;
    const scheduledError = visibleOperationError;
    const timer = window.setTimeout(() => {
      if (visibleOperationErrorRef.current === scheduledError) dismissOperationErrorRef.current?.(scheduledError);
    }, OPERATION_ERROR_AUTO_DISMISS_MS);
    return () => window.clearTimeout(timer);
  }, [visibleOperationError]);

  useEffect(() => {
    if (!notice) return;
    const scheduledNotice = notice;
    const timer = window.setTimeout(() => {
      if (noticeRef.current === scheduledNotice) dismissNoticeRef.current?.(scheduledNotice);
    }, NOTICE_AUTO_DISMISS_MS);
    return () => window.clearTimeout(timer);
  }, [notice]);

  useEffect(() => {
    return () => {
      if (followBottomFrameRef.current !== undefined) window.cancelAnimationFrame(followBottomFrameRef.current);
    };
  }, []);

  useLayoutEffect(() => {
    // Only runtime changes force the existing bottom-follow behavior. Last-user
    // request changes are handled by the dedicated one-shot effect below.
    if (
      activeRuntime?.id &&
      scrollToLastUserMessageRequest?.runtimeId === activeRuntime.id &&
      handledLastUserMessageScrollRequestRef.current !== scrollToLastUserMessageRequest.sequence
    ) {
      return;
    }
    requestAutoFollowBottom({ force: true });
  }, [activeRuntime?.id, requestAutoFollowBottom]);

  useLayoutEffect(() => {
    if (scrollToBottomSignal === undefined) return;
    if (observedScrollToBottomSignalRef.current === undefined) {
      observedScrollToBottomSignalRef.current = scrollToBottomSignal;
      return;
    }
    observedScrollToBottomSignalRef.current = scrollToBottomSignal;
    requestAutoFollowBottom({ force: true });
  }, [requestAutoFollowBottom, scrollToBottomSignal]);

  useLayoutEffect(() => {
    if (bottomClearanceSignal === undefined) return;
    if (observedBottomClearanceSignalRef.current === undefined) {
      observedBottomClearanceSignalRef.current = bottomClearanceSignal;
      return;
    }
    observedBottomClearanceSignalRef.current = bottomClearanceSignal;
    requestAutoFollowBottom();
  }, [bottomClearanceSignal, requestAutoFollowBottom]);

  useLayoutEffect(() => {
    const anchor = prependAnchorRef.current;
    const surface = surfaceRef.current;
    if (!anchor || !surface) return;
    prependAnchorRef.current = undefined;
    surface.scrollTop = prependScrollTop(anchor.scrollTop, anchor.scrollHeight, surface.scrollHeight);
  }, [messages.length]);

  useLayoutEffect(() => {
    requestAutoFollowBottom();
  }, [messages, activeRuntimeIsBusy, subagentRuns, requestAutoFollowBottom]);

  function handleConversationScroll() {
    conversationScrollbar.reveal();
    const surface = surfaceRef.current;
    if (!surface) return;
    shouldAutoFollowRef.current = isNearBottom(surface);
  }

  function handleConversationUserScrollIntent() {
    forcedAutoFollowFramesRef.current = 0;
    if (followBottomFrameRef.current !== undefined) {
      window.cancelAnimationFrame(followBottomFrameRef.current);
      followBottomFrameRef.current = undefined;
    }
  }

  function handleConversationKeyDown(event: KeyboardEvent<HTMLDivElement>) {
    if (SCROLL_INTERACTION_KEYS.has(event.key)) handleConversationUserScrollIntent();
  }

  const scrollConversationToOffset = useCallback((offset: number) => {
    const surface = surfaceRef.current;
    if (!surface) return false;
    shouldAutoFollowRef.current = false;
    forcedAutoFollowFramesRef.current = 0;
    if (followBottomFrameRef.current !== undefined) {
      window.cancelAnimationFrame(followBottomFrameRef.current);
      followBottomFrameRef.current = undefined;
    }
    surface.scrollTop = Math.max(0, offset);
    surface.dispatchEvent(new Event("scroll"));
    setNavigationOverscanSignal((value) => value + 1);
    return true;
  }, []);

  const handleReplyNavigation = useCallback((offset: number) => {
    scrollConversationToOffset(offset);
  }, [scrollConversationToOffset]);

  useLayoutEffect(() => {
    const request = scrollToLastUserMessageRequest;
    if (!request?.runtimeId || request.sequence <= 0) return;
    if (handledLastUserMessageScrollRequestRef.current === request.sequence) return;
    if (activeRuntime?.id !== request.runtimeId) return;
    if (
      shouldDeferLastUserMessageScrollTarget({
        loadedMessageCount: messages.length,
        summaryMessageCount: conversationSummary?.messageCount,
        runtimeHasSession: Boolean(activeRuntime?.sessionId),
      })
    ) {
      return;
    }

    if (blocks.length === 0) {
      handledLastUserMessageScrollRequestRef.current = request.sequence;
      onScrollToLastUserMessageRequestHandled?.(request.sequence);
      return;
    }

    if (!blockLayoutMetrics || !layoutMetricsMatchBlocks(blockLayoutMetrics, blocks)) return;
    handledLastUserMessageScrollRequestRef.current = request.sequence;
    const offset = lastUserMessageScrollOffset(blocks, blockLayoutMetrics);
    if (offset !== undefined) {
      scrollConversationToOffset(offset);
    } else {
      requestAutoFollowBottom({ force: true });
    }
    onScrollToLastUserMessageRequestHandled?.(request.sequence);
  }, [activeRuntime?.id, activeRuntime?.sessionId, blockLayoutMetrics, blocks, conversationSummary?.messageCount, messages.length, onScrollToLastUserMessageRequestHandled, requestAutoFollowBottom, scrollConversationToOffset, scrollToLastUserMessageRequest]);

  const handleBlockLayoutMetricsChange = useCallback((metrics: ConversationBlockLayoutMetrics) => {
    setBlockLayoutMetrics((current) => (layoutMetricsEqual(current, metrics) ? current : metrics));
  }, []);

  function handleLoadOlderMessages() {
    const surface = surfaceRef.current;
    if (surface) prependAnchorRef.current = { scrollTop: surface.scrollTop, scrollHeight: surface.scrollHeight };
    onLoadOlderMessages?.();
  }

  return (
    <>
      {visibleOperationError || notice ? (
        <div className="floating-feedback error-stack">
          {visibleOperationError ? <DismissibleBanner className="error-banner" message={visibleOperationError} onDismiss={onDismissOperationError} /> : null}
          {notice ? <DismissibleBanner className="notice-banner" message={notice} onDismiss={onDismissNotice} /> : null}
        </div>
      ) : null}

      <div className="conversation-shell">
        {activeRuntime || connectionStatusMessage ? (
          <div className="conversation-header">
            {activeRuntime ? (
              <>
                <strong title={conversationSummary?.title}>{conversationSummary?.title ?? `对话 ${activeRuntime.id.slice(0, 8)}`}</strong>
                {conversationSummary?.detail ? <small className="conversation-header-detail">{conversationSummary.detail}</small> : null}
                {activeRuntime.sessionId ? <small className="conversation-header-session">Session {activeRuntime.sessionId.slice(0, 8)}</small> : null}
                {activeRuntime.archivedAt ? <small>已归档</small> : null}
                {historicalCapabilityNotice ? <small className="conversation-header-capability-note">{historicalCapabilityNotice}</small> : null}
                <ExtensionUiStatusStrip chrome={extensionUi} />
              </>
            ) : null}
            {connectionStatusMessage ? <small className="connection-status-warning">{connectionStatusMessage}</small> : null}
          </div>
        ) : null}

        <div
          className={`conversation-surface stealth-scroll${conversationScrollbar.isVisible ? " is-scrolling" : ""}`}
          ref={surfaceRef}
          tabIndex={0}
          onKeyDown={handleConversationKeyDown}
          onPointerDown={handleConversationUserScrollIntent}
          onScroll={handleConversationScroll}
          onWheel={handleConversationUserScrollIntent}
          onTouchMove={handleConversationUserScrollIntent}
        >
          {blocks.length > 0 || activeRuntimeIsBusy ? (
            <div className="message-list">
              {hasMoreBefore && onLoadOlderMessages ? (
                <div className="conversation-load-older">
                  <button type="button" onClick={handleLoadOlderMessages}>加载更早消息</button>
                </div>
              ) : null}
              <VirtualConversationBlockList
                blocks={blocks}
                surfaceRef={surfaceRef}
                actions={blockActions}
                onLayoutChange={requestAutoFollowBottom}
                onLayoutMetricsChange={handleBlockLayoutMetricsChange}
                navigationOverscanSignal={navigationOverscanSignal}
              />
              {activeRuntimeIsBusy && !blocks.some((block) => block.isStreaming) ? (
                <article className="chat-message assistant streaming thinking-placeholder">
                  <ThinkingStatus variant="coreloop" />
                </article>
              ) : null}
              <div className="conversation-bottom-sentinel" />
            </div>
          ) : null}
        </div>
        <ReplyNavigator blocks={blocks} layoutMetrics={blockLayoutMetrics} surfaceRef={surfaceRef} onNavigateToOffset={handleReplyNavigation} />
      </div>
    </>
  );
});

function DismissibleBanner({ className, message, onDismiss }: { className: string; message: string; onDismiss?: () => void }) {
  return (
    <div className={className}>
      <span>{message}</span>
      {onDismiss ? (
        <button className="feedback-dismiss" type="button" aria-label="关闭提示" onClick={onDismiss}>
          ×
        </button>
      ) : null}
    </div>
  );
}

const NOTICE_AUTO_DISMISS_MS = 4000;
const OPERATION_ERROR_AUTO_DISMISS_MS = 8000;
const FORCED_AUTO_FOLLOW_SETTLE_FRAMES = 12;
const SCROLL_INTERACTION_KEYS = new Set(["ArrowDown", "ArrowLeft", "ArrowRight", "ArrowUp", "End", "Home", "PageDown", "PageUp", " "]);

function historicalCapabilityNoticeForRuntime(runtime: Runtime | undefined, subagentRuns: SubagentRun[]): string | undefined {
  if (!runtime?.enabledCapabilityIds || subagentRuns.length === 0) return undefined;
  return runtime.enabledCapabilityIds.includes("trellis-subagent") ? undefined : "历史 Trellis 子代理记录（当前 profile 未启用）";
}

function isNearBottom(element: HTMLElement): boolean {
  return element.scrollHeight - element.scrollTop - element.clientHeight < 96;
}

function scrollConversationToBottom(element: HTMLElement | null): void {
  if (!element) return;
  element.scrollTop = Math.max(0, element.scrollHeight - element.clientHeight);
}

function layoutMetricsMatchBlocks(metrics: ConversationBlockLayoutMetrics, blocks: { id: string }[]): boolean {
  if (metrics.blockIds.length !== blocks.length) return false;
  for (let index = 0; index < blocks.length; index += 1) {
    if (metrics.blockIds[index] !== blocks[index]?.id) return false;
  }
  return true;
}

function layoutMetricsEqual(left: ConversationBlockLayoutMetrics | undefined, right: ConversationBlockLayoutMetrics): boolean {
  if (!left) return false;
  if (left.estimatedBlockHeight !== right.estimatedBlockHeight) return false;
  if (left.blockIds.length !== right.blockIds.length || left.blockHeights.length !== right.blockHeights.length) return false;
  for (let index = 0; index < left.blockIds.length; index += 1) {
    if (left.blockIds[index] !== right.blockIds[index]) return false;
    if (left.blockHeights[index] !== right.blockHeights[index]) return false;
  }
  return true;
}
