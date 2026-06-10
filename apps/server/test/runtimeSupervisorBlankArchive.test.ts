import assert from "node:assert/strict";
import { mkdtempSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import test from "node:test";
import { AppDatabase } from "../src/db.js";
import { RuntimeSupervisor } from "../src/runtime/runtimeSupervisor.js";

function createHarness() {
  const dir = mkdtempSync(join(tmpdir(), "pi-gui-runtime-supervisor-"));
  const db = new AppDatabase(join(dir, "pi-gui.sqlite"));
  db.createProject({ id: "project-1", name: "Project", cwd: dir, lastOpenedAt: 1 });
  const supervisor = new RuntimeSupervisor(db, () => undefined);
  return { db, supervisor, dir };
}

test("archiveBlankRuntime archives session-backed blank runtimes", () => {
  const { db, supervisor, dir } = createHarness();
  db.upsertRuntime({ id: "runtime-1", projectId: "project-1", cwd: dir, status: "running", sessionId: "session-1", startedAt: 1 });

  const archived = supervisor.archiveBlankRuntime("runtime-1");

  assert.equal(archived.id, "runtime-1");
  assert.equal(typeof archived.archivedAt, "number");
  assert.equal(typeof db.getRuntime("runtime-1")?.archivedAt, "number");
  db.close();
});

test("archiveBlankRuntime keeps session-backed runtimes with conversation activity", () => {
  const { db, supervisor, dir } = createHarness();
  db.upsertRuntime({ id: "runtime-1", projectId: "project-1", cwd: dir, status: "running", sessionId: "session-1", startedAt: 1 });
  db.upsertConversationMessage({ id: "message-1", runtimeId: "runtime-1", projectId: "project-1", role: "user", text: "hello", timestamp: 2 });

  const result = supervisor.archiveBlankRuntime("runtime-1");

  assert.equal(result.archivedAt, undefined);
  assert.equal(db.getRuntime("runtime-1")?.archivedAt, undefined);
  db.close();
});
