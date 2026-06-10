import assert from "node:assert/strict";
import { mkdtempSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import test from "node:test";
import { AppDatabase } from "../src/db.js";

function createTestDatabase(): AppDatabase {
  const dir = mkdtempSync(join(tmpdir(), "pi-gui-session-"));
  return withoutExecutionHostEnv(() => new AppDatabase(join(dir, "pi-gui.sqlite")));
}

function createHostedTestDatabase(): AppDatabase {
  const dir = mkdtempSync(join(tmpdir(), "pi-gui-session-host-"));
  return new AppDatabase(join(dir, "pi-gui.sqlite"), { kind: "wsl", id: "wsl:Ubuntu", label: "WSL (Ubuntu)" });
}

function withoutExecutionHostEnv<T>(run: () => T): T {
  const previous = {
    kind: process.env.PI_GUI_EXECUTION_HOST_KIND,
    id: process.env.PI_GUI_EXECUTION_HOST_ID,
    label: process.env.PI_GUI_EXECUTION_HOST_LABEL,
  };
  delete process.env.PI_GUI_EXECUTION_HOST_KIND;
  delete process.env.PI_GUI_EXECUTION_HOST_ID;
  delete process.env.PI_GUI_EXECUTION_HOST_LABEL;
  try {
    return run();
  } finally {
    if (previous.kind === undefined) delete process.env.PI_GUI_EXECUTION_HOST_KIND;
    else process.env.PI_GUI_EXECUTION_HOST_KIND = previous.kind;
    if (previous.id === undefined) delete process.env.PI_GUI_EXECUTION_HOST_ID;
    else process.env.PI_GUI_EXECUTION_HOST_ID = previous.id;
    if (previous.label === undefined) delete process.env.PI_GUI_EXECUTION_HOST_LABEL;
    else process.env.PI_GUI_EXECUTION_HOST_LABEL = previous.label;
  }
}

test("AppDatabase settings persist default runtime profile and confirmed project extensions", () => {
  const db = createTestDatabase();
  const settings = db.updateSettings({ defaultRuntimeProfileId: "pi-gui-enhanced", confirmedProjectExtensionIds: ["project:/tmp/trellis.ts", "project:/tmp/trellis.ts", "project:/tmp/ask.ts"] });

  assert.equal(settings.defaultRuntimeProfileId, "pi-gui-enhanced");
  assert.deepEqual(settings.confirmedProjectExtensionIds, ["project:/tmp/ask.ts", "project:/tmp/trellis.ts"]);
  assert.equal(db.getSettings().defaultRuntimeProfileId, "pi-gui-enhanced");
  assert.deepEqual(db.getSettings().confirmedProjectExtensionIds, ["project:/tmp/ask.ts", "project:/tmp/trellis.ts"]);
  db.close();
});

test("AppDatabase persists project runtime profile override", () => {
  const db = createTestDatabase();
  db.createProject({ id: "project-1", name: "Project", cwd: process.cwd(), lastOpenedAt: 1 });

  const updated = db.updateProjectRuntimeProfile("project-1", "trellis-workflow");
  assert.equal(updated?.defaultRuntimeProfileId, "trellis-workflow");
  assert.equal(db.getProject("project-1")?.defaultRuntimeProfileId, "trellis-workflow");

  db.updateProjectRuntimeProfile("project-1", null);
  assert.equal(db.getProject("project-1")?.defaultRuntimeProfileId, undefined);
  db.close();
});

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

test("AppDatabase tags projects, runtimes, and sessions with the execution host", () => {
  const db = createHostedTestDatabase();
  const project = db.createProject({ id: "project-1", name: "Project", cwd: process.cwd(), lastOpenedAt: 1 });
  const runtime = db.upsertRuntime({ id: "runtime-1", projectId: "project-1", cwd: process.cwd(), status: "starting" });
  const session = db.upsertSession({
    id: "session-1",
    projectId: "project-1",
    piSessionFile: "/tmp/session-1.jsonl",
    createdAt: 100,
    updatedAt: 101,
  });

  assert.deepEqual(project.host, { kind: "wsl", id: "wsl:Ubuntu", label: "WSL (Ubuntu)" });
  assert.deepEqual(runtime.host, project.host);
  assert.deepEqual(session.host, project.host);
  assert.deepEqual(db.listSessions()[0]?.host, project.host);
  db.close();
});

test("AppDatabase persists runtime profile and enabled capability metadata", () => {
  const db = createTestDatabase();
  db.createProject({ id: "project-1", name: "Project", cwd: process.cwd(), lastOpenedAt: 1 });
  db.upsertRuntime({
    id: "runtime-1",
    projectId: "project-1",
    cwd: process.cwd(),
    status: "running",
    runtimeProfileId: "pi-gui-enhanced",
    enabledCapabilityIds: ["interactive-prompts", "pi-ready-notifications"],
  });

  const runtime = db.getRuntime("runtime-1");
  assert.equal(runtime?.runtimeProfileId, "pi-gui-enhanced");
  assert.deepEqual(runtime?.enabledCapabilityIds, ["interactive-prompts", "pi-ready-notifications"]);
  assert.deepEqual(db.listRuntimes()[0]?.enabledCapabilityIds, ["interactive-prompts", "pi-ready-notifications"]);
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

test("AppDatabase session upsert preserves existing runtime link when scan update omits it", () => {
  const db = createTestDatabase();
  db.createProject({ id: "project-1", name: "Project", cwd: process.cwd(), lastOpenedAt: 1 });

  db.upsertSession({
    id: "session-1",
    projectId: "project-1",
    piSessionFile: "/tmp/session-1.jsonl",
    createdAt: 100,
    updatedAt: 101,
    runtimeId: "runtime-1",
  });
  const updated = db.upsertSession({
    id: "session-1",
    projectId: "project-1",
    piSessionFile: "/tmp/session-1.jsonl",
    title: "扫描标题",
    createdAt: 100,
    updatedAt: 200,
  });

  assert.equal(updated.runtimeId, "runtime-1");
  assert.equal(updated.title, "扫描标题");
  assert.equal(updated.updatedAt, 200);
  db.close();
});

test("AppDatabase returns latest non-archived runtime by session id", () => {
  const db = createTestDatabase();
  db.createProject({ id: "project-1", name: "Project", cwd: process.cwd(), lastOpenedAt: 1 });

  db.upsertRuntime({ id: "runtime-old", projectId: "project-1", cwd: process.cwd(), status: "stopped", sessionId: "session-1", startedAt: 100 });
  db.upsertRuntime({ id: "runtime-new", projectId: "project-1", cwd: process.cwd(), status: "stopped", sessionId: "session-1", startedAt: 200 });
  db.archiveRuntime("runtime-new", Date.now());

  assert.equal(db.getLatestRuntimeBySessionId("session-1")?.id, "runtime-old");
  db.close();
});
