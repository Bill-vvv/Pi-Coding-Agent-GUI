import { memo, useMemo } from "react";
import type { MarkdownContentSource } from "../../domain/markdownRenderDiagnostics";
import { reportMarkdownEmergencyFallback } from "../../domain/markdownRenderDiagnostics";
import { buildStreamingMarkdownModel } from "../../domain/markdownStreaming";
import { EmergencyFallbackRenderer } from "./EmergencyFallbackRenderer";
import { MarkdownBlock } from "./MarkdownBlock";

type StreamingMarkdownRendererProps = {
  text: string;
  source: MarkdownContentSource;
};

export const StreamingMarkdownRenderer = memo(function StreamingMarkdownRenderer({ text, source }: StreamingMarkdownRendererProps) {
  const modelResult = useMemo<{ model: ReturnType<typeof buildStreamingMarkdownModel> } | { reason: string }>(() => {
    try {
      return { model: buildStreamingMarkdownModel(text) };
    } catch (error) {
      return { reason: (error as Error).message || "streaming-model-build-failed" };
    }
  }, [text]);

  if ("reason" in modelResult) {
    reportMarkdownEmergencyFallback({ source, streaming: true, textLength: text.length, reason: modelResult.reason });
    return <EmergencyFallbackRenderer text={text} source={source} reason={modelResult.reason} />;
  }

  return (
    <div className="markdown-message">
      {modelResult.model.blocks.map((block) => (
        <MarkdownBlock block={block} key={block.id} source={source} streaming={true} />
      ))}
    </div>
  );
});
