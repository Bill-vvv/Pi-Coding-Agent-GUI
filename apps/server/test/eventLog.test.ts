import assert from "node:assert/strict";
import { mkdtempSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import test from "node:test";
import { AppDatabase } from "../src/db.js";
import { compactPayloadForEventLog } from "../src/runtime/eventLogCompaction.js";

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

test("AppDatabase filters replayed GUI events by project and runtime", () => {
  const db = createTestDatabase();

  const first = db.appendEvent({ runtimeId: "runtime-1", projectId: "project-1", kind: "stderr", payload: "one" });
  const second = db.appendEvent({ runtimeId: "runtime-2", projectId: "project-1", kind: "stderr", payload: "two" });
  const third = db.appendEvent({ runtimeId: "runtime-3", projectId: "project-2", kind: "stderr", payload: "three" });

  assert.deepEqual(db.listEvents(0, 10, { projectId: "project-1" }).map((event) => event.id), [first.id, second.id]);
  assert.deepEqual(db.listEvents(0, 10, { runtimeId: "runtime-2" }).map((event) => event.id), [second.id]);
  assert.deepEqual(db.listEvents(first.id, 10, { projectId: "project-2" }).map((event) => event.id), [third.id]);
  db.close();
});

test("AppDatabase filters replayed GUI events by kind", () => {
  const db = createTestDatabase();

  const status = db.appendEvent({ runtimeId: "runtime-1", projectId: "project-1", kind: "runtime_status", payload: { status: "crashed" } });
  db.appendEvent({ runtimeId: "runtime-1", projectId: "project-1", kind: "pi_event", payload: { type: "message", text: "hidden" } });
  const stderr = db.appendEvent({ runtimeId: "runtime-1", projectId: "project-1", kind: "stderr", payload: "warning" });
  const error = db.appendEvent({ runtimeId: "runtime-2", projectId: "project-1", kind: "error", payload: { message: "boom" } });

  assert.deepEqual(db.listEvents(0, 10, { runtimeId: "runtime-1", kinds: ["runtime_status", "stderr", "error"] }).map((event) => event.id), [status.id, stderr.id]);
  assert.deepEqual(db.listEvents(0, 10, { kinds: ["error"] }).map((event) => event.id), [error.id]);
  db.close();
});

test("AppDatabase lists recent filtered GUI events in chronological order", () => {
  const db = createTestDatabase();

  db.appendEvent({ runtimeId: "runtime-1", projectId: "project-1", kind: "stderr", payload: "old" });
  const middle = db.appendEvent({ runtimeId: "runtime-1", projectId: "project-1", kind: "error", payload: { message: "middle" } });
  const latest = db.appendEvent({ runtimeId: "runtime-1", projectId: "project-1", kind: "runtime_status", payload: { status: "crashed" } });
  db.appendEvent({ runtimeId: "runtime-1", projectId: "project-1", kind: "pi_event", payload: { text: "hidden" } });
  db.appendEvent({ runtimeId: "runtime-2", projectId: "project-1", kind: "error", payload: { message: "other" } });

  assert.deepEqual(db.listRecentEvents(2, { runtimeId: "runtime-1", kinds: ["runtime_status", "stderr", "error"] }).map((event) => event.id), [middle.id, latest.id]);
  db.close();
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

test("event log compaction preserves get_session_stats token totals", () => {
  assert.deepEqual(
    compactPayloadForEventLog("pi_event", {
      type: "response",
      id: "stats-1",
      command: "get_session_stats",
      success: true,
      data: {
        contextUsage: { tokens: 100, contextWindow: 1000, percent: 10 },
        tokens: { input: 10, output: 2, cacheRead: 20, cacheWrite: 0, total: 32 },
        cost: 0.1234,
        sessionFile: "/tmp/session.jsonl",
      },
    }),
    {
      type: "response",
      id: "stats-1",
      command: "get_session_stats",
      success: true,
      data: {
        contextUsage: { tokens: 100, contextWindow: 1000, percent: 10 },
        tokens: { input: 10, output: 2, cacheRead: 20, cacheWrite: 0, total: 32 },
        cost: 0.1234,
        sessionFile: "/tmp/session.jsonl",
      },
    },
  );
});

test("AppDatabase persists conversation context session token totals", () => {
  const db = createTestDatabase();
  db.createProject({ id: "project-1", name: "Project", cwd: "/tmp/project", lastOpenedAt: 1 });

  db.updateConversationContext("runtime-1", "project-1", {
    tokens: 100,
    contextWindow: 1000,
    percent: 10,
    sessionTokens: { input: 10, output: 2, cacheRead: 20, cacheWrite: 0, total: 32, cost: 0.1234 },
    updatedAt: 123,
  });

  assert.deepEqual(db.getConversationContext("runtime-1"), {
    tokens: 100,
    contextWindow: 1000,
    percent: 10,
    sessionTokens: { input: 10, output: 2, cacheRead: 20, cacheWrite: 0, total: 32, cost: 0.1234 },
    updatedAt: 123,
  });
  db.close();
});

test("AppDatabase keeps cumulative conversation session token totals from decreasing", () => {
  const db = createTestDatabase();
  db.createProject({ id: "project-1", name: "Project", cwd: "/tmp/project", lastOpenedAt: 1 });

  db.updateConversationContext("runtime-1", "project-1", {
    tokens: 900,
    contextWindow: 1000,
    percent: 90,
    sessionTokens: { input: 100, output: 20, cacheRead: 500, cacheWrite: 10, total: 630, cost: 0.42 },
    updatedAt: 123,
  });

  db.updateConversationContext("runtime-1", "project-1", {
    tokens: 80,
    contextWindow: 1000,
    percent: 8,
    sessionTokens: { input: 10, output: 5, cacheRead: 20, cacheWrite: 0, total: 35, cost: 0.02 },
    updatedAt: 124,
  });

  assert.deepEqual(db.getConversationContext("runtime-1"), {
    tokens: 80,
    contextWindow: 1000,
    percent: 8,
    sessionTokens: { input: 100, output: 20, cacheRead: 500, cacheWrite: 10, total: 630, cost: 0.42 },
    updatedAt: 124,
  });
  db.close();
});

test("AppDatabase clears context token count when Pi reports post-compaction unknown usage", () => {
  const db = createTestDatabase();
  db.createProject({ id: "project-1", name: "Project", cwd: "/tmp/project", lastOpenedAt: 1 });

  db.updateConversationContext("runtime-1", "project-1", {
    tokens: 900,
    contextWindow: 1000,
    percent: 90,
    sessionTokens: { total: 900 },
    updatedAt: 123,
  });

  db.updateConversationContext("runtime-1", "project-1", {
    tokens: null,
    contextWindow: 1000,
    percent: null,
    sessionTokens: { total: 920 },
    updatedAt: 124,
  });

  assert.deepEqual(db.getConversationContext("runtime-1"), {
    tokens: undefined,
    contextWindow: 1000,
    percent: undefined,
    sessionTokens: { input: undefined, output: undefined, cacheRead: undefined, cacheWrite: undefined, total: 920, cost: undefined },
    updatedAt: 124,
  });
  db.close();
});

test("AppDatabase rejects non-JSON-serializable event payloads", () => {
  const db = createTestDatabase();

  assert.throws(
    () => db.appendEvent({ runtimeId: "runtime-1", projectId: "project-1", kind: "error", payload: undefined }),
    /Event payload must be JSON-serializable/,
  );
});
