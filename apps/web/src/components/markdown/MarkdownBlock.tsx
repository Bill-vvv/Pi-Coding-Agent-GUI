import { memo } from "react";
import type { StreamingMarkdownBlock } from "../../domain/markdownStreaming";
import type { MarkdownContentSource } from "../../domain/markdownRenderDiagnostics";
import { CodeBlockRenderer } from "./CodeBlockRenderer";
import { renderMarkdownFragment } from "./markdownPipeline";

type MarkdownBlockProps = {
  block: StreamingMarkdownBlock;
  source: MarkdownContentSource;
  streaming: boolean;
};

export const MarkdownBlock = memo(function MarkdownBlock({ block, source, streaming }: MarkdownBlockProps) {
  if (block.kind === "code_fence") {
    return <CodeBlockRenderer blockId={`${source}-${block.id}`} code={block.code} language={block.language} closed={block.closed} streaming={streaming} />;
  }
  return renderMarkdownFragment(block.text, { blockIdPrefix: `${source}-${block.id}`, streaming, closedCodeBlocks: true });
}, sameMarkdownBlockProps);

function sameMarkdownBlockProps(previous: MarkdownBlockProps, next: MarkdownBlockProps): boolean {
  return previous.source === next.source
    && previous.streaming === next.streaming
    && previous.block.id === next.block.id
    && previous.block.kind === next.block.kind
    && previous.block.stable === next.block.stable
    && previous.block.start === next.block.start
    && previous.block.end === next.block.end
    && (previous.block.kind === "markdown"
      ? previous.block.text === (next.block.kind === "markdown" ? next.block.text : "")
      : previous.block.code === (next.block.kind === "code_fence" ? next.block.code : "")
        && previous.block.language === (next.block.kind === "code_fence" ? next.block.language : undefined)
        && previous.block.closed === (next.block.kind === "code_fence" ? next.block.closed : false));
}
