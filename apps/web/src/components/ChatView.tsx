import { useEffect, useRef } from "react";
import type { Runtime, RuntimeConversationSummary } from "@pi-gui/shared";
import type { ConversationMessage } from "../types";
import { messageRoleLabel } from "../domain/conversation";
import { buildConversationDisplayBlocks, type ConversationDisplayBlock, type ConversationDisplayMode } from "../domain/conversationDisplay";
import { MarkdownMessage } from "./MarkdownMessage";

type ChatViewProps = {
  lastError?: string;
  activeRuntime?: Runtime;
  conversationSummary?: RuntimeConversationSummary;
  messages: ConversationMessage[];
  activeRuntimeIsBusy: boolean;
  displayMode?: ConversationDisplayMode;
};

export function ChatView({ lastError, activeRuntime, conversationSummary, messages, activeRuntimeIsBusy, displayMode = "normal" }: ChatViewProps) {
  const bottomRef = useRef<HTMLDivElement | null>(null);
  const blocks = buildConversationDisplayBlocks(messages, displayMode);

  useEffect(() => {
    bottomRef.current?.scrollIntoView({ block: "end" });
  }, [messages, activeRuntimeIsBusy]);

  return (
    <>
      {lastError ? <div className="error-banner floating-error">{lastError}</div> : null}

      <div className="conversation-surface">
        {activeRuntime ? (
          <div className="conversation-header">
            <strong title={conversationSummary?.title}>{conversationSummary?.title ?? `对话 ${activeRuntime.id.slice(0, 8)}`}</strong>
            {conversationSummary?.detail ? <small className="conversation-header-detail">{conversationSummary.detail}</small> : null}
            {activeRuntime.sessionId ? <small className="conversation-header-session">Session {activeRuntime.sessionId.slice(0, 8)}</small> : null}
            {activeRuntime.archivedAt ? <small>已归档</small> : null}
          </div>
        ) : null}

        {blocks.length > 0 || activeRuntimeIsBusy ? (
          <div className="message-list">
            {blocks.map((block) => renderBlock(block))}
            {activeRuntimeIsBusy && !blocks.some((block) => block.isStreaming) ? (
              <article className="chat-message assistant streaming">
                <MarkdownMessage text="Pi 正在思考…" />
              </article>
            ) : null}
            <div ref={bottomRef} />
          </div>
        ) : null}
      </div>
    </>
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
      <details className={`tool-group-details ${model.status}`}>
        <summary>
          <span className="tool-group-title">{model.title}</span>
          <span className="tool-group-status">{model.statusLabel}</span>
          <span className="tool-group-summary">{model.summary}</span>
        </summary>
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
      </details>
    </article>
  );
}

function formatThinkingText(thinking: Extract<ConversationDisplayBlock, { type: "tool_group" }>["model"]["thinking"]): string {
  if (thinking.length === 1) return thinking[0]?.text ?? "";
  return thinking.map((item, index) => `#### 第 ${index + 1} 段${item.isStreaming ? "（进行中）" : ""}\n\n${item.text}`).join("\n\n---\n\n");
}
