import { messageRoleLabel } from "../../domain/conversation";
import { isToolDisplayMessage, toolDisplayModel, type ConversationDisplayBlock } from "../../domain/conversationDisplay";
import type { ConversationMessage } from "../../types";
import { MarkdownMessage } from "../MarkdownMessage";
import { ScrollableContent, ScrollablePre } from "./ScrollableContent";
import { ToolGroupBlock } from "./ToolGroupBlock";
import { TuiProcessBlock } from "./TuiProcessBlock";
import { ToolDiffView } from "./ToolDiffView";
import type { ConversationBlockActions } from "./types";

export function renderBlock(block: ConversationDisplayBlock, actions: ConversationBlockActions = {}) {
  if (block.type === "tool_group") return <ToolGroupBlock block={block} actions={actions} key={block.id} />;
  if (block.type === "tui_process") return <TuiProcessBlock block={block} actions={actions} key={block.id} />;

  const message = block.message;
  const rendersInlineTool = block.displayKind === "plain" && isToolDisplayMessage(message);
  return (
    <article className={`chat-message ${message.role}${message.isStreaming ? " streaming" : ""}`} key={block.id}>
      {message.title && !rendersInlineTool ? <header className="chat-message-title">{message.title}</header> : null}
      {message.thinking ? (
        <details className="chat-message-thinking">
          <summary>{message.isStreaming ? "思考过程（进行中）" : "思考过程"}</summary>
          <ScrollableContent className="chat-message-thinking-content">
            <MarkdownMessage text={message.thinking} streaming={message.isStreaming} source="thinking" />
          </ScrollableContent>
        </details>
      ) : null}
      {renderMessageContent(message, block.displayKind)}
      {message.isStreaming ? <span className="chat-message-status">{messageRoleLabel(message.role)} 正在输出…</span> : null}
    </article>
  );
}

function renderMessageContent(message: ConversationMessage, displayKind: Extract<ConversationDisplayBlock, { type: "message" }>["displayKind"]) {
  if (!message.text) return null;
  if (displayKind === "markdown") return <MarkdownMessage text={message.text} streaming={message.isStreaming} source="message" />;
  if (isToolDisplayMessage(message)) return <InlineToolMessage message={message} />;
  return <pre>{message.text}</pre>;
}

function InlineToolMessage({ message }: { message: ConversationMessage }) {
  const model = toolDisplayModel(message);
  const summaryTitle = message.title?.trim() || `${model.name} ${model.statusLabel}`;

  return (
    <details className={`chat-message-tool-call ${model.status}`}>
      <summary>
        <span className="chat-message-tool-title">{summaryTitle}</span>
        <span className="chat-message-tool-summary">{model.summary}</span>
      </summary>
      <div className="chat-message-tool-detail">
        {model.toolDetails?.diff ? (
          <div className="tool-group-item-diff-detail">
            {model.detail ? <p className="tool-diff-result">{model.detail}</p> : null}
            <ToolDiffView details={model.toolDetails} />
          </div>
        ) : model.detail ? (
          <ScrollablePre>{model.detail}</ScrollablePre>
        ) : (
          <p>暂无可展开内容</p>
        )}
      </div>
    </details>
  );
}
