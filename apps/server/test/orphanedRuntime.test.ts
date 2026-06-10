import assert from "node:assert/strict";
import { mkdtempSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import test from "node:test";
import { AppDatabase } from "../src/db.js";

function createDbPath(): string {
  return join(mkdtempSync(join(tmpdir(), "pi-gui-orphaned-")), "pi-gui.sqlite");
}

test("AppDatabase marks running runtimes from a previous server as crashed on startup", () => {
  const dbPath = createDbPath();
  const firstDb = new AppDatabase(dbPath);
  firstDb.createProject({ id: "project-1", name: "Project", cwd: process.cwd(), lastOpenedAt: 1 });
  firstDb.upsertRuntime({ id: "runtime-running", projectId: "project-1", cwd: process.cwd(), status: "running", pid: 12345, sessionId: "session-1", startedAt: 10 });
  firstDb.upsertRuntime({ id: "runtime-starting", projectId: "project-1", cwd: process.cwd(), status: "starting", pid: 23456, startedAt: 11 });
  firstDb.upsertRuntime({ id: "runtime-stopped", projectId: "project-1", cwd: process.cwd(), status: "stopped", sessionId: "session-2", startedAt: 12 });
  firstDb.setConversationBusy("runtime-running", "project-1", true, 20);
  firstDb.upsertConversationMessage({
    id: "tool-ask-batch",
    runtimeId: "runtime-running",
    projectId: "project-1",
    role: "tool",
    title: "ask_batch 运行中",
    text: "",
    timestamp: 21,
    updatedAt: 21,
    isStreaming: true,
  });
  firstDb.close();

  const restartedDb = new AppDatabase(dbPath);

  const running = restartedDb.getRuntime("runtime-running");
  const starting = restartedDb.getRuntime("runtime-starting");
  const stopped = restartedDb.getRuntime("runtime-stopped");

  assert.equal(running?.status, "crashed");
  assert.equal(running?.pid, undefined);
  assert.equal(running?.sessionId, "session-1");
  assert.equal(starting?.status, "crashed");
  assert.equal(starting?.pid, undefined);
  assert.equal(stopped?.status, "stopped");
  assert.equal(stopped?.sessionId, "session-2");
  assert.equal(restartedDb.getConversationBusy("runtime-running"), false);
  const interruptedTool = restartedDb.getConversationMessage("runtime-running", "tool-ask-batch");
  assert.equal(interruptedTool?.isStreaming, false);
  assert.equal(interruptedTool?.title, "ask_batch 失败");
  assert.equal(interruptedTool?.text, "GUI 服务重启，工具未返回结果。");

  const events = restartedDb.listEvents(0, 20);
  const runningEvents = events.filter((event) => event.runtimeId === "runtime-running");
  assert.ok(runningEvents.some((event) => event.kind === "runtime_status" && eventPayloadStatus(event.payload) === "crashed"));
  assert.ok(
    runningEvents.some(
      (event) => event.kind === "error" && eventPayloadReason(event.payload) === "orphaned_runtime_on_startup" && eventPayloadStatus(event.payload) === "crashed",
    ),
  );

  restartedDb.close();
});

function eventPayloadStatus(payload: unknown): unknown {
  return typeof payload === "object" && payload !== null && "status" in payload ? payload.status : undefined;
}

function eventPayloadReason(payload: unknown): unknown {
  return typeof payload === "object" && payload !== null && "reason" in payload ? payload.reason : undefined;
}
