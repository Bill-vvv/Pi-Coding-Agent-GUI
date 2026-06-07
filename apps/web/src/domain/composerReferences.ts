import { formatFileReference } from "./droppedPromptFiles";

export type ComposerFileSearchEntry = {
  name: string;
  path: string;
  relativePath: string;
  type: "file" | "directory";
};

export type ComposerFileSearchResponse = {
  root: string;
  query: string;
  entries: ComposerFileSearchEntry[];
};

export type ActiveComposerReference = {
  start: number;
  end: number;
  query: string;
};

export type ComposerReferenceCompletion = {
  text: string;
  cursor: number;
};

export function activeComposerReferenceToken(prompt: string, cursor: number): ActiveComposerReference | undefined {
  const boundedCursor = Math.max(0, Math.min(cursor, prompt.length));
  const lineStart = prompt.lastIndexOf("\n", boundedCursor - 1) + 1;
  const beforeCursor = prompt.slice(lineStart, boundedCursor);
  const atIndex = beforeCursor.lastIndexOf("@");
  if (atIndex === -1) return undefined;
  const start = lineStart + atIndex;
  const token = prompt.slice(start, boundedCursor);
  if (/\s/.test(token.slice(1)) && !token.startsWith('@"')) return undefined;
  if (token.startsWith('@"') && token.slice(2).includes('"')) return undefined;
  return { start, end: boundedCursor, query: token.startsWith('@"') ? token.slice(2) : token.slice(1) };
}

export function completeComposerReference(prompt: string, active: ActiveComposerReference, entry: ComposerFileSearchEntry): ComposerReferenceCompletion {
  const reference = formatFileReference(entry.relativePath || entry.path);
  const text = `${prompt.slice(0, active.start)}${reference}${prompt.slice(active.end)}`;
  return { text, cursor: active.start + reference.length };
}
