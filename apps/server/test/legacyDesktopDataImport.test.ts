import assert from "node:assert/strict";
import { mkdtempSync, mkdirSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { dirname, join } from "node:path";
import { pathToFileURL } from "node:url";
import test from "node:test";
import { AppDatabase } from "../src/db.js";
import { importLegacyDesktopData } from "../src/services/legacyDesktopDataImport.js";
import { defaultDbPath, legacyDesktopDbPath } from "../src/serverPaths.js";

const host = { kind: "wsl" as const, id: "wsl:Ubuntu", label: "WSL (Ubuntu)" };

test("legacy desktop data import merges sessions into the canonical gui db", () => {
  const root = mkdtempSync(join(tmpdir(), "pi-gui-legacy-import-"));
  const fromUrl = pathToFileURL(join(root, "src", "index.ts")).href;
  mkdirSync(dirname(defaultDbPath({}, fromUrl)), { recursive: true });
  mkdirSync(dirname(legacyDesktopDbPath(fromUrl)), { recursive: true });

  const canonical = withoutExecutionHostEnv(() => new AppDatabase(defaultDbPath({}, fromUrl), host));
  canonical.createProject({ id: "project-main", name: "pi-gui", cwd: "/home/user/projects/pi-gui", lastOpenedAt: 1, host });

  const legacy = withoutExecutionHostEnv(() => new AppDatabase(legacyDesktopDbPath(fromUrl), host));
  legacy.createProject({ id: "project-legacy-existing", name: "pi-gui", cwd: "/home/user/projects/pi-gui", lastOpenedAt: 2, host });
  legacy.createProject({ id: "project-legacy-new", name: "other", cwd: "/home/user/projects/other", lastOpenedAt: 3, host });
  legacy.upsertSession({ id: "session-existing-project", projectId: "project-legacy-existing", piSessionFile: "/tmp/session-existing-project.jsonl", title: "Existing project session", createdAt: 10, updatedAt: 11, host });
  legacy.upsertSession({ id: "session-new-project", projectId: "project-legacy-new", piSessionFile: "/tmp/session-new-project.jsonl", title: "New project session", createdAt: 12, updatedAt: 13, host });
  legacy.close();

  const messages: string[] = [];
  const result = importLegacyDesktopData(canonical, { env: {}, fromUrl, log: (message) => messages.push(message) });

  assert.deepEqual(result, { importedProjects: 1, importedSessions: 2 });
  const projects = canonical.listProjects();
  assert.equal(projects.length, 2);
  const existingProject = projects.find((project) => project.cwd === "/home/user/projects/pi-gui");
  const newProject = projects.find((project) => project.cwd === "/home/user/projects/other");
  assert.ok(existingProject);
  assert.ok(newProject);

  const existingSession = canonical.getSession("session-existing-project");
  const newSession = canonical.getSession("session-new-project");
  assert.equal(existingSession?.projectId, existingProject?.id);
  assert.equal(newSession?.projectId, newProject?.id);
  assert.equal(existingSession?.runtimeId, undefined);
  assert.equal(newSession?.runtimeId, undefined);
  assert.equal(messages.length, 1);

  const rerun = importLegacyDesktopData(canonical, { env: {}, fromUrl, log: (message) => messages.push(message) });
  assert.deepEqual(rerun, { importedProjects: 0, importedSessions: 0 });
  assert.equal(messages.length, 1);
  canonical.close();
});

test("legacy desktop data import skips unreadable legacy sqlite files", () => {
  const root = mkdtempSync(join(tmpdir(), "pi-gui-legacy-import-bad-"));
  const fromUrl = pathToFileURL(join(root, "src", "index.ts")).href;
  mkdirSync(dirname(defaultDbPath({}, fromUrl)), { recursive: true });
  mkdirSync(dirname(legacyDesktopDbPath(fromUrl)), { recursive: true });
  writeFileSync(legacyDesktopDbPath(fromUrl), "not a sqlite database");

  const canonical = withoutExecutionHostEnv(() => new AppDatabase(defaultDbPath({}, fromUrl), host));
  const messages: string[] = [];
  const result = importLegacyDesktopData(canonical, { env: {}, fromUrl, log: (message) => messages.push(message) });

  assert.deepEqual(result, { importedProjects: 0, importedSessions: 0 });
  assert.equal(messages.length, 1);
  assert.match(messages[0], /Skipped legacy desktop data import/);
  canonical.close();
});

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
