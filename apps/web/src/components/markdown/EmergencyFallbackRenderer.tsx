import { memo } from "react";
import type { MarkdownContentSource } from "../../domain/markdownRenderDiagnostics";
import { copyWithTemporaryTextarea } from "./clipboard";

type EmergencyFallbackRendererProps = {
  text: string;
  source: MarkdownContentSource;
  reason: string;
};

export const EmergencyFallbackRenderer = memo(function EmergencyFallbackRenderer({ text, source, reason }: EmergencyFallbackRendererProps) {
  const preview = previewText(text);

  async function copyFullText() {
    if (navigator.clipboard?.writeText) await navigator.clipboard.writeText(text);
    else copyWithTemporaryTextarea(text);
  }

  return (
    <div className="markdown-message large-markdown-preview" data-markdown-fallback-source={source} data-markdown-fallback-reason={reason}>
      <p className="large-markdown-preview-notice">内容渲染遇到异常，已切换到紧急保护模式。</p>
      <pre>{preview}</pre>
      <div className="large-markdown-preview-actions">
        <button type="button" onClick={() => void copyFullText()}>复制完整内容</button>
      </div>
    </div>
  );
});

function previewText(text: string): string {
  const lines = text.split(/\r?\n/);
  const visibleLines = lines.slice(0, LARGE_CONTENT_PREVIEW_LINES).join("\n");
  const visible = visibleLines.length > LARGE_CONTENT_PREVIEW_CHARS ? visibleLines.slice(0, LARGE_CONTENT_PREVIEW_CHARS) : visibleLines;
  return visible.length < text.length ? `${visible}\n\n…[紧急保护模式：完整内容可复制]` : visible;
}

const LARGE_CONTENT_PREVIEW_CHARS = 8_000;
const LARGE_CONTENT_PREVIEW_LINES = 180;
