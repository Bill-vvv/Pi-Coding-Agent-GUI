import assert from "node:assert/strict";
import { mkdtempSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import test from "node:test";
import { AppDatabase } from "../src/db.js";

function createTestDatabase(): AppDatabase {
  const dir = mkdtempSync(join(tmpdir(), "pi-gui-db-"));
  return new AppDatabase(join(dir, "pi-gui.sqlite"));
}

test("AppDatabase appends and replays GUI events after an event id", () => {
  const db = createTestDatabase();

  const first = db.appendEvent({ runtimeId: "runtime-1", projectId: "project-1", kind: "runtime_status", payload: { status: "running" }, timestamp: 100 });
  const second = db.appendEvent({ runtimeId: "runtime-1", projectId: "project-1", kind: "stderr", payload: "warning", timestamp: 101 });
  const third = db.appendEvent({ runtimeId: "runtime-2", projectId: "project-2", kind: "error", payload: { message: "boom" }, timestamp: 102 });

  assert.equal(db.lastEventId(), third.id);
  assert.deepEqual(db.listEvents(first.id, 10), [second, third]);
});

test("AppDatabase recentEvents returns oldest-to-newest order for selected recent events", () => {
  const db = createTestDatabase();

  const first = db.appendEvent({ runtimeId: "runtime-1", projectId: "project-1", kind: "stderr", payload: "one" });
  const second = db.appendEvent({ runtimeId: "runtime-1", projectId: "project-1", kind: "stderr", payload: "two" });
  const third = db.appendEvent({ runtimeId: "runtime-1", projectId: "project-1", kind: "stderr", payload: "three" });

  assert.deepEqual(db.recentEvents(2).map((event) => event.id), [second.id, third.id]);
  assert.notDeepEqual(db.recentEvents(2).map((event) => event.id), [third.id, second.id]);
  assert.equal(first.id + 2, third.id);
});

test("AppDatabase rejects non-JSON-serializable event payloads", () => {
  const db = createTestDatabase();

  assert.throws(
    () => db.appendEvent({ runtimeId: "runtime-1", projectId: "project-1", kind: "error", payload: undefined }),
    /Event payload must be JSON-serializable/,
  );
});
