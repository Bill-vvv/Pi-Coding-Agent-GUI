import { memo, useCallback, useEffect, useLayoutEffect, useMemo, useRef, useState, type KeyboardEvent, type ReactNode, type RefObject } from "react";
import type { Runtime, RuntimeConversationSummary, SubagentRun } from "@pi-gui/shared";
import type { ConversationMessage } from "../types";
import { isTransportConnectionError } from "../domain/connection";
import { messageRoleLabel } from "../domain/conversation";
import { buildConversationDisplayBlocks, type ConversationDisplayBlock, type ConversationDisplayMode } from "../domain/conversationDisplay";
import { subagentCopyText, subagentRunPreview, subagentStatusLabel } from "../domain/subagents";
import { estimateVirtualRange, prependScrollTop } from "../domain/virtualList";
import { Icon } from "./Icon";
import { MarkdownMessage } from "./MarkdownMessage";
import { ThinkingStatus } from "./ThinkingAnimation";

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
  displayMode?: ConversationDisplayMode;
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
  displayMode = "normal",
  onLoadOlderMessages,
  onOpenSubagentRun,
  onCopySubagentOutput,
  onDismissOperationError,
  onDismissNotice,
}: ChatViewProps) {
  const surfaceRef = useRef<HTMLDivElement | null>(null);
  const bottomRef = useRef<HTMLDivElement | null>(null);
  const shouldAutoFollowRef = useRef(true);
  const prependAnchorRef = useRef<{ scrollTop: number; scrollHeight: number } | undefined>(undefined);
  const blocks = useMemo(() => buildConversationDisplayBlocks(messages, displayMode, { activeRuntimeIsBusy, subagentRuns }), [activeRuntimeIsBusy, displayMode, messages, subagentRuns]);
  const transportError = isTransportConnectionError(operationError) ? operationError : undefined;
  const visibleOperationError = transportError ? undefined : operationError;
  const connectionStatusMessage = connectionWarning ?? transportError;
  const visibleOperationErrorRef = useRef(visibleOperationError);
  const noticeRef = useRef(notice);
  const dismissOperationErrorRef = useRef(onDismissOperationError);
  const dismissNoticeRef = useRef(onDismissNotice);
  const blockActions = useMemo(() => ({ onOpenSubagentRun, onCopySubagentOutput }), [onCopySubagentOutput, onOpenSubagentRun]);

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

  useLayoutEffect(() => {
    shouldAutoFollowRef.current = true;
  }, [activeRuntime?.id]);

  useLayoutEffect(() => {
    const anchor = prependAnchorRef.current;
    const surface = surfaceRef.current;
    if (!anchor || !surface) return;
    prependAnchorRef.current = undefined;
    surface.scrollTop = prependScrollTop(anchor.scrollTop, anchor.scrollHeight, surface.scrollHeight);
  }, [messages.length]);

  useLayoutEffect(() => {
    if (prependAnchorRef.current) return;
    if (!shouldAutoFollowRef.current) return;
    bottomRef.current?.scrollIntoView({ block: "end" });
  }, [messages, activeRuntimeIsBusy, subagentRuns]);

  function handleConversationScroll() {
    const surface = surfaceRef.current;
    if (!surface) return;
    shouldAutoFollowRef.current = isNearBottom(surface);
  }

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
              </>
            ) : null}
            {connectionStatusMessage ? <small className="connection-status-warning">{connectionStatusMessage}</small> : null}
          </div>
        ) : null}

        <div className="conversation-surface" ref={surfaceRef} onScroll={handleConversationScroll}>
          {blocks.length > 0 || activeRuntimeIsBusy ? (
            <div className="message-list">
              {hasMoreBefore && onLoadOlderMessages ? (
                <div className="conversation-load-older">
                  <button type="button" onClick={handleLoadOlderMessages}>加载更早消息</button>
                </div>
              ) : null}
              <VirtualConversationBlockList blocks={blocks} surfaceRef={surfaceRef} actions={blockActions} />
              {activeRuntimeIsBusy && !blocks.some((block) => block.isStreaming) ? (
                <article className="chat-message assistant streaming thinking-placeholder">
                  <ThinkingStatus variant="coreloop" />
                </article>
              ) : null}
              <div className="conversation-bottom-sentinel" ref={bottomRef} />
            </div>
          ) : null}
        </div>
      </div>
    </>
  );
});

