import { randomUUID } from "node:crypto";
import { chmod, lstat, mkdir, readFile, readdir, readlink, rename, rm, stat, symlink, writeFile } from "node:fs/promises";
import { dirname, join, resolve } from "node:path";
import { RewindObjectStore, sha256 } from "./objectStore.js";
import { classifyPolicyPath, createDefaultPolicy, normalizeRelativePath, normalizeRoot, resolveRelativePath, toRelativePath } from "./paths.js";
import {
  REWIND_STORE_VERSION,
  type RewindCapturePolicy,
  type RewindPreviewAction,
  type RewindPreviewChange,
  type RewindPreviewResult,
  type RewindRestoreResult,
  type RewindSkippedEntry,
  type RewindSnapshotEntry,
  type RewindSnapshotManifest,
  type RewindSnapshotOptions,
  type RewindSnapshotSummary,
} from "./types.js";

const RESTORE_LOCKS = new Set<string>();
const PREVIEW_ACTIONS: RewindPreviewAction[] = ["add", "modify", "delete", "recreate", "overwrite", "unchanged", "skip", "conflict"];

export class RewindSnapshotStore {
  readonly root: string;
  readonly storeRoot: string;
  readonly policy: RewindCapturePolicy;
  private readonly manifestsRoot: string;
  private readonly objects: RewindObjectStore;
  private readonly now: () => number;
  private readonly idFactory: () => string;

  constructor(options: RewindSnapshotOptions) {
    this.root = normalizeRoot(options.root);
    this.storeRoot = resolve(options.storeRoot ?? join(this.root, ".pi", "rewind"));
    this.policy = createDefaultPolicy(options.policy);
    this.manifestsRoot = join(this.storeRoot, "manifests");
    this.objects = new RewindObjectStore(this.storeRoot);
    this.now = options.now ?? Date.now;
    this.idFactory = options.idFactory ?? (() => randomUUID());
  }

  async captureWorkspace(id = this.idFactory()): Promise<RewindSnapshotManifest> {
    const state = createCaptureState(id, this.root, this.now());
    await this.walkDirectory(this.root, state, { storeObjects: true, respectPolicy: true });
    return this.writeManifest(finalizeManifest(state));
  }

  async loadSnapshot(id: string): Promise<RewindSnapshotManifest> {
    const manifestPath = this.manifestPath(id);
    const raw = await readFile(manifestPath, "utf8");
    return validateManifest(JSON.parse(raw), id, this.root);
  }

  async listSnapshots(): Promise<RewindSnapshotManifest[]> {
    const files = await readdir(this.manifestsRoot).catch((error: unknown) => {
      if (isNotFoundError(error)) return [] as string[];
      throw error;
    });
    const snapshots: RewindSnapshotManifest[] = [];
    for (const file of files) {
      if (!file.endsWith(".json")) continue;
      snapshots.push(await this.loadSnapshot(file.slice(0, -".json".length)));
    }
    snapshots.sort((a, b) => b.createdAt - a.createdAt || b.id.localeCompare(a.id));
    return snapshots;
  }

