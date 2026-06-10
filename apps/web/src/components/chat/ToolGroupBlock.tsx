import { subagentCopyText } from "../../domain/subagents";
import type { ConversationDisplayBlock } from "../../domain/conversationDisplay";
import { IconButton } from "../ui";
import { MarkdownMessage } from "../MarkdownMessage";
import { ThinkingStatus } from "../ThinkingAnimation";
import { ScrollableContent, ScrollablePre } from "./ScrollableContent";
import { ToolDiffView } from "./ToolDiffView";
import { SubagentProcessDetail } from "./SubagentProcessBlock";
import type { ConversationBlockActions } from "./types";

export function ToolGroupBlock({ block, actions }: { block: Extract<ConversationDisplayBlock, { type: "tool_group" }>; actions: ConversationBlockActions }) {
  const { model } = block;

  return (
    <article className={`chat-message tool-group ${model.status}${block.isStreaming ? " streaming" : ""}`} key={block.id}>
      <details className={`tool-group-details ${model.status}`}>
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
          <IconButton
            className="subagent-icon-action"
            icon="arrow-right"
            label={`查看 ${actionableSubagent.run.agent} 详情`}
            title="查看子代理详情"
            onClick={() => actions.onOpenSubagentRun?.(actionableSubagent.run.id)}
            disabled={!actions.onOpenSubagentRun}
          />
          <IconButton
            className="subagent-icon-action"
            icon="copy"
            label={`复制 ${actionableSubagent.run.agent} 结果`}
            title={copyText ? "复制子代理结果" : "暂无可复制结果"}
            onClick={() => actions.onCopySubagentOutput?.(actionableSubagent.run)}
            disabled={!copyText || !actions.onCopySubagentOutput}
          />
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
                    <ToolDetailContent tool={tool} />
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

function ToolDetailContent({ tool }: { tool: Extract<ConversationDisplayBlock, { type: "tool_group" }>["model"]["tools"][number] }) {
  if (tool.toolDetails?.diff) {
    return (
      <div className="tool-group-item-diff-detail">
        {tool.detail ? <p className="tool-diff-result">{tool.detail}</p> : null}
        <ToolDiffView details={tool.toolDetails} />
      </div>
    );
  }
  return tool.detail ? <ScrollablePre>{tool.detail}</ScrollablePre> : <p>暂无可展开内容</p>;
}

function formatThinkingText(thinking: Extract<ConversationDisplayBlock, { type: "tool_group" }>["model"]["thinking"]): string {
  if (thinking.length === 1) return thinking[0]?.text ?? "";
  return thinking.map((item, index) => `#### 第 ${index + 1} 段${item.isStreaming ? "（进行中）" : ""}\n\n${item.text}`).join("\n\n---\n\n");
}
