import type { SubagentRun } from "@pi-gui/shared";
import { subagentChildActivityPreview, subagentCopyText, subagentRunPreview, subagentStatusLabel } from "../../domain/subagents";
import { IconButton } from "../ui";
import { MarkdownMessage } from "../MarkdownMessage";
import { ScrollableContent } from "./ScrollableContent";
import type { ConversationBlockActions } from "./types";

export function SubagentProcessDetail({ run, actions, active }: { run: SubagentRun; actions: ConversationBlockActions; active: boolean }) {
  const copyText = subagentCopyText(run);
  const children = run.runs;
  const currentChild = children.find((child) => child.status === "running" || child.status === "pending") ?? latestSubagentChild(run);

  return (
    <div className={`tool-group-detail subagent-process-detail${active ? " compact" : ""}`}>
      {active ? <SubagentCurrentProcess child={currentChild} run={run} /> : null}
      {children.length > 0 ? <SubagentChildProcessList children={children} /> : null}
      <footer className="subagent-process-actions">
        <IconButton
          className="subagent-icon-action"
          icon="arrow-right"
          label={`查看 ${run.agent} 详情`}
          title="查看子代理详情"
          onClick={() => actions.onOpenSubagentRun?.(run.id)}
          disabled={!actions.onOpenSubagentRun}
        />
        <IconButton
          className="subagent-icon-action"
          icon="copy"
          label={`复制 ${run.agent} 结果`}
          title={copyText ? "复制子代理结果" : "暂无可复制结果"}
          onClick={() => actions.onCopySubagentOutput?.(run)}
          disabled={!copyText || !actions.onCopySubagentOutput}
        />
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
        <MarkdownMessage text={content || "等待子代理输出…"} source="subagent" />
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
            <details className={`tool-group-item-details ${subagentProcessStatus(child.status)}`}>
              <summary>
                <span className="tool-group-item-index">{index + 1}</span>
                <span className="tool-group-item-name">{child.agent}</span>
                <span className="tool-group-item-status">{subagentStatusLabel(child.status)}</span>
                <span className="tool-group-item-summary">{subagentChildPreview(child, 160)}</span>
              </summary>
              <div className="tool-group-item-detail">
                <MarkdownMessage text={subagentChildPreview(child, 1200)} streaming={child.status === "running" || child.status === "pending"} source="subagent" />
              </div>
            </details>
          </li>
        ))}
      </ol>
    </section>
  );
}

function subagentChildPreview(child: SubagentRun["runs"][number], maxChars: number): string {
  const text = child.finalText?.trim() || subagentChildActivityPreview(child, maxChars) || child.textTail?.trim() || child.thinkingTail?.trim() || child.errorMessage?.trim() || child.stderrTail?.trim();
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