  async previewRestore(snapshotId: string): Promise<RewindPreviewResult> {
    const target = await this.loadSnapshot(snapshotId);
    const current = createCaptureState(`preview-${snapshotId}`, this.root, this.now());
    await this.walkDirectory(this.root, current, { storeObjects: false, respectPolicy: true });
    const targetEntries = new Map(target.entries.map((entry) => [entry.relativePath, entry]));
    const currentEntries = new Map(current.entries.map((entry) => [entry.relativePath, entry]));
    const currentSkipped = new Map(current.skipped.map((entry) => [entry.relativePath, entry]));
    const changes: RewindPreviewChange[] = [];

    for (const skipped of target.skipped) {
      changes.push({ action: "skip", relativePath: skipped.relativePath, reason: skipped.reason, size: skipped.size });
    }

    for (const targetEntry of target.entries) {
      const skipped = currentSkipped.get(targetEntry.relativePath);
      if (skipped) {
        changes.push({ action: "conflict", relativePath: targetEntry.relativePath, reason: `Current path cannot be safely captured: ${skipped.reason}` });
        continue;
      }
      const currentEntry = currentEntries.get(targetEntry.relativePath);
      const missingEntryConflict = await this.currentPathConflictForMissingEntry(targetEntry, currentEntry);
      if (missingEntryConflict) {
        changes.push(missingEntryConflict);
        continue;
      }
      changes.push(compareEntries(targetEntry, currentEntry));
    }

    for (const currentEntry of current.entries) {
      if (!targetEntries.has(currentEntry.relativePath)) {
        changes.push({ action: "delete", relativePath: currentEntry.relativePath, currentHash: currentEntry.hash, size: currentEntry.size });
      }
    }

    for (const skipped of current.skipped) {
      if (!targetEntries.has(skipped.relativePath)) {
        changes.push({ action: "skip", relativePath: skipped.relativePath, reason: skipped.reason, size: skipped.size });
      }
    }

    changes.sort((a, b) => a.relativePath.localeCompare(b.relativePath) || a.action.localeCompare(b.action));
    return { snapshotId, changes, summary: summarizePreview(changes) };
  }

  async storageHealth(projectId: string): Promise<import("@pi-gui/shared").RewindStorageHealth> {
    const snapshots = await this.listSnapshots();
    const manifestBytes = await sumFiles(this.manifestsRoot, (name) => name.endsWith(".json"));
    const objects = await listObjectFiles(join(this.storeRoot, "objects", "sha256"));
    const referenced = new Set<string>();
    for (const snapshot of snapshots) {
      for (const entry of snapshot.entries) {
        if (entry.kind === "file" && entry.hash) referenced.add(entry.hash);
      }
    }
    let objectBytes = 0;
    let unreferencedObjectBytes = 0;
    for (const object of objects) {
      objectBytes += object.size;
      if (!referenced.has(object.hash)) unreferencedObjectBytes += object.size;
    }
    return {
      projectId,
      snapshotCount: snapshots.length,
      objectCount: objects.length,
      manifestBytes,
      objectBytes,
      referencedObjectCount: referenced.size,
      unreferencedObjectCount: objects.filter((object) => !referenced.has(object.hash)).length,
      unreferencedObjectBytes,
    };
  }

  async garbageCollect(projectId: string, options: { dryRun?: boolean; keepRecent?: number } = {}): Promise<import("@pi-gui/shared").RewindGarbageCollectResult> {
    const dryRun = options.dryRun !== false;
    const keepRecent = options.keepRecent;
    let deletedSnapshotCount = 0;
    if (keepRecent !== undefined) {
      const snapshots = await this.listSnapshots();
      for (const snapshot of snapshots.slice(keepRecent)) {
        if (!dryRun) await rm(this.manifestPath(snapshot.id), { force: true });
        deletedSnapshotCount += 1;
      }
    }
    const healthBefore = await this.storageHealth(projectId);
    const snapshots = await this.listSnapshots();
    const referenced = new Set<string>();
    for (const snapshot of snapshots) {
      for (const entry of snapshot.entries) {
        if (entry.kind === "file" && entry.hash) referenced.add(entry.hash);
      }
    }
    let deletedObjectCount = 0;
    let deletedObjectBytes = 0;
    for (const object of await listObjectFiles(join(this.storeRoot, "objects", "sha256"))) {
      if (referenced.has(object.hash)) continue;
      deletedObjectCount += 1;
      deletedObjectBytes += object.size;
      if (!dryRun) await rm(object.path, { force: true });
    }
    const healthAfter = dryRun ? healthBefore : await this.storageHealth(projectId);
    return { ...healthAfter, dryRun, deletedObjectCount, deletedObjectBytes, deletedSnapshotCount };
  }

