import { closeSync, existsSync, openSync, readFileSync, readSync, readdirSync, statSync } from "node:fs";
import { homedir } from "node:os";
import { basename, join, resolve } from "node:path";
import type { GuiSession, Project } from "@pi-gui/shared";
import { isRecord, stripSerializedToolCallsFromText } from "@pi-gui/shared";
import type { AppDatabase } from "../db.js";

const SESSION_FILE_SUFFIX = ".jsonl";
const MAX_SCAN_FILES = 2_000;
const SUMMARY_WINDOW_BYTES = 512 * 1024;
const FULL_SUMMARY_MAX_BYTES = SUMMARY_WINDOW_BYTES * 2;
const TITLE_MAX_LENGTH = 80;
const DETAIL_MAX_LENGTH = 96;

export type PiSessionConversationSummary = {
  title?: string;
  detail?: string;
  updatedAt?: number;
  messageCount: number;
  latestAssistantCompletedAt?: number;
};

export function indexKnownPiSessions(db: AppDatabase): GuiSession[] {
  const projects = db.listProjects();
  if (projects.length === 0) return [];

  const indexed: GuiSession[] = [];
  for (const discovered of discoverPiSessions(projects)) {
    indexed.push(db.upsertSession(discovered));
  }
  return indexed;
}

export function findPiSessionFileById(sessionId: string, cwd?: string): string | undefined {
  const root = piSessionRoot();
  if (!existsSync(root)) return undefined;

  const candidateDirs = cwd ? [join(root, piSessionDirNameFromCwd(cwd)), ...listSessionDirs(root)] : listSessionDirs(root);
  const seenDirs = new Set<string>();

  for (const dir of candidateDirs) {
    if (seenDirs.has(dir) || !existsSync(dir)) continue;
    seenDirs.add(dir);

    for (const file of safeReadDir(dir)) {
      if (!file.endsWith(`${sessionId}${SESSION_FILE_SUFFIX}`)) continue;
      const fullPath = join(dir, file);
      const metadata = readSessionMetadata(fullPath);
      if (!metadata || metadata.id === sessionId) return fullPath;
    }
  }

  return undefined;
}

function discoverPiSessions(projects: Project[]): GuiSession[] {
  const projectByCwd = new Map(projects.map((project) => [resolve(project.cwd), project]));
  const root = piSessionRoot();
  if (!existsSync(root)) return [];

  const files = listSessionFiles(root)
    .map((filePath) => ({ filePath, mtimeMs: safeMtimeMs(filePath) }))
    .sort((left, right) => right.mtimeMs - left.mtimeMs)
    .slice(0, MAX_SCAN_FILES);

  const sessions: GuiSession[] = [];
  for (const { filePath, mtimeMs } of files) {
    const metadata = readSessionMetadata(filePath);
    if (!metadata?.id || !metadata.cwd || !metadata.title) continue;

    const project = projectByCwd.get(resolve(metadata.cwd));
    if (!project) continue;

    const createdAt = metadata.timestamp ? Date.parse(metadata.timestamp) : Number.NaN;
    sessions.push({
      id: metadata.id,
      projectId: project.id,
      piSessionFile: filePath,
      title: metadata.title,
      createdAt: Number.isFinite(createdAt) ? createdAt : Math.trunc(mtimeMs || Date.now()),
      updatedAt: Math.trunc(mtimeMs || Date.now()),
    });
  }

  return sessions;
}

function readSessionMetadata(filePath: string): { id?: string; cwd?: string; timestamp?: string; title?: string } | undefined {
  const content = readSessionSummaryContent(filePath);
  if (!content) return undefined;

  const firstRecord = parseJsonRecord(content.prefix.split("\n", 1)[0] ?? "");
  if (!firstRecord || firstRecord.type !== "session") return undefined;

  const id = typeof firstRecord.id === "string" ? firstRecord.id : sessionIdFromFilePath(filePath);
  const cwd = typeof firstRecord.cwd === "string" ? firstRecord.cwd : undefined;
  const timestamp = typeof firstRecord.timestamp === "string" ? firstRecord.timestamp : undefined;
  const title = piSessionConversationSummaryFromContent(content)?.title;

  return { id, cwd, timestamp, title };
}

export function readPiSessionConversationSummary(filePath: string): PiSessionConversationSummary | undefined {
  const content = readSessionSummaryContent(filePath);
  return content ? piSessionConversationSummaryFromContent(content) : undefined;
}

function piSessionConversationSummaryFromContent(content: SessionSummaryContent): PiSessionConversationSummary | undefined {
  const seen = new Set<string>();
  let firstCandidate: SummaryCandidate | undefined;
  let firstUser: SummaryCandidate | undefined;
  let latestCandidate: SummaryCandidate | undefined;
  let latestAssistantCompletedAt = 0;
  let messageCount = 0;

  for (const record of parseMessageRecords(content)) {
    const candidate = summaryCandidateFromRecord(record);
    if (!candidate) continue;
    const key = candidate.id ?? `${candidate.role}:${candidate.timestamp}:${candidate.text}`;
    if (seen.has(key)) continue;
    seen.add(key);
    messageCount += 1;
    if (!firstCandidate || candidate.timestamp < firstCandidate.timestamp) firstCandidate = candidate;
    if (candidate.role === "user" && (!firstUser || candidate.timestamp < firstUser.timestamp)) firstUser = candidate;
    if (!latestCandidate || candidate.timestamp >= latestCandidate.timestamp) latestCandidate = candidate;
    if (candidate.role === "assistant" && candidate.timestamp > latestAssistantCompletedAt) latestAssistantCompletedAt = candidate.timestamp;
  }

  const titleSource = firstUser ?? firstCandidate;
  const title = summaryText(titleSource?.text, TITLE_MAX_LENGTH);
  const latestText = summaryText(latestCandidate?.text, DETAIL_MAX_LENGTH);
  const detail = latestCandidate && latestCandidate.id !== titleSource?.id && latestText && latestText !== title ? latestText : undefined;

  if (!title && !detail) return undefined;
  return {
    title,
    detail,
    updatedAt: latestCandidate?.timestamp,
    messageCount,
    latestAssistantCompletedAt: latestAssistantCompletedAt || undefined,
  };
}

