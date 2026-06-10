import { readFileSync, statSync } from "node:fs";
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

export function inspectPiSessionFile(filePath: string): PiSessionHealthIssue | undefined {
  const sizeBytes = statSync(filePath).size;
  if (sizeBytes < LARGE_SESSION_BYTES) return undefined;

  const content = readFileSync(filePath, "utf8");
  return inspectPiSessionContent(filePath, content, sizeBytes);
}

export function inspectPiSessionContent(filePath: string, content: string, sizeBytes = Buffer.byteLength(content)): PiSessionHealthIssue | undefined {
  let embeddedImageParts = 0;
  let largeDataStrings = 0;
  let largeBinaryStrings = 0;
  let maxRecordBytes = 0;

  for (const line of content.split("\n")) {
    if (!line.trim()) continue;
    maxRecordBytes = Math.max(maxRecordBytes, Buffer.byteLength(line));
    try {
      collectEmbeddedPayloadStats(JSON.parse(line), undefined, (kind) => {
        if (kind === "image") embeddedImageParts += 1;
        if (kind === "largeData") largeDataStrings += 1;
        if (kind === "largeBinary") largeBinaryStrings += 1;
      });
    } catch {
      if (looksBinary(line) || line.length > LARGE_EMBEDDED_STRING_CHARS) largeBinaryStrings += 1;
    }
  }

  if (sizeBytes < LARGE_SESSION_BYTES || (embeddedImageParts === 0 && largeDataStrings === 0 && largeBinaryStrings === 0)) return undefined;

  return {
    code: "embedded_image_context_too_large",
    filePath,
    sizeBytes,
    embeddedImageParts,
    largeDataStrings,
    largeBinaryStrings,
    maxRecordBytes,
    message: buildIssueMessage(filePath, sizeBytes, embeddedImageParts, largeDataStrings, largeBinaryStrings, maxRecordBytes),
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
