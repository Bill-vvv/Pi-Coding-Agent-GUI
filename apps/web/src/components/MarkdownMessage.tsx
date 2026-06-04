import type { ReactNode } from "react";
import { memo, useEffect, useMemo, useState } from "react";
import ReactMarkdown, { type Components } from "react-markdown";
import rehypeHighlight from "rehype-highlight";
import rehypeSanitize, { defaultSchema } from "rehype-sanitize";
import remarkGfm from "remark-gfm";

const markdownSanitizeSchema = {
  ...defaultSchema,
  attributes: {
    ...defaultSchema.attributes,
    code: [...(defaultSchema.attributes?.code ?? []), ["className", /^language-./, "hljs"]],
    pre: [...(defaultSchema.attributes?.pre ?? []), ["className", /^language-./]],
    span: [...(defaultSchema.attributes?.span ?? []), ["className", /^hljs-.*/]],
  },
};

type MarkdownMessageProps = {
  text: string;
  streaming?: boolean;
};

export const MarkdownMessage = memo(function MarkdownMessage({ text, streaming = false }: MarkdownMessageProps) {
  const [forceFullRender, setForceFullRender] = useState(false);
  const shouldUseLightweightRender = useMemo(() => !forceFullRender && shouldDegradeMarkdownRender(text, streaming), [forceFullRender, streaming, text]);

  if (shouldUseLightweightRender) {
    return <LargeMarkdownPreview text={text} streaming={streaming} onFullRender={() => setForceFullRender(true)} />;
  }

  return (
    <div className="markdown-message">
      <ReactMarkdown
        remarkPlugins={[remarkGfm]}
        rehypePlugins={[
          [rehypeHighlight, { ignoreMissing: true }],
          [rehypeSanitize, markdownSanitizeSchema],
        ]}
        components={markdownComponents}
      >
        {text}
      </ReactMarkdown>
    </div>
  );
});

function LargeMarkdownPreview({ text, streaming, onFullRender }: { text: string; streaming: boolean; onFullRender: () => void }) {
  const preview = previewText(text);
  async function copyFullText() {
    if (navigator.clipboard?.writeText) await navigator.clipboard.writeText(text);
    else copyWithTemporaryTextarea(text);
  }

  return (
    <div className="markdown-message large-markdown-preview">
      <p className="large-markdown-preview-notice">
        {streaming ? "内容正在持续输出，已临时使用轻量渲染。" : "内容较大，已使用轻量渲染以避免界面卡顿。"}
      </p>
      <pre>{preview}</pre>
      <div className="large-markdown-preview-actions">
        <button type="button" onClick={onFullRender}>完整渲染</button>
        <button type="button" onClick={() => void copyFullText()}>复制完整内容</button>
      </div>
    </div>
  );
}

const markdownComponents: Components = {
  a({ href, children, ...props }) {
    return (
      <a href={href} target="_blank" rel="noreferrer" {...props}>
        {children}
      </a>
    );
  },
  pre({ children }) {
    const codeText = extractText(children).replace(/\n$/, "");
    const language = findLanguage(children);
    return <CodeBlock code={codeText} language={language}>{children}</CodeBlock>;
  },
};

type CodeBlockProps = {
  code: string;
  language?: string;
  children: ReactNode;
};

function CodeBlock({ code, language, children }: CodeBlockProps) {
  const [copied, setCopied] = useState(false);
  const svgPreview = useSvgPreview(language, code);

  async function copyCode() {
    if (!code) return;
    try {
      if (navigator.clipboard?.writeText) {
        await navigator.clipboard.writeText(code);
      } else {
        copyWithTemporaryTextarea(code);
      }
      setCopied(true);
      window.setTimeout(() => setCopied(false), 1400);
    } catch {
      copyWithTemporaryTextarea(code);
      setCopied(true);
      window.setTimeout(() => setCopied(false), 1400);
    }
  }

  return (
    <div className="markdown-code-block">
      <div className="markdown-code-header">
        <span>{language ?? "code"}</span>
        <button type="button" onClick={copyCode} disabled={!code}>
          {copied ? "已复制" : "复制"}
        </button>
      </div>
      {svgPreview ? <SvgPreview preview={svgPreview} /> : null}
      <pre>{children}</pre>
    </div>
  );
}

type SvgPreviewState =
  | { status: "ready"; url: string }
  | { status: "invalid"; reason: string };

function SvgPreview({ preview }: { preview: SvgPreviewState }) {
  if (preview.status === "invalid") {
    return <div className="markdown-svg-preview invalid">SVG 预览不可用：{preview.reason}</div>;
  }
  return (
    <div className="markdown-svg-preview">
      <img src={preview.url} alt="SVG preview" loading="lazy" />
    </div>
  );
}

