import { closeSync, existsSync, openSync, readSync, readdirSync, statSync } from "node:fs";
import { homedir } from "node:os";
import { join, resolve } from "node:path";
import { StringDecoder } from "node:string_decoder";
import type { SessionMetadata } from "./types.js";
import { sessionMetadataFromLine } from "./recordParsing.js";

const SESSION_FILE_SUFFIX = ".jsonl";
export const DEFAULT_MAX_USAGE_SCAN_FILES = 2_000;
export const DEFAULT_MAX_USAGE_LINE_BYTES = 1024 * 1024;

export function sessionRootExists(root: string): boolean {
  return existsSync(root);
}

export function piSessionRoot(): string {
  return resolve(process.env.PI_GUI_SESSION_ROOT ?? join(homedir(), ".pi", "agent", "sessions"));
}

export function listSessionFiles(root: string): string[] {
  const results: string[] = [];
  const stack = [root];
  while (stack.length > 0 && results.length <= DEFAULT_MAX_USAGE_SCAN_FILES * 2) {
    const dir = stack.pop();
    if (!dir) continue;
    for (const entry of safeReadDir(dir)) {
      const fullPath = join(dir, entry);
      if (safeIsDirectory(fullPath)) stack.push(fullPath);
      else if (entry.endsWith(SESSION_FILE_SUFFIX)) results.push(fullPath);
    }
  }
  return results;
}

export function safeMtimeMs(path: string): number {
  return safeStat(path)?.mtimeMs ?? 0;
}

export function safeStat(path: string): { mtimeMs: number; size: number } | undefined {
  try {
    const stats = statSync(path);
    return { mtimeMs: stats.mtimeMs, size: stats.size };
  } catch {
    return undefined;
  }
}

export function findSessionMetadata(filePath: string, maxLineBytes: number): SessionMetadata | undefined {
  let metadata: SessionMetadata | undefined;
  let inspectedLines = 0;
  processJsonlLines(filePath, maxLineBytes, (line, truncated) => {
    inspectedLines += 1;
    if (!truncated) metadata = sessionMetadataFromLine(line);
    return metadata || inspectedLines >= 20 ? false : undefined;
  });
  return metadata;
}

export function processJsonlLines(filePath: string, maxLineBytes: number, onLine: (line: string, truncated: boolean) => false | void): boolean {
  let fd: number;
  try {
    fd = openSync(filePath, "r");
  } catch {
    return false;
  }

  const decoder = new StringDecoder("utf8");
  const buffer = Buffer.allocUnsafe(64 * 1024);
  let line = "";
  let lineBytes = 0;
  let truncated = false;

  try {
    while (true) {
      const bytesRead = readSync(fd, buffer, 0, buffer.length, null);
      if (bytesRead === 0) break;
      const chunk = decoder.write(buffer.subarray(0, bytesRead));
      for (let index = 0; index < chunk.length; index += 1) {
        const char = chunk[index];
        if (char === "\n") {
          const shouldContinue = onLine(stripTrailingCr(line), truncated);
          line = "";
          lineBytes = 0;
          truncated = false;
          if (shouldContinue === false) return true;
          continue;
        }
        if (truncated) continue;
        line += char;
        lineBytes += Buffer.byteLength(char, "utf8");
        if (lineBytes > maxLineBytes) {
          line = "";
          truncated = true;
        }
      }
    }
    const tail = decoder.end();
    for (let index = 0; index < tail.length; index += 1) {
      const char = tail[index];
      if (char === "\n") {
        const shouldContinue = onLine(stripTrailingCr(line), truncated);
        line = "";
        lineBytes = 0;
        truncated = false;
        if (shouldContinue === false) return true;
        continue;
      }
      if (truncated) continue;
      line += char;
      lineBytes += Buffer.byteLength(char, "utf8");
      if (lineBytes > maxLineBytes) {
        line = "";
        truncated = true;
      }
    }
    if (line || truncated) onLine(stripTrailingCr(line), truncated);
    return true;
  } finally {
    closeSync(fd);
  }
}

function stripTrailingCr(line: string): string {
  return line.endsWith("\r") ? line.slice(0, -1) : line;
}

function safeReadDir(path: string): string[] {
  try {
    return readdirSync(path);
  } catch {
    return [];
  }
}

function safeIsDirectory(path: string): boolean {
  try {
    return statSync(path).isDirectory();
  } catch {
    return false;
  }
}
