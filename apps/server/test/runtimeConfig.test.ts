import assert from "node:assert/strict";
import { mkdtempSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import test from "node:test";
import type { ServerEvent } from "@pi-gui/shared";
import { AppDatabase } from "../src/db.js";
import { RuntimeSupervisor } from "../src/runtime/runtimeSupervisor.js";

function createHarness() {
  const dir = mkdtempSync(join(tmpdir(), "pi-gui-runtime-config-"));
  const db = new AppDatabase(join(dir, "pi-gui.sqlite"));
  const broadcasted: ServerEvent[] = [];
  const supervisor = new RuntimeSupervisor(db, (event) => broadcasted.push(event));
  return { db, supervisor, broadcasted };
}

test("RuntimeSupervisor persists runtime.configure for stopped runtimes", () => {
  const { db, supervisor, broadcasted } = createHarness();
  db.createProject({ id: "project-1", name: "Project", cwd: process.cwd(), lastOpenedAt: 1 });
  db.upsertRuntime({
    id: "runtime-1",
    projectId: "project-1",
    cwd: process.cwd(),
    status: "stopped",
    sessionId: "session-1",
    startedAt: 100,
    model: "openai-codex/gpt-5.2",
    thinkingLevel: "medium",
    responseMode: "normal",
  });

  supervisor.configureRuntime("runtime-1", {
    modelProvider: "openai-codex",
    modelId: "gpt-5.4",
    thinkingLevel: "high",
    responseMode: "fast",
  });

  const runtime = db.getRuntime("runtime-1");
  assert.equal(runtime?.model, "openai-codex/gpt-5.4");
  assert.equal(runtime?.thinkingLevel, "high");
  assert.equal(runtime?.responseMode, "fast");
  assert.ok(broadcasted.some((event) => event.type === "runtime.status" && event.runtime.id === "runtime-1" && event.runtime.model === "openai-codex/gpt-5.4"));
  db.close();
});

test("RuntimeSupervisor runtime.configure preserves omitted runtime config fields", () => {
  const { db, supervisor } = createHarness();
  db.createProject({ id: "project-1", name: "Project", cwd: process.cwd(), lastOpenedAt: 1 });
  db.upsertRuntime({
    id: "runtime-1",
    projectId: "project-1",
    cwd: process.cwd(),
    status: "stopped",
    sessionId: "session-1",
    startedAt: 100,
    model: "openai-codex/gpt-5.2",
    thinkingLevel: "medium",
    responseMode: "normal",
  });

  supervisor.configureRuntime("runtime-1", { thinkingLevel: "xhigh" });

  const runtime = db.getRuntime("runtime-1");
  assert.equal(runtime?.model, "openai-codex/gpt-5.2");
  assert.equal(runtime?.thinkingLevel, "xhigh");
  assert.equal(runtime?.responseMode, "normal");
  db.close();
});
