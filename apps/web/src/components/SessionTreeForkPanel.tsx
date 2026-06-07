import type { Runtime } from "@pi-gui/shared";
import { sessionForkMessagePreview, type SessionForkMessage } from "../domain/sessionForkMessages";
import type { SessionTreeForkMode } from "../hooks/useSessionTreeForkControls";
import { Icon } from "./Icon";
import { IconButton } from "./ui";

type SessionTreeForkPanelProps = {
  mode: SessionTreeForkMode;
  runtime?: Runtime;
  messages: SessionForkMessage[];
  loading: boolean;
  error?: string;
  notice?: string;
  onClose: () => void;
  onRefresh: () => void;
  onFork: (entryId: string) => void;
};

export function SessionTreeForkPanel({ mode, runtime, messages, loading, error, notice, onClose, onRefresh, onFork }: SessionTreeForkPanelProps) {
  const title = mode === "tree" ? "Session tree / Fork" : "创建 Fork";
  return (
    <section className="session-tree-panel" aria-label={title}>
      <header className="session-tree-header">
        <div>
          <h2>{title}</h2>
          <p>{runtime ? `${runtime.cwd} · ${runtime.sessionId ?? runtime.id.slice(0, 8)}` : "未选择 runtime"}</p>
        </div>
        <div className="session-tree-header-actions">
          <IconButton icon="refresh" label="刷新可 fork 消息" onClick={onRefresh} disabled={loading} />
          <IconButton icon="x" label="关闭" onClick={onClose} />
        </div>
      </header>

      {notice ? <p className="session-tree-notice">{notice}</p> : null}
      {error ? <p className="session-tree-error">{error}</p> : null}

      <div className="session-tree-list" aria-busy={loading}>
        {loading ? <p className="muted">正在读取可 fork 消息…</p> : null}
        {!loading && messages.length === 0 && !error ? <p className="muted">暂无可 fork 的历史用户消息。</p> : null}
        {messages.map((message, index) => (
          <button className="session-tree-item" type="button" key={message.entryId} onClick={() => onFork(message.entryId)} disabled={loading} title={message.entryId}>
            <span className="session-tree-item-index">#{index + 1}</span>
            <span className="session-tree-item-main">
              <strong>{sessionForkMessagePreview(message.text, 140)}</strong>
              <small>{message.entryId}</small>
            </span>
            <Icon name="arrow-right" />
          </button>
        ))}
      </div>
    </section>
  );
}
