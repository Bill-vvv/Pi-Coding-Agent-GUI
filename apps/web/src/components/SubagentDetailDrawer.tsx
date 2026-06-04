import type { ConversationMessage, SubagentChildRun, SubagentRun } from "@pi-gui/shared";
import { buildSubagentLiveConversationMessages, subagentModeLabel, subagentStatusLabel } from "../domain/subagents";
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

const SESSION_FILE_PENDING_ERROR = "Sub-agent session file is not available yet";

export function SubagentDetailDrawer({ run, selectedChildRunId, detail, onClose, onSelectChildRun }: SubagentDetailDrawerProps) {
  if (!run) return null;
  const selectedChild = run.runs.find((child) => child.id === selectedChildRunId) ?? run.runs[0];
  const selectedChildIndex = selectedChild ? run.runs.findIndex((child) => child.id === selectedChild.id) : -1;
  const selectedChildLabel = selectedChildIndex >= 0 ? `Child ${selectedChildIndex + 1}` : "任务";
  const childRunId = selectedChild?.id ?? selectedChildRunId;
  const childFinalText = selectedChild?.finalText?.trim();
  const groupFinalText = run.finalText?.trim();
  const childIsActive = selectedChild ? subagentChildIsActive(selectedChild) : run.status === "pending" || run.status === "running";
  const primaryFinalText = selectedChild ? childFinalText : groupFinalText;
  const primaryOutputText = primaryFinalText || (selectedChild ? childIsActive ? "运行中，等待最终输出。" : "暂无该 child 的最终输出。" : "暂无最终输出。");
  const showGroupFinalText = Boolean(selectedChild && groupFinalText && groupFinalText !== childFinalText);
  const childCount = run.runs.length || 1;
  const sessionFilePending = Boolean(selectedChild && !selectedChild.sessionFile && childIsActive);
  const detailError = detail?.error && !(sessionFilePending && detail.error === SESSION_FILE_PENDING_ERROR) ? detail.error : undefined;
  const detailMessages = detail?.messages ?? [];
  const hasDetailMessages = detailMessages.length > 0;
  const liveMessages = buildSubagentLiveConversationMessages(run, selectedChild);
  const processMessages = hasDetailMessages ? detailMessages : liveMessages;
  const processSourceLabel = hasDetailMessages ? "session" : liveMessages.length > 0 ? "实时" : selectedChild?.sessionFile || sessionFilePending ? "等待中" : "未连接";

  return (
    <aside className="subagent-drawer" role="dialog" aria-modal="false" aria-label="子代理详情">
      <header className="subagent-drawer-header">
        <div className="subagent-drawer-title">
          <span className="subagent-kicker">子代理</span>
          <div className="subagent-drawer-heading-row">
            <h2>{run.agent}</h2>
            <span className={`subagent-status-chip ${run.status}`}>{subagentStatusLabel(run.status)}</span>
          </div>
          <p>{subagentModeLabel(run.mode)} · {childCount} child</p>
        </div>
        <button className="icon-button" type="button" title="关闭" aria-label="关闭子代理详情" onClick={onClose}>
          <Icon name="x" />
        </button>
      </header>

      {run.runs.length > 1 ? (
        <div className="subagent-child-tabs subagent-scroll-area" role="tablist" aria-label="子代理 child">
          {run.runs.map((child, index) => {
            const selected = child.id === childRunId;
            return (
              <button
                className={`subagent-child-tab ${selected ? "selected" : ""}`}
                type="button"
                role="tab"
                aria-selected={selected}
                key={child.id}
                onClick={() => onSelectChildRun(child.id)}
              >
                <span>Child {index + 1}</span>
                <small>{subagentStatusLabel(child.status)}</small>
              </button>
            );
          })}
        </div>
      ) : null}

      {selectedChild ? <SelectedChildSummary child={selectedChild} /> : null}

      <div className="subagent-drawer-body" role="tabpanel" aria-label={`${selectedChildLabel} 详情`}>
        {showGroupFinalText ? (
          <details className="subagent-aggregate-output">
            <summary>
              <span>任务组输出</span>
              <small>聚合</small>
            </summary>
            <div className="subagent-final-output subagent-scroll-area" tabIndex={0}>
              <MarkdownMessage text={groupFinalText || "暂无任务组最终输出。"} />
            </div>
          </details>
        ) : null}

        <section className="subagent-drawer-section">
          <div className="subagent-drawer-section-title">
            <span>{selectedChild ? `${selectedChildLabel} 最终输出` : "最终输出"}</span>
            {selectedChild ? <small>{subagentStatusLabel(selectedChild.status)}</small> : null}
          </div>
          <div className={`subagent-final-output subagent-scroll-area${primaryFinalText ? "" : " empty"}`} tabIndex={0}>
            <MarkdownMessage text={primaryOutputText} />
          </div>
        </section>

        <section className="subagent-drawer-section grow">
          <div className="subagent-drawer-section-title">
            <span>本地过程</span>
            <small>{processSourceLabel}</small>
          </div>
          {selectedChild?.sessionFile ? <small className="subagent-session-file">{selectedChild.sessionFile}</small> : null}
          {detailError ? <p className="subagent-detail-error">{detailError}</p> : null}
          {processMessages.length > 0 ? (
            <div className="subagent-detail-message-list subagent-scroll-area" tabIndex={0}>
              <ConversationBlockList messages={processMessages} />
            </div>
          ) : !detailError ? (
            <p className="subagent-detail-empty">{selectedChild?.sessionFile ? "等待 session 内容…" : childIsActive ? "等待实时输出…" : "未上报 session 文件。"}</p>
          ) : null}
        </section>
      </div>
    </aside>
  );
}

function SelectedChildSummary({ child }: { child: SubagentChildRun }) {
  const meta = childMeta(child);

  return (
    <div className="subagent-child-summary" role="status">
      <div>
        <span className="subagent-child-label">Child runtime</span>
        <strong>{child.agent}</strong>
        {meta.length > 0 ? <p>{meta.join(" · ")}</p> : null}
      </div>
      <span className={`subagent-status-chip ${child.status}`}>{subagentStatusLabel(child.status)}</span>
    </div>
  );
}

function childMeta(child: SubagentChildRun): string[] {
  return [child.model, child.thinking ? `thinking ${child.thinking}` : undefined, usageText(child), child.sessionFile ? "session 已连接" : subagentChildIsActive(child) ? "session 等待中" : "无 session 文件"].filter((part): part is string => Boolean(part));
}

function usageText(child: SubagentChildRun): string | undefined {
  const usage = child.usage;
  if (!usage) return undefined;
  const parts = [usage.turns !== undefined ? `${usage.turns} turns` : undefined, usage.ctxTokens !== undefined ? `${formatCount(usage.ctxTokens)} ctx` : undefined].filter((part): part is string => Boolean(part));
  return parts.length > 0 ? parts.join(" · ") : undefined;
}

function subagentChildIsActive(child: SubagentChildRun): boolean {
  return child.status === "pending" || child.status === "running";
}

function formatCount(value: number): string {
  return new Intl.NumberFormat(undefined, { maximumFractionDigits: 1, notation: "compact" }).format(value);
}
