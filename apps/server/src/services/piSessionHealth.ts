import { closeSync, openSync, readFileSync, readSync, statSync } from "node:fs";
import { StringDecoder } from "node:string_decoder";
import { isRecord } from "@pi-gui/shared";

export type PiSessionHealthIssueCode = "embedded_image_context_too_large";

export type PiSessionHealthIssue = {
  code: PiSessionHealthIssueCode;
  filePath: string;
  sizeBytes: number;
  embeddedImageParts: number;
  largeDataStrings: number;
  largeBinaryStrings: number;
  maxRecordBytes: number;
  message: string;
};

const LARGE_SESSION_BYTES = 16 * 1024 * 1024;
const LARGE_EMBEDDED_STRING_CHARS = 100_000;
const INSPECTOR_VERSION = 1;
const STREAM_CHUNK_BYTES = 64 * 1024;
const healthCache = new Map<string, { inspectorVersion: number; mtimeMs: number; sizeBytes: number; issue?: PiSessionHealthIssue }>();

export function inspectPiSessionFile(filePath: string): PiSessionHealthIssue | undefined {
  const stats = statSync(filePath);
  const sizeBytes = stats.size;
  if (sizeBytes < LARGE_SESSION_BYTES) return undefined;

  const cached = healthCache.get(filePath);
  if (cached && cached.inspectorVersion === INSPECTOR_VERSION && cached.mtimeMs === stats.mtimeMs && cached.sizeBytes === sizeBytes) return cached.issue;

  const issue = inspectPiSessionFileStream(filePath, sizeBytes);
  healthCache.set(filePath, { inspectorVersion: INSPECTOR_VERSION, mtimeMs: stats.mtimeMs, sizeBytes, issue });
  return issue;
}

export function inspectPiSessionContent(filePath: string, content: string, sizeBytes = Buffer.byteLength(content)): PiSessionHealthIssue | undefined {
  return inspectPiSessionLines(filePath, content.split("\n"), sizeBytes);
}

function inspectPiSessionFileStream(filePath: string, sizeBytes: number): PiSessionHealthIssue | undefined {
  const fd = openSync(filePath, "r");
  const decoder = new StringDecoder("utf8");
  const buffer = Buffer.allocUnsafe(STREAM_CHUNK_BYTES);
  let pending = "";
  const stats = emptyInspectionStats();

  try {
    let bytesRead = 0;
    while ((bytesRead = readSync(fd, buffer, 0, buffer.length, null)) > 0) {
      pending += decoder.write(buffer.subarray(0, bytesRead));
      let newlineIndex = pending.indexOf("\n");
      while (newlineIndex >= 0) {
        inspectPiSessionLine(stats, pending.slice(0, newlineIndex));
        pending = pending.slice(newlineIndex + 1);
        newlineIndex = pending.indexOf("\n");
      }
    }
    pending += decoder.end();
    if (pending) inspectPiSessionLine(stats, pending);
  } finally {
    closeSync(fd);
  }

  return inspectionIssueFromStats(filePath, stats, sizeBytes);
}

function inspectPiSessionLines(filePath: string, lines: Iterable<string>, sizeBytes: number): PiSessionHealthIssue | undefined {
  const stats = emptyInspectionStats();
  for (const line of lines) inspectPiSessionLine(stats, line);
  return inspectionIssueFromStats(filePath, stats, sizeBytes);
}

type InspectionStats = {
  embeddedImageParts: number;
  largeDataStrings: number;
  largeBinaryStrings: number;
  maxRecordBytes: number;
};

function emptyInspectionStats(): InspectionStats {
  return { embeddedImageParts: 0, largeDataStrings: 0, largeBinaryStrings: 0, maxRecordBytes: 0 };
}