  async restoreSnapshot(snapshotId: string): Promise<RewindRestoreResult> {
    if (RESTORE_LOCKS.has(this.root)) {
      return { ok: false, snapshotId, applied: [], error: "A rewind restore is already running for this workspace" };
    }
    RESTORE_LOCKS.add(this.root);
    let rollback: RewindSnapshotManifest | undefined;
    const applied: RewindPreviewChange[] = [];
    try {
      const target = await this.loadSnapshot(snapshotId);
      const preview = await this.previewRestore(snapshotId);
      const conflicts = preview.changes.filter((change) => change.action === "conflict");
      if (conflicts.length > 0) {
        return { ok: false, snapshotId, applied: [], error: `Restore has ${conflicts.length} conflict(s)` };
      }
      const changes = preview.changes.filter(isAppliedRestoreAction);
      rollback = await this.capturePaths(`rollback-${snapshotId}-${this.idFactory()}`, changes.map((change) => change.relativePath));
      const targetEntries = new Map(target.entries.map((entry) => [entry.relativePath, entry]));
      for (const change of changes) {
        const targetEntry = targetEntries.get(change.relativePath);
        if (change.action === "delete" || targetEntry?.kind === "deleted") {
          await removeWorkspacePath(this.root, change.relativePath);
        } else if (targetEntry) {
          await this.applyEntry(targetEntry);
        }
        applied.push(change);
      }
      return { ok: true, snapshotId, rollbackSnapshotId: rollback.id, applied };
    } catch (error) {
      if (rollback) {
        try {
          await this.applyEntries(rollback.entries);
        } catch (rollbackError) {
          const message = `${formatError(error)}; rollback failed: ${formatError(rollbackError)}`;
          return { ok: false, snapshotId, rollbackSnapshotId: rollback.id, applied, error: message };
        }
      }
      return { ok: false, snapshotId, rollbackSnapshotId: rollback?.id, applied, error: formatError(error) };
    } finally {
      RESTORE_LOCKS.delete(this.root);
    }
  }

  getObjectPath(hash: string): string {
    return this.objects.objectPath(hash);
  }

  private async capturePaths(id: string, relativePaths: string[]): Promise<RewindSnapshotManifest> {
    const state = createCaptureState(id, this.root, this.now());
    const uniquePaths = Array.from(new Set(relativePaths)).sort();
    for (const relativePath of uniquePaths) {
      const normalized = normalizeRelativePath(relativePath);
      if (normalized === undefined) {
        state.skipped.push({ relativePath, reason: "invalid_path" });
        continue;
      }
      await this.captureSinglePath(normalized, state, { storeObjects: true, respectPolicy: false, deletedIfMissing: true, ignoreCaps: true });
    }
    return this.writeManifest(finalizeManifest(state));
  }

  private async currentPathConflictForMissingEntry(targetEntry: RewindSnapshotEntry, currentEntry: RewindSnapshotEntry | undefined): Promise<RewindPreviewChange | undefined> {
    if (currentEntry || targetEntry.kind === "deleted") return undefined;
    let absolutePath: string;
    try {
      absolutePath = resolveRelativePath(this.root, targetEntry.relativePath);
    } catch (error) {
      return { action: "conflict", relativePath: targetEntry.relativePath, reason: formatError(error) };
    }
    try {
      const currentStat = await lstat(absolutePath);
      if (currentStat.isDirectory()) {
        return { action: "conflict", relativePath: targetEntry.relativePath, reason: "Current path is a directory" };
      }
      if (currentStat.isFile() || currentStat.isSymbolicLink()) {
        return { action: "conflict", relativePath: targetEntry.relativePath, reason: "Current path exists but was not captured by preview policy" };
      }
      return { action: "conflict", relativePath: targetEntry.relativePath, reason: "Current path has an unsupported file type" };
    } catch (error) {
      if (isNotFoundError(error)) return undefined;
      return { action: "conflict", relativePath: targetEntry.relativePath, reason: formatError(error) };
    }
  }

  private async walkDirectory(directory: string, state: CaptureState, options: CaptureOptions): Promise<void> {
    const entries = await readdir(directory, { withFileTypes: true });
    entries.sort((a, b) => a.name.localeCompare(b.name));
    for (const dirent of entries) {
      const absolutePath = join(directory, dirent.name);
      const relativePath = toRelativePath(this.root, absolutePath);
      if (relativePath === undefined || relativePath === "") continue;
      const policyReason = options.respectPolicy ? classifyPolicyPath(relativePath, this.policy) : undefined;
      if (policyReason) {
        state.skipped.push({ relativePath, reason: policyReason });
        continue;
      }
      if (dirent.isDirectory()) {
        await this.walkDirectory(absolutePath, state, options);
      } else {
        await this.captureSinglePath(relativePath, state, options);
      }
    }
  }