const VirtualConversationBlockList = memo(function VirtualConversationBlockList({
  blocks,
  surfaceRef,
  actions,
}: {
  blocks: ConversationDisplayBlock[];
  surfaceRef: RefObject<HTMLDivElement | null>;
  actions: ConversationBlockActions;
}) {
  const heightByBlockIdRef = useRef<Map<string, number>>(new Map());
  const [measurementRevision, setMeasurementRevision] = useState(0);
  const [viewport, setViewport] = useState({ scrollTop: 0, height: 640 });

  useLayoutEffect(() => {
    const surface = surfaceRef.current;
    if (!surface) return;
    const updateViewport = () => setViewport({ scrollTop: surface.scrollTop, height: surface.clientHeight || 640 });
    updateViewport();
    surface.addEventListener("scroll", updateViewport, { passive: true });
    window.addEventListener("resize", updateViewport);
    return () => {
      surface.removeEventListener("scroll", updateViewport);
      window.removeEventListener("resize", updateViewport);
    };
  }, [surfaceRef]);

  const measuredHeights = useMemo(
    () => blocks.map((block) => heightByBlockIdRef.current.get(block.id) ?? ESTIMATED_CONVERSATION_BLOCK_HEIGHT),
    [blocks, measurementRevision],
  );
  const virtualRange = estimateVirtualRange({
    itemCount: blocks.length,
    scrollTop: viewport.scrollTop,
    viewportHeight: viewport.height,
    itemHeights: measuredHeights,
    estimatedItemHeight: ESTIMATED_CONVERSATION_BLOCK_HEIGHT,
    overscan: CONVERSATION_BLOCK_OVERSCAN,
  });
  const visibleBlocks = virtualRange.endIndex >= virtualRange.startIndex ? blocks.slice(virtualRange.startIndex, virtualRange.endIndex + 1) : [];

  const handleRowMeasure = useCallback((blockId: string, height: number) => {
    if (height <= 0 || Math.abs((heightByBlockIdRef.current.get(blockId) ?? 0) - height) <= 1) return;
    heightByBlockIdRef.current.set(blockId, height);
    setMeasurementRevision((value) => value + 1);
  }, []);

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
    const observer = new ResizeObserver((entries) => {
      const entry = entries[0];
      if (entry) onMeasure(blockId, entry.contentRect.height);
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
  displayMode = "normal",
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

type ConversationBlockActions = {
  onOpenSubagentRun?: (runId: string) => void;
  onCopySubagentOutput?: (run: SubagentRun) => void;
};

function renderBlock(block: ConversationDisplayBlock, actions: ConversationBlockActions = {}) {
  if (block.type === "tool_group") return <ToolGroupBlock block={block} actions={actions} key={block.id} />;

  const message = block.message;
  return (
    <article className={`chat-message ${message.role}${message.isStreaming ? " streaming" : ""}`} key={block.id}>
      {message.title ? <header className="chat-message-title">{message.title}</header> : null}
      {message.thinking ? (
        <details className="chat-message-thinking" open={message.isStreaming}>
          <summary>思考过程</summary>
          <ScrollableContent className="chat-message-thinking-content">
            <MarkdownMessage text={message.thinking} streaming={message.isStreaming} />
          </ScrollableContent>
        </details>
      ) : null}
      {renderMessageContent(message, block.displayKind)}
      {message.isStreaming ? <span className="chat-message-status">{messageRoleLabel(message.role)} 正在输出…</span> : null}
    </article>
  );
}

function renderMessageContent(message: ConversationMessage, displayKind: Extract<ConversationDisplayBlock, { type: "message" }>["displayKind"]) {
  if (!message.text && message.isStreaming) return null;
  if (displayKind === "markdown") return <MarkdownMessage text={message.text} streaming={message.isStreaming} />;
  return <pre>{message.text}</pre>;
}

function SubagentProcessDetail({ run, actions, active }: { run: SubagentRun; actions: ConversationBlockActions; active: boolean }) {
  const copyText = subagentCopyText(run);
  const children = run.runs;
  const currentChild = children.find((child) => child.status === "running" || child.status === "pending") ?? latestSubagentChild(run);

  return (
    <div className={`tool-group-detail subagent-process-detail${active ? " compact" : ""}`}>
      {active ? <SubagentCurrentProcess child={currentChild} run={run} /> : null}
      {children.length > 0 ? <SubagentChildProcessList children={children} /> : null}
      <footer className="subagent-process-actions">
        <button
          className="subagent-icon-action icon-button"
          type="button"
          title="查看子代理详情"
          aria-label={`查看 ${run.agent} 详情`}
          onClick={() => actions.onOpenSubagentRun?.(run.id)}
          disabled={!actions.onOpenSubagentRun}
        >
          <Icon name="arrow-right" />
        </button>
        <button
          className="subagent-icon-action icon-button"
          type="button"
          title={copyText ? "复制子代理结果" : "暂无可复制结果"}
          aria-label={`复制 ${run.agent} 结果`}
          onClick={() => actions.onCopySubagentOutput?.(run)}
          disabled={!copyText || !actions.onCopySubagentOutput}
        >
          <Icon name="copy" />
        </button>
      </footer>
    </div>
  );
}

function SubagentCurrentProcess({ child, run }: { child?: SubagentRun["runs"][number]; run: SubagentRun }) {
  const status = subagentProcessStatus(child?.status ?? run.status);
  const content = child ? subagentChildPreview(child, 640) : subagentRunPreview(run, 640);

  return (
    <section className={`process-current-section tool ${status}`}>
      <div className="process-current-header">
        <span className="process-current-title">{child?.agent ?? run.agent}</span>
        <span className="process-current-status">{child ? subagentStatusLabel(child.status) : subagentStatusLabel(run.status)}</span>
      </div>
      <ScrollableContent className="process-current-content">
        <MarkdownMessage text={content || "等待子代理输出…"} />
      </ScrollableContent>
    </section>
  );
}

function SubagentChildProcessList({ children }: { children: SubagentRun["runs"] }) {
  return (
    <section className="process-tools-section subagent-process-children">
      <div className="tool-message-detail-title">子代理明细</div>
      <ol className="tool-group-items">
        {children.map((child, index) => (
          <li key={child.id}>
            <details className={`tool-group-item-details ${subagentProcessStatus(child.status)}`} open={child.status === "running" || child.status === "pending"}>
              <summary>
                <span className="tool-group-item-index">{index + 1}</span>
                <span className="tool-group-item-name">{child.agent}</span>
                <span className="tool-group-item-status">{subagentStatusLabel(child.status)}</span>
                <span className="tool-group-item-summary">{subagentChildPreview(child, 160)}</span>
              </summary>
              <div className="tool-group-item-detail">
                <MarkdownMessage text={subagentChildPreview(child, 1200)} streaming={child.status === "running" || child.status === "pending"} />
              </div>
            </details>
          </li>
        ))}
      </ol>
    </section>
  );
}

function subagentChildPreview(child: SubagentRun["runs"][number], maxChars: number): string {
  const text = child.finalText?.trim() || child.textTail?.trim() || child.thinkingTail?.trim() || child.errorMessage?.trim() || child.stderrTail?.trim();
  if (text) return truncateText(text, maxChars);
  if (child.status === "running" || child.status === "pending") return "等待子代理输出…";
  return "暂无输出。";
}

function latestSubagentChild(run: SubagentRun): SubagentRun["runs"][number] | undefined {
  return run.runs.reduce<SubagentRun["runs"][number] | undefined>((latest, child) => {
    const updatedAt = child.finishedAt ?? child.startedAt ?? 0;
    const latestUpdatedAt = latest ? latest.finishedAt ?? latest.startedAt ?? 0 : -1;
    return updatedAt >= latestUpdatedAt ? child : latest;
  }, undefined);
}

function subagentProcessStatus(status: SubagentRun["status"]): "running" | "completed" | "failed" {
  if (status === "failed" || status === "cancelled") return "failed";
  if (status === "succeeded") return "completed";
  return "running";
}

function truncateText(value: string, maxChars: number): string {
  if (value.length <= maxChars) return value;
  return `${value.slice(0, Math.max(0, maxChars - 1))}…`;
}

function ToolGroupBlock({ block, actions }: { block: Extract<ConversationDisplayBlock, { type: "tool_group" }>; actions: ConversationBlockActions }) {
  const { model } = block;

  return (
    <article className={`chat-message tool-group ${model.status}${block.isStreaming ? " streaming" : ""}`} key={block.id}>
      <details className={`tool-group-details ${model.status}`} open={model.status === "running"}>
        <summary>
          {model.status === "running" ? (
            <ThinkingStatus className="tool-group-processing-animation" variant="coreloop" size={38} />
          ) : model.title ? (
            <span className="tool-group-title">{model.title}</span>
          ) : null}
          <span className="tool-group-summary">{model.summary}</span>
        </summary>
        {model.status === "running" ? <CurrentProcessDetail block={block} actions={actions} /> : <FullProcessDetail block={block} actions={actions} />}
      </details>
    </article>
  );
}

function CurrentProcessDetail({ block, actions }: { block: Extract<ConversationDisplayBlock, { type: "tool_group" }>; actions: ConversationBlockActions }) {
  const current = block.model.current;
  const actionableSubagent = block.model.subagents.find((subagent) => subagent.status === "running") ?? block.model.subagents.at(-1);
  const copyText = actionableSubagent ? subagentCopyText(actionableSubagent.run) : undefined;

  return (
    <div className="tool-group-detail compact">
      {current ? (
        <section className={`process-current-section ${current.kind} ${current.status}`}>
          <div className="process-current-header">
            <span className="process-current-title">{current.title}</span>
            <span className="process-current-status">{current.statusLabel}</span>
          </div>
          <ScrollableContent className="process-current-content">
            {current.kind === "thinking" || current.kind === "subagent" ? <MarkdownMessage text={current.content} streaming={current.status === "running"} /> : <pre>{current.content}</pre>}
          </ScrollableContent>
        </section>
      ) : (
        <p className="process-current-empty">等待下一步动作…</p>
      )}
      {actionableSubagent ? (
        <footer className="subagent-process-actions">
          <button
            className="subagent-icon-action icon-button"
            type="button"
            title="查看子代理详情"
            aria-label={`查看 ${actionableSubagent.run.agent} 详情`}
            onClick={() => actions.onOpenSubagentRun?.(actionableSubagent.run.id)}
            disabled={!actions.onOpenSubagentRun}
          >
            <Icon name="arrow-right" />
          </button>
          <button
            className="subagent-icon-action icon-button"
            type="button"
            title={copyText ? "复制子代理结果" : "暂无可复制结果"}
            aria-label={`复制 ${actionableSubagent.run.agent} 结果`}
            onClick={() => actions.onCopySubagentOutput?.(actionableSubagent.run)}
            disabled={!copyText || !actions.onCopySubagentOutput}
          >
            <Icon name="copy" />
          </button>
        </footer>
      ) : null}
    </div>
  );
}

function FullProcessDetail({ block, actions }: { block: Extract<ConversationDisplayBlock, { type: "tool_group" }>; actions: ConversationBlockActions }) {
  const { model } = block;

  return (
    <div className="tool-group-detail">
      {model.thinking.length > 0 ? (
        <section className="process-thinking-section">
          <div className="tool-message-detail-title">思考过程</div>
          <ScrollableContent className="process-thinking-content">
            <MarkdownMessage text={formatThinkingText(model.thinking)} streaming={model.status === "running"} />
          </ScrollableContent>
        </section>
      ) : null}

      {model.subagents.length > 0 ? (
        <section className="process-tools-section subagent-process-children">
          <div className="tool-message-detail-title">子代理步骤</div>
          <ol className="tool-group-items">
            {model.subagents.map((subagent, index) => (
              <li key={subagent.run.id}>
                <details className={`tool-group-item-details ${subagent.status}`}>
                  <summary>
                    <span className="tool-group-item-index">{index + 1}</span>
                    <span className="tool-group-item-name">{subagent.run.agent}</span>
                    <span className="tool-group-item-status">{subagent.statusLabel}</span>
                    <span className="tool-group-item-summary">{subagent.summary}</span>
                  </summary>
                  <SubagentProcessDetail run={subagent.run} actions={actions} active={subagent.status === "running"} />
                </details>
              </li>
            ))}
          </ol>
        </section>
      ) : null}

      {model.tools.length > 0 ? (
        <section className="process-tools-section">
          <div className="tool-message-detail-title">工具明细</div>
          <ol className="tool-group-items">
            {model.tools.map((tool, index) => (
              <li key={`${tool.name}-${index}`}>
                <details className={`tool-group-item-details ${tool.status}`}>
                  <summary>
                    <span className="tool-group-item-index">{index + 1}</span>
                    <span className="tool-group-item-name">{tool.name}</span>
                    <span className="tool-group-item-status">{tool.statusLabel}</span>
                    <span className="tool-group-item-summary">{tool.summary}</span>
                  </summary>
                  <div className="tool-group-item-detail">
                    {tool.detail ? <ScrollablePre>{tool.detail}</ScrollablePre> : <p>暂无可展开内容</p>}
                  </div>
                </details>
              </li>
            ))}
          </ol>
        </section>
      ) : null}
    </div>
  );
}

function ScrollableContent({ className, children }: { className: string; children: ReactNode }) {
  const scrollbar = useStealthScrollbar();

  return (
    <div
      className={`${className} stealth-scroll${scrollbar.isVisible ? " is-scrolling" : ""}`}
      tabIndex={0}
      onKeyDown={scrollbar.handleKeyDown}
      onScrollCapture={scrollbar.reveal}
      onTouchMove={scrollbar.reveal}
      onWheel={scrollbar.reveal}
    >
      {children}
    </div>
  );
}

function ScrollablePre({ children }: { children: string }) {
  const scrollbar = useStealthScrollbar();

  return (
    <pre
      className={`stealth-scroll${scrollbar.isVisible ? " is-scrolling" : ""}`}
      tabIndex={0}
      onKeyDown={scrollbar.handleKeyDown}
      onScrollCapture={scrollbar.reveal}
      onTouchMove={scrollbar.reveal}
      onWheel={scrollbar.reveal}
    >
      {children}
    </pre>
  );
}

function useStealthScrollbar() {
  const [isVisible, setIsVisible] = useState(false);
  const hideTimerRef = useRef<number | undefined>(undefined);

  useEffect(() => {
    return () => {
      if (hideTimerRef.current !== undefined) window.clearTimeout(hideTimerRef.current);
    };
  }, []);

  const reveal = useCallback(() => {
    setIsVisible(true);
    if (hideTimerRef.current !== undefined) window.clearTimeout(hideTimerRef.current);
    hideTimerRef.current = window.setTimeout(() => {
      hideTimerRef.current = undefined;
      setIsVisible(false);
    }, STEALTH_SCROLLBAR_VISIBLE_MS);
  }, []);

  const handleKeyDown = useCallback(
    (event: KeyboardEvent<HTMLElement>) => {
      if (SCROLL_INTERACTION_KEYS.has(event.key)) reveal();
    },
    [reveal],
  );

  return { isVisible, reveal, handleKeyDown };
}

function formatThinkingText(thinking: Extract<ConversationDisplayBlock, { type: "tool_group" }>["model"]["thinking"]): string {
  if (thinking.length === 1) return thinking[0]?.text ?? "";
  return thinking.map((item, index) => `#### 第 ${index + 1} 段${item.isStreaming ? "（进行中）" : ""}\n\n${item.text}`).join("\n\n---\n\n");
}

const ESTIMATED_CONVERSATION_BLOCK_HEIGHT = 220;
const CONVERSATION_BLOCK_OVERSCAN = 4;
const STEALTH_SCROLLBAR_VISIBLE_MS = 900;
const SCROLL_INTERACTION_KEYS = new Set(["ArrowDown", "ArrowLeft", "ArrowRight", "ArrowUp", "End", "Home", "PageDown", "PageUp", " "]);
const NOTICE_AUTO_DISMISS_MS = 4000;
const OPERATION_ERROR_AUTO_DISMISS_MS = 8000;

function isNearBottom(element: HTMLElement): boolean {
  return element.scrollHeight - element.scrollTop - element.clientHeight < 96;
}
