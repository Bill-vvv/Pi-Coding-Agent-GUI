import type { ReactNode } from "react";
import { useState } from "react";
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
};

export function MarkdownMessage({ text }: MarkdownMessageProps) {
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
      <pre>{children}</pre>
    </div>
  );
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
