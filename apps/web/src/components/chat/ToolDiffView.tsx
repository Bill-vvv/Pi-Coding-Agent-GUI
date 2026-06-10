import type { ConversationToolDetails } from "@pi-gui/shared";

type ParsedDiffLine = {
  kind: "added" | "removed" | "context" | "meta";
  prefix: string;
  lineNumber: string;
  content: string;
};

const DIFF_LINE_RE = /^([+\-\s])(\s*\d*)\s(.*)$/;

export function ToolDiffView({ details }: { details: ConversationToolDetails }) {
  if (!details.diff) return null;
  const lines = parseToolDiff(details.diff);
  const label = details.path ? `编辑差异：${details.path}` : "编辑差异";

  return (
    <div className="tool-diff" aria-label={label}>
      <div className="tool-diff-header">
        <span>Diff</span>
        {details.path ? <span className="tool-diff-path">{details.path}</span> : null}
        {details.firstChangedLine !== undefined ? <span className="tool-diff-line-jump">L{details.firstChangedLine}</span> : null}
      </div>
      <pre className="tool-diff-pre">
        {lines.map((line, index) => (
          <span className={`tool-diff-line ${line.kind}`} key={`${index}-${line.prefix}-${line.lineNumber}`}>
            <span className="tool-diff-prefix">{line.prefix}</span>
            <span className="tool-diff-line-number">{line.lineNumber}</span>
            <span className="tool-diff-content">{line.content || " "}</span>
            {index < lines.length - 1 ? "\n" : null}
          </span>
        ))}
      </pre>
    </div>
  );
}

export function parseToolDiff(diff: string): ParsedDiffLine[] {
  return diff.split("\n").map((line): ParsedDiffLine => {
    const match = line.match(DIFF_LINE_RE);
    if (!match) return { kind: "meta", prefix: " ", lineNumber: "", content: line };
    const prefix = match[1] ?? " ";
    return {
      kind: diffLineKind(prefix),
      prefix,
      lineNumber: match[2] ?? "",
      content: match[3] ?? "",
    };
  });
}

function diffLineKind(prefix: string): ParsedDiffLine["kind"] {
  if (prefix === "+") return "added";
  if (prefix === "-") return "removed";
  return "context";
}