  private async captureSinglePath(relativePath: string, state: CaptureState, options: CaptureOptions): Promise<void> {
    const absolutePath = resolveRelativePath(this.root, relativePath);
    try {
      const fileStat = await lstat(absolutePath);
      if (fileStat.isSymbolicLink()) {
        const symlinkTarget = await readlink(absolutePath);
        const resolvedTarget = resolve(dirname(absolutePath), symlinkTarget);
        if (symlinkTarget.includes("\0") || symlinkTarget.startsWith("/") || toRelativePath(this.root, resolvedTarget) === undefined) {
          state.skipped.push({ relativePath, reason: "symlink_escape" });
          return;
        }
        state.entries.push({ kind: "symlink", relativePath, mode: fileStat.mode, size: symlinkTarget.length, mtimeMs: fileStat.mtimeMs, symlinkTarget });
        return;
      }
      if (!fileStat.isFile()) {
        state.skipped.push({ relativePath, reason: "unsupported_type" });
        return;
      }
      if (!options.ignoreCaps && fileStat.size > this.policy.maxFileBytes) {
        state.skipped.push({ relativePath, reason: "too_large", size: fileStat.size });
        return;
      }
      const bytes = await readFile(absolutePath);
      const hash = sha256(bytes);
      if (options.storeObjects) {
        const exists = await this.objects.hasObject(hash);
        if (!options.ignoreCaps && !exists && state.summary.newBytes + bytes.byteLength > this.policy.maxNewBytes) {
          state.skipped.push({ relativePath, reason: "new_bytes_budget_exceeded", size: fileStat.size });
          return;
        }
        const stored = await this.objects.storeBytes(bytes);
        if (!stored.existed) state.summary.newBytes += stored.size;
      }
      state.entries.push({ kind: "file", relativePath, mode: fileStat.mode, size: fileStat.size, mtimeMs: fileStat.mtimeMs, hash });
    } catch (error) {
      if (options.deletedIfMissing && isNotFoundError(error)) {
        state.entries.push({ kind: "deleted", relativePath });
        return;
      }
      state.skipped.push({ relativePath, reason: "read_error", message: formatError(error) });
    }
  }

  private async applyEntries(entries: RewindSnapshotEntry[]): Promise<void> {
    for (const entry of entries) {
      if (entry.kind === "deleted") await removeWorkspacePath(this.root, entry.relativePath);
      else await this.applyEntry(entry);
    }
  }

  private async applyEntry(entry: RewindSnapshotEntry): Promise<void> {
    const absolutePath = resolveRelativePath(this.root, entry.relativePath);
    await mkdir(dirname(absolutePath), { recursive: true });
    if (entry.kind === "symlink") {
      const target = entry.symlinkTarget ?? "";
      if (target.includes("\0") || target.startsWith("/") || toRelativePath(this.root, resolve(dirname(absolutePath), target)) === undefined) {
        throw new Error(`Refusing to restore unsafe symlink: ${entry.relativePath}`);
      }
      await rm(absolutePath, { recursive: true, force: true });
      await symlink(target, absolutePath);
      return;
    }
    if (entry.kind !== "file" || !entry.hash) throw new Error(`Cannot restore unsupported rewind entry: ${entry.relativePath}`);
    const bytes = await this.objects.readObject(entry.hash);
    const tmpPath = `${absolutePath}.pi-rewind-${process.pid}-${randomUUID()}.tmp`;
    await writeFile(tmpPath, bytes, { flag: "wx" });
    if (sha256(bytes) !== entry.hash) {
      await rm(tmpPath, { force: true }).catch(() => undefined);
      throw new Error(`Refusing to restore ${entry.relativePath}: object hash mismatch`);
    }
    await rm(absolutePath, { recursive: true, force: true });
    await rename(tmpPath, absolutePath);
    if (entry.mode !== undefined) await chmod(absolutePath, entry.mode & 0o777).catch(() => undefined);
    const restored = await readFile(absolutePath);
    const restoredHash = sha256(restored);
    if (restoredHash !== entry.hash) throw new Error(`Restore verification failed for ${entry.relativePath}`);
  }