function extractTextContent(content: unknown): string {
  if (typeof content === "string") return content;
  if (!Array.isArray(content)) return "";
  return content
    .map((item) => {
      if (!isRecord(item)) return "";
      if (typeof item.text === "string") return item.text;
      if (typeof item.content === "string") return item.content;
      return "";
    })
    .filter(Boolean)
    .join("\n");
}

type SessionSummaryContent = { prefix: string; suffix?: string };
type SummaryCandidate = { id?: string; role: "user" | "assistant"; text: string; timestamp: number };

function readSessionSummaryContent(filePath: string): SessionSummaryContent | undefined {
  try {
    const size = statSync(filePath).size;
    if (size <= FULL_SUMMARY_MAX_BYTES) return { prefix: readFileSync(filePath, "utf8") };

    const fd = openSync(filePath, "r");
    try {
      const prefixBuffer = Buffer.alloc(Math.min(SUMMARY_WINDOW_BYTES, size));
      readSync(fd, prefixBuffer, 0, prefixBuffer.length, 0);
      const suffixLength = Math.min(SUMMARY_WINDOW_BYTES, size);
      const suffixBuffer = Buffer.alloc(suffixLength);
      readSync(fd, suffixBuffer, 0, suffixLength, Math.max(0, size - suffixLength));
      return { prefix: prefixBuffer.toString("utf8"), suffix: suffixBuffer.toString("utf8") };
    } finally {
      closeSync(fd);
    }
  } catch {
    return undefined;
  }
}

function parseMessageRecords(content: SessionSummaryContent): Record<string, unknown>[] {
  const chunks = content.suffix ? [content.prefix, content.suffix] : [content.prefix];
  const records: Record<string, unknown>[] = [];
  for (const chunk of chunks) {
    for (const line of chunk.split("\n")) {
      const record = parseJsonRecord(line);
      if (record?.type === "message") records.push(record);
    }
  }
  return records;
}

function summaryCandidateFromRecord(record: Record<string, unknown>): SummaryCandidate | undefined {
  const message = isRecord(record.message) ? record.message : undefined;
  if (!message) return undefined;
  const role = message.role;
  if (role !== "user" && role !== "assistant") return undefined;
  const text = summaryText(extractTextContent(message.content), role === "user" ? TITLE_MAX_LENGTH : DETAIL_MAX_LENGTH);
  if (!text) return undefined;
  return {
    id: typeof record.id === "string" ? record.id : undefined,
    role,
    text,
    timestamp: timestampFromRecord(record, message),
  };
}

function timestampFromRecord(record: Record<string, unknown>, message: Record<string, unknown>): number {
  const outer = timestampValue(record.timestamp);
  if (outer) return outer;
  const inner = timestampValue(message.timestamp);
  return inner || 0;
}

function timestampValue(value: unknown): number | undefined {
  if (typeof value === "number" && Number.isFinite(value)) return value < 10_000_000_000 ? Math.trunc(value * 1000) : Math.trunc(value);
  if (typeof value !== "string") return undefined;
  const parsed = Date.parse(value);
  return Number.isFinite(parsed) ? parsed : undefined;
}

function summaryText(value: string | undefined, maxLength: number): string | undefined {
  const normalized = stripSerializedToolCallsFromText(value ?? "")
    .replace(/```[\s\S]*?```/g, "代码块")
    .replace(/`([^`]+)`/g, "$1")
    .replace(/\s+/g, " ")
    .trim();
  if (!normalized) return undefined;
  return normalized.length > maxLength ? `${normalized.slice(0, Math.max(0, maxLength - 1))}…` : normalized;
}

function parseJsonRecord(line: string): Record<string, unknown> | undefined {
  const trimmed = line.trim();
  if (!trimmed) return undefined;
  try {
    const parsed = JSON.parse(trimmed) as unknown;
    return isRecord(parsed) ? parsed : undefined;
  } catch {
    return undefined;
  }
}

function listSessionFiles(root: string): string[] {
  return listSessionDirs(root).flatMap((dir) =>
    safeReadDir(dir)
      .filter((file) => file.endsWith(SESSION_FILE_SUFFIX))
      .map((file) => join(dir, file)),
  );
}

function listSessionDirs(root: string): string[] {
  return safeReadDir(root)
    .map((entry) => join(root, entry))
    .filter((path) => safeIsDirectory(path));
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

function safeMtimeMs(path: string): number {
  try {
    return statSync(path).mtimeMs;
  } catch {
    return 0;
  }
}

function piSessionRoot(): string {
  return resolve(process.env.PI_GUI_SESSION_ROOT ?? join(homedir(), ".pi", "agent", "sessions"));
}

function piSessionDirNameFromCwd(cwd: string): string {
  return `--${resolve(cwd).split(/[\\/]+/).filter(Boolean).join("-")}--`;
}

function sessionIdFromFilePath(filePath: string): string | undefined {
  const name = basename(filePath, SESSION_FILE_SUFFIX);
  const separatorIndex = name.lastIndexOf("_");
  return separatorIndex >= 0 ? name.slice(separatorIndex + 1) : undefined;
}
