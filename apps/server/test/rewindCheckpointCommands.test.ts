import assert from "node:assert/strict";
import { mkdtempSync } from "node:fs";
import { mkdir, readFile, rm, stat, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import test from "node:test";
import type { RewindCheckpointPreview, RewindCheckpointRestoreResult, RewindCheckpointSummary, ServerEvent } from "@pi-gui/shared";
import { AppDatabase } from "../src/db.js";
import { parseClientCommand } from "../src/protocol/parseClientCommand.js";
import type { RuntimeSupervisor } from "../src/runtime/runtimeSupervisor.js";
import { createSocketMessageHandler } from "../src/ws/commandHandler.js";
import type { WsClient } from "../src/ws/wsHub.js";

function createHarness(supervisor: Partial<RuntimeSupervisor> = {}) {
  const dir = mkdtempSync(join(tmpdir(), "pi-gui-checkpoint-command-"));
  const db = new AppDatabase(join(dir, "pi-gui.sqlite"));
  const sent: ServerEvent[] = [];
  const socket: WsClient = { send: () => undefined, on: () => undefined };
  const handle = createSocketMessageHandler({
    db,
    supervisor: supervisor as RuntimeSupervisor,
    send: (_socket, event) => sent.push(event),
    broadcast: (event) => sent.push(event),
  });
  return { dir, db, sent, socket, handle };
}

async function sendCommand(handle: (socket: WsClient, data: Buffer | string) => Promise<void>, socket: WsClient, command: Record<string, unknown>) {
  await handle(socket, JSON.stringify(command));
}

function latestCommandResult(events: ServerEvent[]) {
  const result = events.filter((event) => event.type === "command.result").at(-1);
  assert.ok(result, "expected a command.result event");
  return result;
}

test("checkpoint command parser validates required fields", () => {
  assert.deepEqual(parseClientCommand({ type: "checkpoint.list", requestId: "req-list", projectId: "project-1" }), {
    type: "checkpoint.list",
    requestId: "req-list",
    projectId: "project-1",
  });
  assert.throws(() => parseClientCommand({ type: "checkpoint.list" }), /checkpoint\.list requires projectId/);
  assert.throws(() => parseClientCommand({ type: "checkpoint.preview", projectId: "project-1" }), /checkpoint\.preview requires snapshotId/);
  assert.throws(() => parseClientCommand({ type: "checkpoint.restore", projectId: "project-1", snapshotId: "" }), /checkpoint\.restore requires snapshotId/);
  assert.deepEqual(parseClientCommand({ type: "checkpoint.restore", projectId: "project-1", snapshotId: "snap", runtimeId: "runtime-1" }), {
    type: "checkpoint.restore",
    projectId: "project-1",
    snapshotId: "snap",
    runtimeId: "runtime-1",
    entryId: undefined,
    requestId: undefined,
  });
  assert.throws(() => parseClientCommand({ type: "checkpoint.restore", projectId: "project-1", snapshotId: "snap", entryId: "entry-1" }), /requires runtimeId/);
  assert.deepEqual(parseClientCommand({ type: "checkpoint.restore", projectId: "project-1", snapshotId: "snap", runtimeId: "runtime-1", entryId: "entry-1" }), {
    type: "checkpoint.restore",
    projectId: "project-1",
    snapshotId: "snap",
    runtimeId: "runtime-1",
    entryId: "entry-1",
    requestId: undefined,
  });
});

test("checkpoint commands capture, list, preview, and restore a project workspace", async (t) => {
  const projectDir = mkdtempSync(join(tmpdir(), "pi-gui-checkpoint-project-"));
  const { dir, db, sent, socket, handle } = createHarness();
  t.after(() => db.close());
  t.after(() => rm(dir, { recursive: true, force: true }));
  t.after(() => rm(projectDir, { recursive: true, force: true }));

  await mkdir(join(projectDir, "src"), { recursive: true });
  await writeFile(join(projectDir, "src", "a.txt"), "old-a", "utf8");
  await writeFile(join(projectDir, "delete-later.txt"), "delete me", "utf8");
  db.createProject({ id: "project-1", name: "Project", cwd: projectDir, lastOpenedAt: 1 });

  await sendCommand(handle, socket, { type: "checkpoint.capture", requestId: "capture-1", projectId: "project-1" });
  const captureResult = latestCommandResult(sent);
  assert.equal(captureResult.success, true);
  const checkpoint = (captureResult.data as { checkpoint: RewindCheckpointSummary }).checkpoint;
  assert.equal(checkpoint.projectId, "project-1");
  assert.equal(checkpoint.capturedFiles, 2);
  assert.ok(sent.some((event) => event.type === "checkpoint.captured" && event.checkpoint.id === checkpoint.id));
  assert.ok(sent.some((event) => event.type === "checkpoint.operation" && event.operation.kind === "capture" && event.operation.snapshotId === checkpoint.id));
  assert.deepEqual(db.getRewindCheckpointConversationLink("project-1", checkpoint.id), {
    projectId: "project-1",
    snapshotId: checkpoint.id,
    runtimeId: undefined,
    sessionId: undefined,
    targetEntryId: undefined,
    captureSource: "manual",
    createdAt: checkpoint.createdAt,
  });

  await writeFile(join(projectDir, "src", "a.txt"), "new-a", "utf8");
  await rm(join(projectDir, "delete-later.txt"));
  await writeFile(join(projectDir, "extra.txt"), "extra", "utf8");

  await sendCommand(handle, socket, { type: "checkpoint.list", requestId: "list-1", projectId: "project-1" });
  const listResult = latestCommandResult(sent);
  assert.equal(listResult.success, true);
  assert.deepEqual((listResult.data as { checkpoints: RewindCheckpointSummary[] }).checkpoints.map((item) => item.id), [checkpoint.id]);
  assert.deepEqual(db.listRewindCheckpoints("project-1").map((item) => item.id), [checkpoint.id]);

  await sendCommand(handle, socket, { type: "checkpoint.preview", requestId: "preview-1", projectId: "project-1", snapshotId: checkpoint.id });
  const previewResult = latestCommandResult(sent);
  assert.equal(previewResult.success, true);
  const preview = (previewResult.data as { preview: RewindCheckpointPreview }).preview;
  const byPath = new Map(preview.changes.map((change) => [change.relativePath, change.action]));
  assert.equal(byPath.get("src/a.txt"), "modify");
  assert.equal(byPath.get("delete-later.txt"), "add");
  assert.equal(byPath.get("extra.txt"), "delete");
  assert.ok(sent.some((event) => event.type === "checkpoint.preview" && event.preview.snapshotId === checkpoint.id));

  await sendCommand(handle, socket, { type: "checkpoint.restore", requestId: "restore-1", projectId: "project-1", snapshotId: checkpoint.id });
  const restoreResult = latestCommandResult(sent);
  assert.equal(restoreResult.success, true, restoreResult.error);
  const result = (restoreResult.data as { result: RewindCheckpointRestoreResult }).result;
  assert.equal(result.ok, true);
  assert.equal(await readFile(join(projectDir, "src", "a.txt"), "utf8"), "old-a");
  assert.equal(await readFile(join(projectDir, "delete-later.txt"), "utf8"), "delete me");
  await assert.rejects(() => stat(join(projectDir, "extra.txt")), /ENOENT/);
  assert.ok(sent.some((event) => event.type === "checkpoint.restored" && event.result.ok));
  assert.ok(sent.some((event) => event.type === "checkpoint.operation" && event.operation.kind === "restore" && event.operation.snapshotId === checkpoint.id && event.operation.ok));
  assert.deepEqual(db.listRecentRewindCheckpointOperations().map((operation) => operation.kind), ["capture", "restore"]);
});

test("checkpoint metadata index replaces stale project rows", async (t) => {
  const { dir, db } = createHarness();
  t.after(() => db.close());
  t.after(() => rm(dir, { recursive: true, force: true }));

  db.createProject({ id: "project-1", name: "Project", cwd: "/tmp/project-1", lastOpenedAt: 1 });

  const oldCheckpoint: RewindCheckpointSummary = {
    id: "old",
    projectId: "project-1",
    root: "/tmp/project-1",
    createdAt: 1,
    capturedFiles: 1,
    capturedSymlinks: 0,
    deletedEntries: 0,
    skipped: 0,
    capturedBytes: 3,
    newBytes: 3,
  };
  const newCheckpoint: RewindCheckpointSummary = { ...oldCheckpoint, id: "new", createdAt: 2, capturedBytes: 5, newBytes: 2 };

  db.upsertRewindCheckpoint(oldCheckpoint);
  assert.deepEqual(db.listRewindCheckpoints("project-1").map((checkpoint) => checkpoint.id), ["old"]);

  db.replaceProjectRewindCheckpoints("project-1", [newCheckpoint]);
  assert.deepEqual(db.listRewindCheckpoints("project-1").map((checkpoint) => checkpoint.id), ["new"]);
  assert.equal(db.listRewindCheckpoints("project-1")[0]?.capturedBytes, 5);
});

test("checkpoint operation history preserves recent restore completion for reconnect bootstrap", async (t) => {
  const { dir, db } = createHarness();
  t.after(() => db.close());
  t.after(() => rm(dir, { recursive: true, force: true }));

  db.createProject({ id: "project-1", name: "Project", cwd: "/tmp/project-1", lastOpenedAt: 1 });
  db.appendRewindCheckpointOperation({ projectId: "project-1", kind: "capture", snapshotId: "snap-1", createdAt: 10, ok: true });
  db.appendRewindCheckpointOperation({ projectId: "project-1", kind: "restore", snapshotId: "snap-2", createdAt: 20, ok: false, rollbackSnapshotId: "rollback-2", error: "restore failed" });

  assert.deepEqual(db.listRecentRewindCheckpointOperations(), [
    { id: 1, projectId: "project-1", kind: "capture", snapshotId: "snap-1", createdAt: 10, ok: true, rollbackSnapshotId: undefined, error: undefined },
    { id: 2, projectId: "project-1", kind: "restore", snapshotId: "snap-2", createdAt: 20, ok: false, rollbackSnapshotId: "rollback-2", error: "restore failed" },
  ]);
});

test("checkpoint commands report project and local-cwd failures as command results", async (t) => {
  const { dir, db, sent, socket, handle } = createHarness();
  t.after(() => db.close());
  t.after(() => rm(dir, { recursive: true, force: true }));

  await sendCommand(handle, socket, { type: "checkpoint.list", requestId: "missing-project", projectId: "missing" });
  const missingResult = latestCommandResult(sent);
  assert.equal(missingResult.success, false);
  assert.equal(missingResult.requestId, "missing-project");
  assert.match(missingResult.error ?? "", /Project not found/);

  db.createProject({ id: "remote-project", name: "Remote", cwd: "devbox:/srv/app", lastOpenedAt: 1 });
  await sendCommand(handle, socket, { type: "checkpoint.capture", requestId: "remote-capture", projectId: "remote-project" });
  const remoteResult = latestCommandResult(sent);
  assert.equal(remoteResult.success, false);
  assert.match(remoteResult.error ?? "", /local project cwd/);
});

test("checkpoint restore forks conversation only after file restore succeeds", async (t) => {
  const projectDir = mkdtempSync(join(tmpdir(), "pi-gui-checkpoint-fork-success-"));
  const forkCalls: Array<{ runtimeId: string; entryId: string }> = [];
  const { dir, db, sent, socket, handle } = createHarness({
    getRuntime: (runtimeId: string) => ({ id: runtimeId, projectId: "project-1", sessionId: "session-1" }),
    forkRuntime: async (runtimeId: string, entryId: string) => {
      forkCalls.push({ runtimeId, entryId });
      return { runtimeId, targetEntryId: entryId, sourceSessionId: "session-before", resultSessionId: "session-after", resultEntryId: "entry-after" };
    },
  });
  t.after(() => db.close());
  t.after(() => rm(dir, { recursive: true, force: true }));
  t.after(() => rm(projectDir, { recursive: true, force: true }));

  await writeFile(join(projectDir, "a.txt"), "old", "utf8");
  db.createProject({ id: "project-1", name: "Project", cwd: projectDir, lastOpenedAt: 1 });
  await sendCommand(handle, socket, { type: "checkpoint.capture", requestId: "capture-1", projectId: "project-1" });
  const checkpoint = (latestCommandResult(sent).data as { checkpoint: RewindCheckpointSummary }).checkpoint;
  db.upsertRewindCheckpointConversationLink({ projectId: "project-1", snapshotId: checkpoint.id, runtimeId: "runtime-1", sessionId: "session-1", captureSource: "prompt", createdAt: checkpoint.createdAt });
  await writeFile(join(projectDir, "a.txt"), "new", "utf8");

  await sendCommand(handle, socket, { type: "checkpoint.restore", requestId: "restore-fork", projectId: "project-1", snapshotId: checkpoint.id, runtimeId: "runtime-1", entryId: "entry-1" });

  const restoreResult = latestCommandResult(sent);
  assert.equal(restoreResult.success, true, restoreResult.error);
  assert.deepEqual(forkCalls, [{ runtimeId: "runtime-1", entryId: "entry-1" }]);
  assert.equal(await readFile(join(projectDir, "a.txt"), "utf8"), "old");
  assert.deepEqual(db.listRecentRewindJumpHistory(10, "project-1"), [
    {
      id: 1,
      projectId: "project-1",
      snapshotId: checkpoint.id,
      runtimeId: "runtime-1",
      sourceSessionId: "session-before",
      targetEntryId: "entry-1",
      resultSessionId: "session-after",
      resultEntryId: "entry-after",
      createdAt: db.listRecentRewindJumpHistory(10, "project-1")[0]!.createdAt,
      ok: true,
      rollbackSnapshotId: (restoreResult.data as { result: RewindCheckpointRestoreResult }).result.rollbackSnapshotId,
      error: undefined,
    },
  ]);
});

test("checkpoint restore uses persisted prompt entry binding when entryId is omitted", async (t) => {
  const projectDir = mkdtempSync(join(tmpdir(), "pi-gui-checkpoint-bound-entry-"));
  const forkCalls: Array<{ runtimeId: string; entryId: string }> = [];
  const { dir, db, sent, socket, handle } = createHarness({
    getRuntime: (runtimeId: string) => ({ id: runtimeId, projectId: "project-1", sessionId: "session-1" }),
    forkRuntime: async (runtimeId: string, entryId: string) => {
      forkCalls.push({ runtimeId, entryId });
      return { runtimeId, targetEntryId: entryId, sourceSessionId: "session-1", resultSessionId: "session-fork" };
    },
  });
  t.after(() => db.close());
  t.after(() => rm(dir, { recursive: true, force: true }));
  t.after(() => rm(projectDir, { recursive: true, force: true }));

  await writeFile(join(projectDir, "a.txt"), "old", "utf8");
  db.createProject({ id: "project-1", name: "Project", cwd: projectDir, lastOpenedAt: 1 });
  await sendCommand(handle, socket, { type: "checkpoint.capture", requestId: "capture-1", projectId: "project-1" });
  const checkpoint = (latestCommandResult(sent).data as { checkpoint: RewindCheckpointSummary }).checkpoint;
  db.upsertRewindCheckpointConversationLink({ projectId: "project-1", snapshotId: checkpoint.id, runtimeId: "runtime-1", sessionId: "session-1", targetEntryId: "entry-bound", captureSource: "prompt", createdAt: checkpoint.createdAt });
  await writeFile(join(projectDir, "a.txt"), "new", "utf8");

  await sendCommand(handle, socket, { type: "checkpoint.restore", requestId: "restore-bound", projectId: "project-1", snapshotId: checkpoint.id, runtimeId: "runtime-1" });

  assert.equal(latestCommandResult(sent).success, true);
  assert.deepEqual(forkCalls, [{ runtimeId: "runtime-1", entryId: "entry-bound" }]);
});

test("checkpoint storage health and GC report unreferenced objects", async (t) => {
  const projectDir = mkdtempSync(join(tmpdir(), "pi-gui-checkpoint-gc-"));
  const { dir, db, sent, socket, handle } = createHarness();
  t.after(() => db.close());
  t.after(() => rm(dir, { recursive: true, force: true }));
  t.after(() => rm(projectDir, { recursive: true, force: true }));

  db.createProject({ id: "project-1", name: "Project", cwd: projectDir, lastOpenedAt: 1 });
  await writeFile(join(projectDir, "a.txt"), "one", "utf8");
  await sendCommand(handle, socket, { type: "checkpoint.capture", projectId: "project-1" });
  await writeFile(join(projectDir, "a.txt"), "two", "utf8");
  await sendCommand(handle, socket, { type: "checkpoint.capture", projectId: "project-1" });

  await sendCommand(handle, socket, { type: "checkpoint.gc", requestId: "gc-1", projectId: "project-1", dryRun: false, keepRecent: 1 });
  const gcResult = latestCommandResult(sent);
  assert.equal(gcResult.success, true);
  const result = gcResult.data as { result: { deletedSnapshotCount: number; deletedObjectCount: number } };
  assert.equal(result.result.deletedSnapshotCount, 1);
  assert.ok(result.result.deletedObjectCount >= 1);
  assert.ok(sent.some((event) => event.type === "checkpoint.gc" && event.result.deletedSnapshotCount === 1));
});

test("checkpoint restore rolls files back when conversation fork fails", async (t) => {
  const projectDir = mkdtempSync(join(tmpdir(), "pi-gui-checkpoint-fork-fail-"));
  const { dir, db, sent, socket, handle } = createHarness({
    getRuntime: (runtimeId: string) => ({ id: runtimeId, projectId: "project-1", sessionId: "session-1" }),
    forkRuntime: async () => {
      throw new Error("fork unavailable");
    },
  });
  t.after(() => db.close());
  t.after(() => rm(dir, { recursive: true, force: true }));
  t.after(() => rm(projectDir, { recursive: true, force: true }));

  await writeFile(join(projectDir, "a.txt"), "old", "utf8");
  db.createProject({ id: "project-1", name: "Project", cwd: projectDir, lastOpenedAt: 1 });
  await sendCommand(handle, socket, { type: "checkpoint.capture", requestId: "capture-1", projectId: "project-1" });
  const checkpoint = (latestCommandResult(sent).data as { checkpoint: RewindCheckpointSummary }).checkpoint;
  db.upsertRewindCheckpointConversationLink({ projectId: "project-1", snapshotId: checkpoint.id, runtimeId: "runtime-1", sessionId: "session-1", captureSource: "prompt", createdAt: checkpoint.createdAt });
  await writeFile(join(projectDir, "a.txt"), "dirty-current", "utf8");

  await sendCommand(handle, socket, { type: "checkpoint.restore", requestId: "restore-fork-fail", projectId: "project-1", snapshotId: checkpoint.id, runtimeId: "runtime-1", entryId: "entry-1" });

  const restoreResult = latestCommandResult(sent);
  assert.equal(restoreResult.success, false);
  assert.match(restoreResult.error ?? "", /workspace was rolled back.*fork unavailable/s);
  const failedResult = (restoreResult.data as { result: RewindCheckpointRestoreResult }).result;
  assert.equal(failedResult.snapshotId, checkpoint.id);
  assert.equal(await readFile(join(projectDir, "a.txt"), "utf8"), "dirty-current");
  assert.deepEqual(db.listRecentRewindJumpHistory(10, "project-1").map((entry) => ({ snapshotId: entry.snapshotId, runtimeId: entry.runtimeId, targetEntryId: entry.targetEntryId, ok: entry.ok, error: entry.error })), [
    { snapshotId: checkpoint.id, runtimeId: "runtime-1", targetEntryId: "entry-1", ok: false, error: "fork unavailable" },
  ]);
});

test("checkpoint restore rejects branch restore when the checkpoint has no persisted conversation link", async (t) => {
  const projectDir = mkdtempSync(join(tmpdir(), "pi-gui-checkpoint-no-link-"));
  const forkCalls: string[] = [];
  const { dir, db, sent, socket, handle } = createHarness({
    getRuntime: (runtimeId: string) => ({ id: runtimeId, projectId: "project-1", sessionId: "session-1" }),
    forkRuntime: async () => {
      forkCalls.push("called");
      return { runtimeId: "runtime-1", targetEntryId: "entry-1" };
    },
  });
  t.after(() => db.close());
  t.after(() => rm(dir, { recursive: true, force: true }));
  t.after(() => rm(projectDir, { recursive: true, force: true }));

  await writeFile(join(projectDir, "a.txt"), "old", "utf8");
  db.createProject({ id: "project-1", name: "Project", cwd: projectDir, lastOpenedAt: 1 });
  await sendCommand(handle, socket, { type: "checkpoint.capture", requestId: "capture-1", projectId: "project-1" });
  const checkpoint = (latestCommandResult(sent).data as { checkpoint: RewindCheckpointSummary }).checkpoint;
  await writeFile(join(projectDir, "a.txt"), "dirty", "utf8");

  await sendCommand(handle, socket, { type: "checkpoint.restore", requestId: "restore-no-link", projectId: "project-1", snapshotId: checkpoint.id, runtimeId: "runtime-1", entryId: "entry-1" });
  const restoreResult = latestCommandResult(sent);
  assert.equal(restoreResult.success, false);
  assert.match(restoreResult.error ?? "", /conversation ownership metadata|no persisted conversation link/);
  assert.equal(await readFile(join(projectDir, "a.txt"), "utf8"), "dirty");
  assert.deepEqual(forkCalls, []);
});

test("checkpoint restore rejects runtimes from a different project", async (t) => {
  const projectDir = mkdtempSync(join(tmpdir(), "pi-gui-checkpoint-wrong-project-"));
  const forkCalls: string[] = [];
  const { dir, db, sent, socket, handle } = createHarness({
    getRuntime: (runtimeId: string) => ({ id: runtimeId, projectId: "project-2", sessionId: "session-2" }),
    forkRuntime: async () => {
      forkCalls.push("called");
      return { runtimeId: "runtime-2", targetEntryId: "entry-1" };
    },
  });
  t.after(() => db.close());
  t.after(() => rm(dir, { recursive: true, force: true }));
  t.after(() => rm(projectDir, { recursive: true, force: true }));

  await writeFile(join(projectDir, "a.txt"), "old", "utf8");
  db.createProject({ id: "project-1", name: "Project", cwd: projectDir, lastOpenedAt: 1 });
  await sendCommand(handle, socket, { type: "checkpoint.capture", requestId: "capture-1", projectId: "project-1" });
  const checkpoint = (latestCommandResult(sent).data as { checkpoint: RewindCheckpointSummary }).checkpoint;
  db.upsertRewindCheckpointConversationLink({ projectId: "project-1", snapshotId: checkpoint.id, runtimeId: "runtime-1", sessionId: "session-1", captureSource: "prompt", createdAt: checkpoint.createdAt });
  await writeFile(join(projectDir, "a.txt"), "dirty", "utf8");

  await sendCommand(handle, socket, { type: "checkpoint.restore", requestId: "restore-wrong-project", projectId: "project-1", snapshotId: checkpoint.id, runtimeId: "runtime-2", entryId: "entry-1" });
  const restoreResult = latestCommandResult(sent);
  assert.equal(restoreResult.success, false);
  assert.match(restoreResult.error ?? "", /different project/);
  assert.equal(await readFile(join(projectDir, "a.txt"), "utf8"), "dirty");
  assert.deepEqual(forkCalls, []);
});

test("checkpoint restore returns a failed command result when storage restore fails safely", async (t) => {
  const projectDir = mkdtempSync(join(tmpdir(), "pi-gui-checkpoint-restore-fail-"));
  const forkCalls: string[] = [];
  const { dir, db, sent, socket, handle } = createHarness({
    getRuntime: (runtimeId: string) => ({ id: runtimeId, projectId: "project-1", sessionId: "session-1" }),
    forkRuntime: async () => {
      forkCalls.push("called");
      return { runtimeId: "runtime-1", targetEntryId: "entry-1", sourceSessionId: "session-1", resultSessionId: "session-1" };
    },
  });
  t.after(() => db.close());
  t.after(() => rm(dir, { recursive: true, force: true }));
  t.after(() => rm(projectDir, { recursive: true, force: true }));

  await writeFile(join(projectDir, "a.txt"), "old", "utf8");
  db.createProject({ id: "project-1", name: "Project", cwd: projectDir, lastOpenedAt: 1 });
  await sendCommand(handle, socket, { type: "checkpoint.capture", requestId: "capture-1", projectId: "project-1" });
  const checkpoint = (latestCommandResult(sent).data as { checkpoint: RewindCheckpointSummary }).checkpoint;
  db.upsertRewindCheckpointConversationLink({ projectId: "project-1", snapshotId: checkpoint.id, runtimeId: "runtime-1", sessionId: "session-1", captureSource: "prompt", createdAt: checkpoint.createdAt });

  await rm(join(projectDir, "a.txt"));
  await mkdir(join(projectDir, "a.txt"));
  await sendCommand(handle, socket, { type: "checkpoint.restore", requestId: "restore-conflict", projectId: "project-1", snapshotId: checkpoint.id, runtimeId: "runtime-1", entryId: "entry-1" });
  const restoreResult = latestCommandResult(sent);
  assert.equal(restoreResult.success, false);
  assert.equal(restoreResult.requestId, "restore-conflict");
  assert.match(restoreResult.error ?? "", /conflict/);
  assert.deepEqual(forkCalls, []);
});
