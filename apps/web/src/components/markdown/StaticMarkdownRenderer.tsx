import { memo } from "react";
import type { MarkdownContentSource } from "../../domain/markdownRenderDiagnostics";
import { renderMarkdownFragment } from "./markdownPipeline";

type StaticMarkdownRendererProps = {
  text: string;
  source: MarkdownContentSource;
};

export const StaticMarkdownRenderer = memo(function StaticMarkdownRenderer({ text, source }: StaticMarkdownRendererProps) {
  return <div className="markdown-message">{renderMarkdownFragment(text, { blockIdPrefix: `${source}-static`, streaming: false, closedCodeBlocks: true })}</div>;
});
