import { existsSync, readdirSync, readFileSync, statSync } from "node:fs";
import { homedir } from "node:os";
import { basename, join, resolve } from "node:path";
import type { GuiSession, Project } from "@pi-gui/shared";
import { isRecord } from "@pi-gui/shared";
import type { AppDatabase } from "../db.js";

const SESSION_FILE_SUFFIX = ".jsonl";
const MAX_SCAN_FILES = 2_000;

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
    if (!metadata?.id || !metadata.cwd) continue;

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
  let content: string;
  try {
    content = readFileSync(filePath, "utf8");
  } catch {
    return undefined;
  }

  const lines = content.split("\n", 12);
  const firstRecord = parseJsonRecord(lines[0] ?? "");
  if (!firstRecord || firstRecord.type !== "session") return undefined;

  const id = typeof firstRecord.id === "string" ? firstRecord.id : sessionIdFromFilePath(filePath);
  const cwd = typeof firstRecord.cwd === "string" ? firstRecord.cwd : undefined;
  const timestamp = typeof firstRecord.timestamp === "string" ? firstRecord.timestamp : undefined;
  const title = extractFirstUserTitle(lines.slice(1));

  return { id, cwd, timestamp, title };
}

function extractFirstUserTitle(lines: string[]): string | undefined {
  for (const line of lines) {
    const record = parseJsonRecord(line);
    if (!record || record.type !== "message") continue;
    const message = isRecord(record.message) ? record.message : undefined;
    if (!message || message.role !== "user") continue;
    const text = extractTextContent(message.content).replace(/\s+/g, " ").trim();
    if (!text) continue;
    return text.length > 80 ? `${text.slice(0, 79)}…` : text;
  }
  return undefined;
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
