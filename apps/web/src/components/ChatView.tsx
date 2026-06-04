import { useLayoutEffect, useRef } from "react";
import type { Runtime, RuntimeConversationSummary } from "@pi-gui/shared";
import type { ConversationMessage } from "../types";
import { isTransportConnectionError } from "../domain/connection";
import { messageRoleLabel } from "../domain/conversation";
import { buildConversationDisplayBlocks, type ConversationDisplayBlock, type ConversationDisplayMode } from "../domain/conversationDisplay";
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
  displayMode?: ConversationDisplayMode;
  onDismissOperationError?: () => void;
  onDismissNotice?: () => void;
};

export function ChatView({
  operationError,
  notice,
  connectionWarning,
  activeRuntime,
  conversationSummary,
  messages,
  activeRuntimeIsBusy,
  displayMode = "normal",
  onDismissOperationError,
  onDismissNotice,
}: ChatViewProps) {
  const surfaceRef = useRef<HTMLDivElement | null>(null);
  const bottomRef = useRef<HTMLDivElement | null>(null);
  const shouldAutoFollowRef = useRef(true);
  const blocks = buildConversationDisplayBlocks(messages, displayMode, { activeRuntimeIsBusy });
  const transportError = isTransportConnectionError(operationError) ? operationError : undefined;
  const visibleOperationError = transportError ? undefined : operationError;
  const connectionStatusMessage = connectionWarning ?? transportError;

  useLayoutEffect(() => {
    shouldAutoFollowRef.current = true;
  }, [activeRuntime?.id]);

  useLayoutEffect(() => {
    if (!shouldAutoFollowRef.current) return;
    bottomRef.current?.scrollIntoView({ block: "end" });
  }, [messages, activeRuntimeIsBusy]);

  function handleConversationScroll() {
    const surface = surfaceRef.current;
    if (!surface) return;
    shouldAutoFollowRef.current = isNearBottom(surface);
  }

  return (
    <>
      {visibleOperationError || notice ? (
        <div className="floating-feedback error-stack">
          {visibleOperationError ? <DismissibleBanner className="error-banner" message={visibleOperationError} onDismiss={onDismissOperationError} /> : null}
          {notice ? <DismissibleBanner className="notice-banner" message={notice} onDismiss={onDismissNotice} /> : null}
        </div>
      ) : null}

      <div className="conversation-surface" ref={surfaceRef} onScroll={handleConversationScroll}>
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

        {blocks.length > 0 || activeRuntimeIsBusy ? (
          <div className="message-list">
            {blocks.map((block) => renderBlock(block))}
            {activeRuntimeIsBusy && !blocks.some((block) => block.isStreaming) ? (
              <article className="chat-message assistant streaming thinking-placeholder">
                <ThinkingStatus variant="coreloop" />
              </article>
            ) : null}
            <div className="conversation-bottom-sentinel" ref={bottomRef} />
          </div>
        ) : null}
      </div>
    </>
  );
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

function renderBlock(block: ConversationDisplayBlock) {
  if (block.type === "tool_group") return <ToolGroupBlock block={block} key={block.id} />;

  const message = block.message;
  return (
    <article className={`chat-message ${message.role}${message.isStreaming ? " streaming" : ""}`} key={block.id}>
      {message.title ? <header className="chat-message-title">{message.title}</header> : null}
      {message.thinking ? (
        <details className="chat-message-thinking" open={message.isStreaming}>
          <summary>思考过程</summary>
          <MarkdownMessage text={message.thinking} />
        </details>
      ) : null}
      {renderMessageContent(message, block.displayKind)}
      {message.isStreaming ? <span className="chat-message-status">{messageRoleLabel(message.role)} 正在输出…</span> : null}
    </article>
  );
}

function renderMessageContent(message: ConversationMessage, displayKind: Extract<ConversationDisplayBlock, { type: "message" }>["displayKind"]) {
  if (!message.text && message.isStreaming) return null;
  if (displayKind === "markdown") return <MarkdownMessage text={message.text} />;
  return <pre>{message.text}</pre>;
}

function ToolGroupBlock({ block }: { block: Extract<ConversationDisplayBlock, { type: "tool_group" }> }) {
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
        {model.status === "running" ? <CurrentProcessDetail block={block} /> : <FullProcessDetail block={block} />}
      </details>
    </article>
  );
}

function CurrentProcessDetail({ block }: { block: Extract<ConversationDisplayBlock, { type: "tool_group" }> }) {
  const current = block.model.current;

  return (
    <div className="tool-group-detail compact">
      {current ? (
        <section className={`process-current-section ${current.kind} ${current.status}`}>
          <div className="process-current-header">
            <span className="process-current-title">{current.title}</span>
            <span className="process-current-status">{current.statusLabel}</span>
          </div>
          <div className="process-current-content">
            {current.kind === "thinking" ? <MarkdownMessage text={current.content} /> : <pre>{current.content}</pre>}
          </div>
        </section>
      ) : (
        <p className="process-current-empty">等待下一步动作…</p>
      )}
    </div>
  );
}

function FullProcessDetail({ block }: { block: Extract<ConversationDisplayBlock, { type: "tool_group" }> }) {
  const { model } = block;

  return (
    <div className="tool-group-detail">
      {model.thinking.length > 0 ? (
        <section className="process-thinking-section">
          <div className="tool-message-detail-title">思考过程</div>
          <div className="process-thinking-content">
            <MarkdownMessage text={formatThinkingText(model.thinking)} />
          </div>
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
                    {tool.detail ? <pre>{tool.detail}</pre> : <p>暂无可展开内容</p>}
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

function formatThinkingText(thinking: Extract<ConversationDisplayBlock, { type: "tool_group" }>["model"]["thinking"]): string {
  if (thinking.length === 1) return thinking[0]?.text ?? "";
  return thinking.map((item, index) => `#### 第 ${index + 1} 段${item.isStreaming ? "（进行中）" : ""}\n\n${item.text}`).join("\n\n---\n\n");
}

function isNearBottom(element: HTMLElement): boolean {
  return element.scrollHeight - element.scrollTop - element.clientHeight < 96;
}