function useSvgPreview(language: string | undefined, code: string): SvgPreviewState | undefined {
  const sanitizedSvg = useMemo(() => {
    if (language?.toLowerCase() !== "svg") return undefined;
    return sanitizeSvgForPreview(code);
  }, [code, language]);
  const [preview, setPreview] = useState<SvgPreviewState | undefined>();

  useEffect(() => {
    if (!sanitizedSvg) {
      setPreview(undefined);
      return;
    }
    if (sanitizedSvg.status === "invalid") {
      setPreview(sanitizedSvg);
      return;
    }
    const blob = new Blob([sanitizedSvg.svg], { type: "image/svg+xml" });
    const url = URL.createObjectURL(blob);
    setPreview({ status: "ready", url });
    return () => URL.revokeObjectURL(url);
  }, [sanitizedSvg]);

  return preview;
}

function sanitizeSvgForPreview(code: string): { status: "ready"; svg: string } | { status: "invalid"; reason: string } {
  const trimmed = code.trim();
  if (!trimmed) return { status: "invalid", reason: "内容为空" };
  const document = new DOMParser().parseFromString(trimmed, "image/svg+xml");
  if (document.querySelector("parsererror")) return { status: "invalid", reason: "SVG 语法无效" };
  const root = document.documentElement;
  if (root.localName.toLowerCase() !== "svg") return { status: "invalid", reason: "根节点不是 <svg>" };

  for (const element of Array.from(root.querySelectorAll("script, foreignObject, iframe, object, embed"))) {
    element.remove();
  }
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
      if (name === "style" && !isSafeSvgCss(value)) {
        element.removeAttribute(attribute.name);
      }
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

function shouldDegradeMarkdownRender(text: string, streaming: boolean): boolean {
  if (streaming && text.length > STREAMING_LIGHTWEIGHT_RENDER_CHARS) return true;
  if (text.length > MARKDOWN_LIGHTWEIGHT_RENDER_CHARS) return true;
  return fencedCodeBlocks(text).some((code) => code.length > CODE_BLOCK_LIGHTWEIGHT_RENDER_CHARS || lineCount(code) > CODE_BLOCK_LIGHTWEIGHT_RENDER_LINES);
}

function previewText(text: string): string {
  const lines = text.split(/\r?\n/);
  const visibleLines = lines.slice(0, LARGE_CONTENT_PREVIEW_LINES).join("\n");
  const visible = visibleLines.length > LARGE_CONTENT_PREVIEW_CHARS ? visibleLines.slice(0, LARGE_CONTENT_PREVIEW_CHARS) : visibleLines;
  return visible.length < text.length ? `${visible}\n\n…[完整内容可复制或手动完整渲染]` : visible;
}

function fencedCodeBlocks(text: string): string[] {
  const blocks: string[] = [];
  const pattern = /```[^\n]*\n([\s\S]*?)```/g;
  let match: RegExpExecArray | null;
  while ((match = pattern.exec(text))) blocks.push(match[1] ?? "");
  return blocks;
}

function lineCount(text: string): number {
  if (!text) return 0;
  return text.split(/\r?\n/).length;
}

function copyWithTemporaryTextarea(value: string) {
  const textarea = document.createElement("textarea");
  textarea.value = value;
  textarea.style.position = "fixed";
  textarea.style.left = "-9999px";
  textarea.style.top = "0";
  document.body.append(textarea);
  textarea.select();
  document.execCommand("copy");
  textarea.remove();
}

function extractText(node: ReactNode): string {
  if (node === null || node === undefined || typeof node === "boolean") return "";
  if (typeof node === "string" || typeof node === "number") return String(node);
  if (Array.isArray(node)) return node.map(extractText).join("");
  if (typeof node === "object" && "props" in node) {
    const props = node.props as { children?: ReactNode };
    return extractText(props.children);
  }
  return "";
}

const CODE_BLOCK_LIGHTWEIGHT_RENDER_CHARS = 20_000;
const CODE_BLOCK_LIGHTWEIGHT_RENDER_LINES = 500;
const MARKDOWN_LIGHTWEIGHT_RENDER_CHARS = 120_000;
const STREAMING_LIGHTWEIGHT_RENDER_CHARS = 50_000;
const LARGE_CONTENT_PREVIEW_CHARS = 8_000;
const LARGE_CONTENT_PREVIEW_LINES = 180;

function findLanguage(node: ReactNode): string | undefined {
  if (node === null || node === undefined || typeof node === "boolean") return undefined;
  if (Array.isArray(node)) return node.map(findLanguage).find(Boolean);
  if (typeof node === "object" && "props" in node) {
    const props = node.props as { className?: string; children?: ReactNode };
    const match = /(?:^|\s)language-([^\s]+)/.exec(props.className ?? "");
    return match?.[1] ?? findLanguage(props.children);
  }
  return undefined;
}
