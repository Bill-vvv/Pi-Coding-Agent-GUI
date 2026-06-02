import type { Runtime } from "@pi-gui/shared";
import { messageRoleLabel } from "../domain/conversation";
import type { ConversationMessage } from "../types";

type ChatViewProps = {
  lastError?: string;
  activeRuntime?: Runtime;
  messages: ConversationMessage[];
};

export function ChatView({ lastError, activeRuntime, messages }: ChatViewProps) {
  return (
    <>
      {lastError ? <div className="error-banner floating-error">{lastError}</div> : null}

      <div className="conversation-surface">
        {activeRuntime ? (
          <div className="conversation-header">
            <strong>对话 {activeRuntime.id.slice(0, 8)}</strong>
            {activeRuntime.sessionId ? <small>Session {activeRuntime.sessionId.slice(0, 8)}</small> : null}
            {activeRuntime.archivedAt ? <small>已归档</small> : null}
          </div>
        ) : null}

        {messages.length > 0 ? (
          <div className="message-list">
            {messages.map((message) => (
              <article className={`chat-message ${message.role}`} key={message.id}>
                <div className="message-role">{messageRoleLabel(message.role)}</div>
                <pre>{message.text}</pre>
              </article>
            ))}
          </div>
        ) : null}
      </div>
    </>
  );
}