  private async writeManifest(manifest: RewindSnapshotManifest): Promise<RewindSnapshotManifest> {
    await mkdir(this.manifestsRoot, { recursive: true });
    await writeFile(this.manifestPath(manifest.id), `${JSON.stringify(manifest, null, 2)}\n`, { flag: "wx" });
    return manifest;
  }

  private manifestPath(id: string): string {
    if (!/^[a-zA-Z0-9._:-]+$/.test(id)) throw new Error(`Invalid rewind snapshot id: ${id}`);
    return join(this.manifestsRoot, `${id}.json`);
  }
}

interface CaptureState {
  id: string;
  root: string;
  createdAt: number;
  entries: RewindSnapshotEntry[];
  skipped: RewindSkippedEntry[];
  summary: RewindSnapshotSummary;
}

interface CaptureOptions {
  storeObjects: boolean;
  respectPolicy: boolean;
  deletedIfMissing?: boolean;
  ignoreCaps?: boolean;
}

function createCaptureState(id: string, root: string, createdAt: number): CaptureState {
  return {
    id,
    root,
    createdAt,
    entries: [],
    skipped: [],
    summary: { capturedFiles: 0, capturedSymlinks: 0, deletedEntries: 0, skipped: 0, capturedBytes: 0, newBytes: 0 },
  };
}

function finalizeManifest(state: CaptureState): RewindSnapshotManifest {
  state.entries.sort((a, b) => a.relativePath.localeCompare(b.relativePath));
  state.skipped.sort((a, b) => a.relativePath.localeCompare(b.relativePath) || a.reason.localeCompare(b.reason));
  const summary: RewindSnapshotSummary = { ...state.summary, skipped: state.skipped.length };
  for (const entry of state.entries) {
    if (entry.kind === "file") {
      summary.capturedFiles += 1;
      summary.capturedBytes += entry.size ?? 0;
    } else if (entry.kind === "symlink") {
      summary.capturedSymlinks += 1;
    } else if (entry.kind === "deleted") {
      summary.deletedEntries += 1;
    }
  }
  return { storeVersion: REWIND_STORE_VERSION, id: state.id, createdAt: state.createdAt, root: state.root, entries: state.entries, skipped: state.skipped, summary };
}

function compareEntries(target: RewindSnapshotEntry, current: RewindSnapshotEntry | undefined): RewindPreviewChange {
  if (target.kind === "deleted") {
    return current
      ? { action: "delete", relativePath: target.relativePath, currentHash: current.hash, size: current.size }
      : { action: "unchanged", relativePath: target.relativePath };
  }
  if (!current) {
    return { action: target.kind === "symlink" ? "recreate" : "add", relativePath: target.relativePath, targetHash: target.hash, size: target.size };
  }
  if (target.kind !== current.kind) {
    return { action: "overwrite", relativePath: target.relativePath, currentHash: current.hash, targetHash: target.hash, size: target.size, reason: `${current.kind} -> ${target.kind}` };
  }
  if (target.kind === "symlink") {
    return target.symlinkTarget === current.symlinkTarget
      ? { action: "unchanged", relativePath: target.relativePath }
      : { action: "modify", relativePath: target.relativePath, size: target.size };
  }
  if (target.hash === current.hash) return { action: "unchanged", relativePath: target.relativePath, currentHash: current.hash, targetHash: target.hash, size: target.size };
  return { action: "modify", relativePath: target.relativePath, currentHash: current.hash, targetHash: target.hash, size: target.size };
}

function summarizePreview(changes: RewindPreviewChange[]): Record<RewindPreviewAction, number> {
  const summary = Object.fromEntries(PREVIEW_ACTIONS.map((action) => [action, 0])) as Record<RewindPreviewAction, number>;
  for (const change of changes) summary[change.action] += 1;
  return summary;
}

