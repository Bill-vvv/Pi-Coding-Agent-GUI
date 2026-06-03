const MAX_UNTERMINATED_JSONL_PREVIEW_CHARS = 120;

export type JsonlParseBatch = {
  records: unknown[];
  errors: Error[];
};

/**
 * Strict LF-delimited JSONL parser for Pi RPC stdout.
 *
 * Pi RPC records are framed only by `\n`. A preceding `\r` is tolerated for
 * CRLF output, but other Unicode line separators are treated as ordinary text.
 */
export class LfJsonlParser {
  private buffer = "";

  push(chunk: string): JsonlParseBatch {
    const batch: JsonlParseBatch = { records: [], errors: [] };
    this.buffer += chunk;

    while (true) {
      const newlineIndex = this.buffer.indexOf("\n");
      if (newlineIndex === -1) break;

      let line = this.buffer.slice(0, newlineIndex);
      this.buffer = this.buffer.slice(newlineIndex + 1);
      if (line.endsWith("\r")) line = line.slice(0, -1);
      if (line.length === 0) continue;

      try {
        batch.records.push(JSON.parse(line));
      } catch (error) {
        batch.errors.push(new Error(`Failed to parse Pi RPC JSONL record: ${(error as Error).message}`));
      }
    }

    return batch;
  }

  end(tail = ""): JsonlParseBatch {
    const batch = this.push(tail);
    if (this.buffer.length > 0) {
      batch.errors.push(new Error(formatUnterminatedJsonlError(this.buffer)));
      this.buffer = "";
    }
    return batch;
  }
}

export function formatUnterminatedJsonlError(buffer: string): string {
  const preview =
    buffer.length > MAX_UNTERMINATED_JSONL_PREVIEW_CHARS
      ? `${buffer.slice(0, MAX_UNTERMINATED_JSONL_PREVIEW_CHARS)}…`
      : buffer;
  return `Pi RPC stdout ended with an unterminated JSONL record (${buffer.length} chars): ${JSON.stringify(preview)}`;
}
