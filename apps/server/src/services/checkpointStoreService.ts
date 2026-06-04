import { readFile } from "node:fs/promises";
import { join, resolve } from "node:path";
import type { Project, RewindCheckpoint, RewindCheckpointGit } from "@pi-gui/shared";
import { isRecord } from "@pi-gui/shared";

const CHECKPOINT_STORE_RELATIVE_PATH = join(".pi", "rewind", "checkpoints.jsonl");

export async function listProjectRewindCheckpoints(project: Project): Promise<RewindCheckpoint[]> {
  const storePath = join(project.cwd, CHECKPOINT_STORE_RELATIVE_PATH);
  let text: string;
  try {
    text = await readFile(storePath, "utf8");
  } catch (error) {
    if (isNotFound(error)) return [];
    throw error;
  }

  const checkpoints: RewindCheckpoint[] = [];
  const projectCwd = resolve(project.cwd);
  for (const line of text.split("\n")) {
    const trimmed = line.trim();
    if (!trimmed) continue;
    const checkpoint = parseCheckpointLine(trimmed, project.id, projectCwd);
    if (checkpoint) checkpoints.push(checkpoint);
  }

  return checkpoints.sort((left, right) => right.createdAt - left.createdAt);
}

function parseCheckpointLine(line: string, projectId: string, projectCwd: string): RewindCheckpoint | undefined {
  let value: unknown;
  try {
    value = JSON.parse(line);
  } catch {
    return undefined;
  }

  if (!isRecord(value)) return undefined;
  if (value.kind !== "checkpoint") return undefined;
  if (value.version !== 1) return undefined;
  if (typeof value.entryId !== "string") return undefined;
  if (typeof value.prompt !== "string") return undefined;
  if (typeof value.createdAt !== "number" || !Number.isFinite(value.createdAt)) return undefined;
  if (typeof value.cwd !== "string") return undefined;
  if (resolve(value.cwd) !== projectCwd) return undefined;

  const git = parseGit(value.git);
  if (!git) return undefined;

  return {
    id: typeof value.id === "string" ? value.id : value.entryId,
    projectId,
    cwd: value.cwd,
    sessionFile: typeof value.sessionFile === "string" ? value.sessionFile : undefined,
    sessionEntryId: value.entryId,
    prompt: value.prompt,
    createdAt: value.createdAt,
    git,
  };
}

function parseGit(value: unknown): RewindCheckpointGit | undefined {
  if (!isRecord(value)) return undefined;
  if (typeof value.available !== "boolean") return undefined;
  const backend = value.backend === "patch" || value.backend === "stash" ? value.backend : undefined;
  return {
    available: value.available,
    root: stringOrUndefined(value.root),
    head: stringOrUndefined(value.head),
    branch: stringOrUndefined(value.branch),
    dirty: booleanOrUndefined(value.dirty),
    backend,
    snapshotId: stringOrUndefined(value.snapshotId),
    trackedPatch: stringOrUndefined(value.trackedPatch),
    stagedPatch: stringOrUndefined(value.stagedPatch),
    untrackedDir: stringOrUndefined(value.untrackedDir),
    stashSha: stringOrUndefined(value.stashSha),
    statusPreview: stringOrUndefined(value.statusPreview),
    error: stringOrUndefined(value.error),
  };
}

function stringOrUndefined(value: unknown): string | undefined {
  return typeof value === "string" ? value : undefined;
}

function booleanOrUndefined(value: unknown): boolean | undefined {
  return typeof value === "boolean" ? value : undefined;
}

function isNotFound(error: unknown): boolean {
  return Boolean(error && typeof error === "object" && "code" in error && error.code === "ENOENT");
}