function isAppliedRestoreAction(change: RewindPreviewChange): boolean {
  return change.action === "add" || change.action === "modify" || change.action === "delete" || change.action === "recreate" || change.action === "overwrite";
}

async function removeWorkspacePath(root: string, relativePath: string): Promise<void> {
  const absolutePath = resolveRelativePath(root, relativePath);
  await rm(absolutePath, { recursive: true, force: true });
}

function validateManifest(value: unknown, id: string, expectedRoot: string): RewindSnapshotManifest {
  if (!value || typeof value !== "object") throw new Error(`Invalid rewind manifest: ${id}`);
  const manifest = value as RewindSnapshotManifest;
  if (
    manifest.storeVersion !== REWIND_STORE_VERSION ||
    manifest.id !== id ||
    typeof manifest.root !== "string" ||
    normalizeRoot(manifest.root) !== expectedRoot ||
    !Array.isArray(manifest.entries) ||
    !Array.isArray(manifest.skipped)
  ) {
    throw new Error(`Invalid rewind manifest: ${id}`);
  }
  for (const entry of manifest.entries) validateManifestEntry(expectedRoot, entry, id);
  for (const skipped of manifest.skipped) {
    if (!skipped || typeof skipped !== "object" || normalizeRelativePath(skipped.relativePath) === undefined) {
      throw new Error(`Invalid rewind manifest skipped entry: ${id}`);
    }
  }
  return manifest;
}

function validateManifestEntry(root: string, entry: RewindSnapshotEntry, id: string): void {
  if (!entry || typeof entry !== "object" || normalizeRelativePath(entry.relativePath) === undefined) {
    throw new Error(`Invalid rewind manifest entry: ${id}`);
  }
  if (entry.kind !== "file" && entry.kind !== "symlink" && entry.kind !== "deleted") {
    throw new Error(`Invalid rewind manifest entry kind: ${id}`);
  }
  if (entry.kind === "file" && (typeof entry.hash !== "string" || !/^[a-f0-9]{64}$/.test(entry.hash))) {
    throw new Error(`Invalid rewind manifest file hash: ${id}`);
  }
  if (entry.kind === "symlink") {
    const target = entry.symlinkTarget;
    if (typeof target !== "string" || target.includes("\0") || target.startsWith("/")) {
      throw new Error(`Invalid rewind manifest symlink target: ${id}`);
    }
    const absolutePath = resolveRelativePath(root, entry.relativePath);
    if (toRelativePath(root, resolve(dirname(absolutePath), target)) === undefined) {
      throw new Error(`Invalid rewind manifest symlink target: ${id}`);
    }
  }
}

async function sumFiles(root: string, include: (name: string) => boolean): Promise<number> {
  const files = await readdir(root).catch((error: unknown) => {
    if (isNotFoundError(error)) return [] as string[];
    throw error;
  });
  let total = 0;
  for (const file of files) {
    if (!include(file)) continue;
    total += await stat(join(root, file)).then((item) => item.size, () => 0);
  }
  return total;
}

async function listObjectFiles(root: string): Promise<Array<{ hash: string; path: string; size: number }>> {
  const output: Array<{ hash: string; path: string; size: number }> = [];
  await walkObjectFiles(root, output).catch((error: unknown) => {
    if (!isNotFoundError(error)) throw error;
  });
  return output;
}

async function walkObjectFiles(directory: string, output: Array<{ hash: string; path: string; size: number }>): Promise<void> {
  const entries = await readdir(directory, { withFileTypes: true });
  for (const entry of entries) {
    const fullPath = join(directory, entry.name);
    if (entry.isDirectory()) {
      await walkObjectFiles(fullPath, output);
      continue;
    }
    if (!entry.isFile() || !/^[a-f0-9]{64}$/.test(entry.name)) continue;
    output.push({ hash: entry.name, path: fullPath, size: await stat(fullPath).then((item) => item.size, () => 0) });
  }
}

function isNotFoundError(error: unknown): boolean {
  return Boolean(error && typeof error === "object" && "code" in error && error.code === "ENOENT");
}

function formatError(error: unknown): string {
  return error instanceof Error ? error.message : String(error);
}
