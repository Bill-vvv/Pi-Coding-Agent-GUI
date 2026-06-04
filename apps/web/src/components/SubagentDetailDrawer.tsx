import type { ConversationMessage, SubagentRun } from "@pi-gui/shared";
import { subagentModeLabel, subagentRunPreview, subagentStatusLabel } from "../domain/subagents";
import { ConversationBlockList } from "./ChatView";
import { Icon } from "./Icon";
import { MarkdownMessage } from "./MarkdownMessage";

export type SubagentDetailState = {
  childRunId: string;
  messages: ConversationMessage[];
  readAt: number;
  error?: string;
};

type SubagentDetailDrawerProps = {
  run?: SubagentRun;
  selectedChildRunId?: string;
  detail?: SubagentDetailState;
  onClose: () => void;
  onSelectChildRun: (childRunId: string) => void;
};

export function SubagentDetailDrawer({ run, selectedChildRunId, detail, onClose, onSelectChildRun }: SubagentDetailDrawerProps) {
  if (!run) return null;
  const selectedChild = run.runs.find((child) => child.id === selectedChildRunId) ?? run.runs[0];
  const childRunId = selectedChild?.id ?? selectedChildRunId;
  const finalText = selectedChild?.finalText || run.finalText || subagentRunPreview(run, 1200);

  return (
    <aside className="subagent-drawer" role="dialog" aria-modal="false" aria-label="子代理详情">
      <header className="subagent-drawer-header">
        <div>
          <span className="subagent-card-kicker">子代理详情</span>
          <h2>{run.agent}</h2>
          <p>{subagentModeLabel(run.mode)} · {run.runs.length || 1} 个 child runtime · {subagentStatusLabel(run.status)}</p>
        </div>
        <button className="icon-button" type="button" title="关闭" aria-label="关闭子代理详情" onClick={onClose}>
          <Icon name="x" />
        </button>
      </header>

      {run.runs.length > 1 ? (
        <div className="subagent-child-tabs" role="tablist" aria-label="子代理 child runtime">
          {run.runs.map((child, index) => (
            <button
              className={child.id === childRunId ? "selected" : ""}
              type="button"
              key={child.id}
              onClick={() => onSelectChildRun(child.id)}
            >
              <span>Child {index + 1}</span>
              <small>{subagentStatusLabel(child.status)}</small>
            </button>
          ))}
        </div>
      ) : null}

      <div className="subagent-drawer-body">
        <section className="subagent-drawer-section">
          <div className="subagent-drawer-section-title">最终输出</div>
          <div className="subagent-final-output">
            <MarkdownMessage text={finalText || "暂无最终输出。"} />
          </div>
        </section>

        <section className="subagent-drawer-section grow">
          <div className="subagent-drawer-section-title">本地过程</div>
          {selectedChild?.sessionFile ? <small className="subagent-session-file">{selectedChild.sessionFile}</small> : null}
          {detail?.error ? <p className="subagent-detail-error">{detail.error}</p> : null}
          {detail && detail.messages.length > 0 ? (
            <div className="subagent-detail-message-list">
              <ConversationBlockList messages={detail.messages} />
            </div>
          ) : !detail?.error ? (
            <p className="subagent-detail-empty">等待子代理 session 内容…</p>
          ) : null}
        </section>
      </div>
    </aside>
  );
}