function inspectPiSessionLine(stats: InspectionStats, line: string): void {
  if (!line.trim()) return;
  stats.maxRecordBytes = Math.max(stats.maxRecordBytes, Buffer.byteLength(line));
  try {
    collectEmbeddedPayloadStats(JSON.parse(line), undefined, (kind) => {
      if (kind === "image") stats.embeddedImageParts += 1;
      if (kind === "largeData") stats.largeDataStrings += 1;
      if (kind === "largeBinary") stats.largeBinaryStrings += 1;
    });
  } catch {
    if (looksBinary(line) || line.length > LARGE_EMBEDDED_STRING_CHARS) stats.largeBinaryStrings += 1;
  }
}

function inspectionIssueFromStats(filePath: string, stats: InspectionStats, sizeBytes: number): PiSessionHealthIssue | undefined {
  if (sizeBytes < LARGE_SESSION_BYTES || (stats.embeddedImageParts === 0 && stats.largeDataStrings === 0 && stats.largeBinaryStrings === 0)) return undefined;

  return {
    code: "embedded_image_context_too_large",
    filePath,
    sizeBytes,
    embeddedImageParts: stats.embeddedImageParts,
    largeDataStrings: stats.largeDataStrings,
    largeBinaryStrings: stats.largeBinaryStrings,
    maxRecordBytes: stats.maxRecordBytes,
    message: buildIssueMessage(filePath, sizeBytes, stats.embeddedImageParts, stats.largeDataStrings, stats.largeBinaryStrings, stats.maxRecordBytes),
  };
}

function collectEmbeddedPayloadStats(value: unknown, key: string | undefined, onFinding: (kind: "image" | "largeData" | "largeBinary") => void): void {
  if (typeof value === "string") {
    if ((key === "data" || key === "image" || key === "base64") && value.length >= LARGE_EMBEDDED_STRING_CHARS) onFinding("largeData");
    if (value.length >= LARGE_EMBEDDED_STRING_CHARS && looksBinary(value)) onFinding("largeBinary");
    return;
  }
  if (Array.isArray(value)) {
    for (const item of value) collectEmbeddedPayloadStats(item, key, onFinding);
    return;
  }
  if (!isRecord(value)) return;

  if (value.type === "image" && typeof value.data === "string") onFinding("image");
  for (const [childKey, childValue] of Object.entries(value)) collectEmbeddedPayloadStats(childValue, childKey, onFinding);
}

function looksBinary(value: string): boolean {
  const sample = value.slice(0, 4096);
  if (!sample) return false;
  let suspicious = 0;
  for (const char of sample) {
    const code = char.charCodeAt(0);
    if ((code < 32 && char !== "\n" && char !== "\r" && char !== "\t") || code === 0xfffd) suspicious += 1;
  }
  return suspicious / sample.length > 0.02;
}

function buildIssueMessage(filePath: string, sizeBytes: number, embeddedImageParts: number, largeDataStrings: number, largeBinaryStrings: number, maxRecordBytes: number): string {
  const findings = [
    embeddedImageParts ? `${embeddedImageParts} embedded image part(s)` : undefined,
    largeDataStrings ? `${largeDataStrings} large base64/data string(s)` : undefined,
    largeBinaryStrings ? `${largeBinaryStrings} large binary-looking string(s)` : undefined,
  ].filter(Boolean);
  return [
    `Pi session is too large to resume safely: ${formatBytes(sizeBytes)} at ${filePath}.`,
    `Detected ${findings.join(", ")} with largest JSONL record ${formatBytes(maxRecordBytes)}.`,
    "Resuming or continuing this session can resend embedded image/base64 tool results to the provider and trigger WebSocket 1009 'message too big' or SSE header timeouts.",
    "This matches a GUI/RPC boundary issue: clean oversized embedded image/base64 blocks, reduce image payloads, or start a new conversation before retrying.",
    `Start a new conversation, or sanitize a copy with: node scripts/sanitize-pi-session.mjs --apply ${JSON.stringify(filePath)}`,
  ].join(" ");
}

function formatBytes(bytes: number): string {
  if (bytes >= 1024 * 1024) return `${(bytes / 1024 / 1024).toFixed(1)} MB`;
  if (bytes >= 1024) return `${(bytes / 1024).toFixed(1)} KB`;
  return `${Math.floor(bytes)} B`;
}
