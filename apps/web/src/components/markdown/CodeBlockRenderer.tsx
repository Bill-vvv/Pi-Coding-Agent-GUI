import { useEffect, useMemo, useState } from "react";
import hljs from "highlight.js";
import { markdownEnhancementCacheKey, scheduleDeferredMarkdownTask } from "../../domain/markdownEnhancement";
import { CopyIconButton } from "./CopyIconButton";

type CodeBlockRendererProps = {
  blockId: string;
  code: string;
  language?: string;
  closed: boolean;
  streaming: boolean;
};

type SvgPreviewState =
  | { status: "ready"; url: string }
  | { status: "invalid"; reason: string };

type SanitizedSvgResult =
  | { status: "ready"; svg: string }
  | { status: "invalid"; reason: string };

const highlightCache = new Map<string, string>();
const sanitizedSvgCache = new Map<string, SanitizedSvgResult>();

export function CodeBlockRenderer({ blockId, code, language, closed, streaming }: CodeBlockRendererProps) {
  const [highlightedHtml, setHighlightedHtml] = useState<string | undefined>();
  const svgPreview = useSvgPreview(language, code, closed);
  const highlightKey = useMemo(() => markdownEnhancementCacheKey(language, code), [code, language]);

  useEffect(() => {
    if (!closed || !code) {
      setHighlightedHtml(undefined);
      return;
    }
    const cached = highlightCache.get(highlightKey);
    if (cached !== undefined) {
      setHighlightedHtml(cached);
      return;
    }
    let cancelled = false;
    const scheduled = scheduleDeferredMarkdownTask(() => {
      if (cancelled) return;
      const html = highlightCode(code, language);
      highlightCache.set(highlightKey, html);
      if (!cancelled) setHighlightedHtml(html);
    }, { timeoutMs: streaming ? 96 : 48 });
    return () => {
      cancelled = true;
      scheduled.cancel();
    };
  }, [closed, code, highlightKey, language, streaming]);

  return (
    <div className="markdown-code-block" data-code-block-id={blockId}>
      <div className="markdown-code-header">
        <span>{language ?? "code"}</span>
        <CopyIconButton value={code} label="复制代码" disabled={!code} />
      </div>
      {svgPreview ? <SvgPreview preview={svgPreview} /> : null}
      <pre>
        <code className={language ? `language-${language}` : undefined} dangerouslySetInnerHTML={highlightedHtml ? { __html: highlightedHtml } : undefined}>
          {highlightedHtml ? undefined : code}
        </code>
      </pre>
    </div>
  );
}

function highlightCode(code: string, language?: string): string {
  try {
    if (language && hljs.getLanguage(language)) return hljs.highlight(code, { language, ignoreIllegals: true }).value;
    return hljs.highlightAuto(code).value;
  } catch {
    return escapeHtml(code);
  }
}

function escapeHtml(value: string): string {
  return value
    .replaceAll("&", "&amp;")
    .replaceAll("<", "&lt;")
    .replaceAll(">", "&gt;")
    .replaceAll('"', "&quot;")
    .replaceAll("'", "&#39;");
}

function SvgPreview({ preview }: { preview: SvgPreviewState }) {
  if (preview.status === "invalid") return <div className="markdown-svg-preview invalid">SVG 预览不可用：{preview.reason}</div>;
  return (
    <div className="markdown-svg-preview">
      <img src={preview.url} alt="SVG preview" loading="lazy" />
    </div>
  );
}

function useSvgPreview(language: string | undefined, code: string, closed: boolean): SvgPreviewState | undefined {
  const [sanitizedSvg, setSanitizedSvg] = useState<SanitizedSvgResult | undefined>();
  const [preview, setPreview] = useState<SvgPreviewState | undefined>();
  const svgKey = useMemo(() => markdownEnhancementCacheKey(language, code), [code, language]);

  useEffect(() => {
    if (!closed || language?.toLowerCase() !== "svg" || typeof DOMParser !== "function") {
      setSanitizedSvg(undefined);
      return;
    }
    const cached = sanitizedSvgCache.get(svgKey);
    if (cached) {
      setSanitizedSvg(cached);
      return;
    }
    let cancelled = false;
    const scheduled = scheduleDeferredMarkdownTask(() => {
      if (cancelled) return;
      const next = sanitizeSvgForPreview(code);
      sanitizedSvgCache.set(svgKey, next);
      if (!cancelled) setSanitizedSvg(next);
    }, { timeoutMs: 96 });
    return () => {
      cancelled = true;
      scheduled.cancel();
    };
  }, [closed, code, language, svgKey]);

  useEffect(() => {
    if (!sanitizedSvg) {
      setPreview(undefined);
      return;
    }
    if (sanitizedSvg.status === "invalid") {
      setPreview(sanitizedSvg);
      return;
    }
    if (typeof Blob !== "function" || typeof URL === "undefined" || typeof URL.createObjectURL !== "function") {
      setPreview({ status: "invalid", reason: "当前环境不支持 SVG 预览" });
      return;
    }
    const blob = new Blob([sanitizedSvg.svg], { type: "image/svg+xml" });
    const url = URL.createObjectURL(blob);
    setPreview({ status: "ready", url });
    return () => URL.revokeObjectURL(url);
  }, [sanitizedSvg]);

  return preview;
}

function sanitizeSvgForPreview(code: string): SanitizedSvgResult {
  const trimmed = code.trim();
  if (!trimmed) return { status: "invalid", reason: "内容为空" };
  const document = new DOMParser().parseFromString(trimmed, "image/svg+xml");
  if (document.querySelector("parsererror")) return { status: "invalid", reason: "SVG 语法无效" };
  const root = document.documentElement;
  if (root.localName.toLowerCase() !== "svg") return { status: "invalid", reason: "根节点不是 <svg>" };

  for (const element of Array.from(root.querySelectorAll("script, foreignObject, iframe, object, embed"))) element.remove();
  for (const styleElement of Array.from(root.querySelectorAll("style"))) {
    if (!isSafeSvgCss(styleElement.textContent ?? "")) styleElement.remove();
  }
  for (const element of [root, ...Array.from(root.querySelectorAll("*"))]) {
    for (const attribute of Array.from(element.attributes)) {
      const name = attribute.name.toLowerCase();
      const value = attribute.value.trim();
      const lowerValue = value.toLowerCase();
      if (name.startsWith("on") || lowerValue.includes("javascript:")) {
        element.removeAttribute(attribute.name);
        continue;
      }
      if ((name === "href" || name === "xlink:href" || name === "src") && !isSafeSvgReference(value)) {
        element.removeAttribute(attribute.name);
        continue;
      }
      if (name === "style" && !isSafeSvgCss(value)) element.removeAttribute(attribute.name);
    }
  }
  if (!root.getAttribute("xmlns")) root.setAttribute("xmlns", "http://www.w3.org/2000/svg");
  return { status: "ready", svg: new XMLSerializer().serializeToString(root) };
}

function isSafeSvgReference(value: string): boolean {
  return value === "" || value.startsWith("#") || /^data:image\/(?:png|jpeg|jpg|gif|webp);base64,/i.test(value);
}

function isSafeSvgCss(value: string): boolean {
  return !/(?:@import|url\s*\(|expression\s*\(|javascript:)/i.test(value);
}
