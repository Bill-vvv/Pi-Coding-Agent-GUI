import type { ReactNode } from "react";
import ReactMarkdown, { type Components } from "react-markdown";
import rehypeSanitize, { defaultSchema } from "rehype-sanitize";
import remarkGfm from "remark-gfm";
import type { PluggableList } from "unified";
import { CodeBlockRenderer } from "./CodeBlockRenderer";

export const markdownSanitizeSchema = {
  ...defaultSchema,
  attributes: {
    ...defaultSchema.attributes,
    code: [...(defaultSchema.attributes?.code ?? []), ["className", /^language-./]],
    pre: [...(defaultSchema.attributes?.pre ?? []), ["className", /^language-./]],
  },
};

export const markdownRemarkPlugins: PluggableList = [remarkGfm];
export const markdownRehypePlugins: PluggableList = [[rehypeSanitize, markdownSanitizeSchema]];

type MarkdownComponentsOptions = {
  blockIdPrefix: string;
  streaming: boolean;
  closedCodeBlocks: boolean;
};

export function createMarkdownComponents({ blockIdPrefix, streaming, closedCodeBlocks }: MarkdownComponentsOptions): Components {
  return {
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
      return <CodeBlockRenderer blockId={`${blockIdPrefix}-${language ?? "code"}-${codeText.length}`} code={codeText} language={language} closed={closedCodeBlocks} streaming={streaming} />;
    },
  };
}

export function renderMarkdownFragment(text: string, options: MarkdownComponentsOptions) {
  return (
    <ReactMarkdown remarkPlugins={markdownRemarkPlugins} rehypePlugins={markdownRehypePlugins} components={createMarkdownComponents(options)}>
      {text}
    </ReactMarkdown>
  );
}

function extractText(node: ReactNode): string {
  if (node === null || node === undefined || typeof node === "boolean") return "";
  if (typeof node === "string" || typeof node === "number") return String(node);
  if (Array.isArray(node)) return node.map(extractText).join("");
  if (typeof node === "object" && "props" in node) return extractText((node.props as { children?: ReactNode }).children);
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
