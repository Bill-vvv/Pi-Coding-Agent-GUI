import assert from "node:assert/strict";
import { mkdtempSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import test from "node:test";
import { AppDatabase } from "../src/db.js";

function createTestDatabase(): AppDatabase {
  const dir = mkdtempSync(join(tmpdir(), "pi-gui-session-"));
  return new AppDatabase(join(dir, "pi-gui.sqlite"));
}

test("AppDatabase upserts and lists Pi sessions by project", () => {
  const db = createTestDatabase();
  db.createProject({ id: "project-1", name: "Project 1", cwd: process.cwd(), lastOpenedAt: 1 });
  db.createProject({ id: "project-2", name: "Project 2", cwd: tmpdir(), lastOpenedAt: 2 });

  const first = db.upsertSession({
    id: "session-1",
    projectId: "project-1",
    piSessionFile: "/home/user/.pi/sessions/session-1.jsonl",
    createdAt: 100,
    updatedAt: 101,
    runtimeId: "runtime-1",
  });
  db.upsertSession({
    id: "session-2",
    projectId: "project-2",
    piSessionFile: "/home/user/.pi/sessions/session-2.jsonl",
    createdAt: 102,
    updatedAt: 103,
  });

  assert.deepEqual(first, {
    id: "session-1",
    projectId: "project-1",
    piSessionFile: "/home/user/.pi/sessions/session-1.jsonl",
    title: undefined,
    createdAt: 100,
    updatedAt: 101,
    runtimeId: "runtime-1",
  });
  assert.deepEqual(db.listSessions("project-1").map((session) => session.id), ["session-1"]);
  assert.deepEqual(db.listSessions().map((session) => session.id), ["session-2", "session-1"]);
  db.close();
});

test("AppDatabase session upsert preserves existing title when next update omits it", () => {
  const db = createTestDatabase();
  db.createProject({ id: "project-1", name: "Project", cwd: process.cwd(), lastOpenedAt: 1 });

  db.upsertSession({
    id: "session-1",
    projectId: "project-1",
    piSessionFile: "/tmp/session-1.jsonl",
    title: "已有标题",
    createdAt: 100,
    updatedAt: 101,
  });
  const updated = db.upsertSession({
    id: "session-1",
    projectId: "project-1",
    piSessionFile: "/tmp/session-1.jsonl",
    createdAt: 100,
    updatedAt: 200,
    runtimeId: "runtime-2",
  });

  assert.equal(updated.title, "已有标题");
  assert.equal(updated.updatedAt, 200);
  assert.equal(updated.runtimeId, "runtime-2");
  db.close();
});
