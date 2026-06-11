import type { ConversationDisplayBlock } from "../../domain/conversationDisplay";
import { MarkdownMessage } from "../MarkdownMessage";
import { ThinkingStatus } from "../ThinkingAnimation";
import { ScrollableContent, ScrollablePre } from "./ScrollableContent";
import { SubagentProcessDetail } from "./SubagentProcessBlock";
import { ToolDiffView } from "./ToolDiffView";
import type { ConversationBlockActions } from "./types";

export function TuiProcessBlock({ block, actions }: { block: Extract<ConversationDisplayBlock, { type: "tui_process" }>; actions: ConversationBlockActions }) {
  const { model } = block;
  return (
    <article className={`chat-message tui-process ${model.kind} ${model.status}${block.isStreaming ? " streaming" : ""}`} key={block.id}>
      <details className={`tui-process-details ${model.status}`}>
        <summary>
          <span className="tui-process-glyph" aria-hidden="true">{processGlyph(model.kind, model.status)}</span>
          <span className="tui-process-title">{model.title}</span>
          <span className="tui-process-status">{model.statusLabel}</span>
          <span className="tui-process-summary">{model.summary}</span>
          {model.status === "running" ? <ThinkingStatus className="tui-process-spinner" variant="coreloop" size={22} /> : null}
        </summary>
        <div className="tui-process-detail">
          {model.kind === "thinking" ? <ThinkingDetail text={model.detail} streaming={model.status === "running"} /> : null}
          {model.kind === "tool" && model.tool ? <ToolDetail tool={model.tool} /> : null}
          {model.kind === "subagent" && model.subagent ? <SubagentProcessDetail run={model.subagent.run} actions={actions} active={model.status === "running"} /> : null}
        </div>
      </details>
    </article>
  );
}

function ThinkingDetail({ text, streaming }: { text: string; streaming: boolean }) {
  return (
    <ScrollableContent className="tui-thinking-content">
      <MarkdownMessage text={text || "Thinking ..."} streaming={streaming} />
    </ScrollableContent>
  );
}

function ToolDetail({ tool }: { tool: NonNullable<Extract<ConversationDisplayBlock, { type: "tui_process" }>["model"]["tool"]> }) {
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

function processGlyph(kind: Extract<ConversationDisplayBlock, { type: "tui_process" }>["model"]["kind"], status: Extract<ConversationDisplayBlock, { type: "tui_process" }>["model"]["status"]): string {
  if (status === "running") return "●";
  if (status === "failed") return "×";
  if (kind === "thinking") return "…";
  if (kind === "subagent") return "◌";
  return "✓";
}
