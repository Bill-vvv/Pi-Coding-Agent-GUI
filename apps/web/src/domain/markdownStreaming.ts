export type StreamingMarkdownBlock =
  | {
      id: string;
      kind: "markdown";
      text: string;
      stable: boolean;
      start: number;
      end: number;
    }
  | {
      id: string;
      kind: "code_fence";
      language?: string;
      code: string;
      closed: boolean;
      stable: boolean;
      start: number;
      end: number;
    };

export type StreamingMarkdownModel = {
  blocks: StreamingMarkdownBlock[];
};

export function buildStreamingMarkdownModel(text: string, _previous?: StreamingMarkdownModel): StreamingMarkdownModel {
  if (!text) return { blocks: [] };

  const blocks: StreamingMarkdownBlock[] = [];
  let cursor = 0;

  while (cursor < text.length) {
    const opening = findOpeningFence(text, cursor);
    if (!opening) {
      pushMarkdownSegment(blocks, text, cursor, text.length, false);
      break;
    }

    pushMarkdownSegment(blocks, text, cursor, opening.start, true);
    const closing = findClosingFence(text, opening.contentStart);
    if (!closing) {
      blocks.push({
        id: `code-tail-${opening.start}`,
        kind: "code_fence",
        language: opening.language,
        code: text.slice(opening.contentStart),
        closed: false,
        stable: false,
        start: opening.start,
        end: text.length,
      });
      break;
    }

    blocks.push({
      id: `code-${opening.start}`,
      kind: "code_fence",
      language: opening.language,
      code: text.slice(opening.contentStart, closing.start),
      closed: true,
      stable: true,
      start: opening.start,
      end: closing.end,
    });
    cursor = closing.end;
  }

  if (blocks.length === 0) blocks.push({ id: "markdown-tail-0", kind: "markdown", text, stable: false, start: 0, end: text.length });
  return { blocks };
}

type OpeningFence = { start: number; contentStart: number; language?: string };
type ClosingFence = { start: number; end: number };

function pushMarkdownSegment(blocks: StreamingMarkdownBlock[], text: string, start: number, end: number, stable: boolean) {
  if (end <= start) return;
  if (stable) {
    pushStableMarkdownBlocks(blocks, text, start, end);
    return;
  }

  const stableEnd = lastStableMarkdownBoundary(text, start, end);
  if (stableEnd > start) pushStableMarkdownBlocks(blocks, text, start, stableEnd);
  if (stableEnd < end) pushMarkdownBlock(blocks, text, stableEnd, end, false);
}

function pushStableMarkdownBlocks(blocks: StreamingMarkdownBlock[], text: string, start: number, end: number) {
  let cursor = start;
  while (cursor < end) {
    const boundary = nextMarkdownBoundary(text, cursor, end);
    if (boundary === undefined) {
      pushMarkdownBlock(blocks, text, cursor, end, true);
      return;
    }
    pushMarkdownBlock(blocks, text, cursor, boundary, true);
    cursor = boundary;
  }
}

function pushMarkdownBlock(blocks: StreamingMarkdownBlock[], text: string, start: number, end: number, stable: boolean) {
  if (end <= start) return;
  blocks.push({
    id: stable ? `markdown-${start}` : `markdown-tail-${start}`,
    kind: "markdown",
    text: text.slice(start, end),
    stable,
    start,
    end,
  });
}

function lastStableMarkdownBoundary(text: string, start: number, end: number): number {
  const trailingParagraphBoundary = text.lastIndexOf("\n\n", end - 1);
  if (trailingParagraphBoundary >= start) return trailingParagraphBoundary + 2;
  return start;
}

function nextMarkdownBoundary(text: string, start: number, end: number): number | undefined {
  const boundaryIndex = text.indexOf("\n\n", start);
  if (boundaryIndex < 0 || boundaryIndex + 2 >= end) return undefined;
  return boundaryIndex + 2;
}

function findOpeningFence(text: string, fromIndex: number): OpeningFence | undefined {
  let searchIndex = fromIndex;
  while (searchIndex < text.length) {
    const fenceIndex = text.indexOf("```", searchIndex);
    if (fenceIndex < 0) return undefined;
    if (!isFenceLineStart(text, fenceIndex)) {
      searchIndex = fenceIndex + 3;
      continue;
    }
    const lineEnd = findLineEnd(text, fenceIndex);
    if (lineEnd < 0) return undefined;
    return {
      start: fenceIndex,
      contentStart: lineEnd + 1,
      language: text.slice(fenceIndex + 3, lineEnd).trim() || undefined,
    };
  }
  return undefined;
}

function findClosingFence(text: string, fromIndex: number): ClosingFence | undefined {
  let searchIndex = fromIndex;
  while (searchIndex < text.length) {
    const fenceIndex = text.indexOf("```", searchIndex);
    if (fenceIndex < 0) return undefined;
    if (!isFenceLineStart(text, fenceIndex)) {
      searchIndex = fenceIndex + 3;
      continue;
    }
    const lineEnd = findLineEnd(text, fenceIndex);
    if (lineEnd < 0) return undefined;
    if (text.slice(fenceIndex + 3, lineEnd).trim() === "") {
      return { start: fenceIndex, end: lineEnd < text.length ? lineEnd + 1 : lineEnd };
    }
    searchIndex = fenceIndex + 3;
  }
  return undefined;
}

function findLineEnd(text: string, fromIndex: number): number {
  const lineEnd = text.indexOf("\n", fromIndex);
  return lineEnd >= 0 ? lineEnd : text.length;
}

function isFenceLineStart(text: string, index: number): boolean {
  return index === 0 || text.charCodeAt(index - 1) === 10;
}
