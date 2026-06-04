import assert from "node:assert/strict";
import { mkdirSync, writeFileSync } from "node:fs";
import { mkdtempSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import test from "node:test";
import { AppDatabase } from "../src/db.js";
import { findPiSessionFileById, indexKnownPiSessions } from "../src/services/sessionIndexService.js";

function withSessionRoot<T>(root: string, run: () => T): T {
  const previous = process.env.PI_GUI_SESSION_ROOT;
  process.env.PI_GUI_SESSION_ROOT = root;
  try {
    return run();
  } finally {
    if (previous === undefined) delete process.env.PI_GUI_SESSION_ROOT;
    else process.env.PI_GUI_SESSION_ROOT = previous;
  }
}

test("indexKnownPiSessions scans Pi session files for known project cwd", () => {
  const dir = mkdtempSync(join(tmpdir(), "pi-gui-session-index-"));
  const sessionRoot = join(dir, "sessions");
  const projectCwd = join(dir, "project");
  const sessionDir = join(sessionRoot, "--tmp-project--");
  const sessionFile = join(sessionDir, "2026-06-03T10-29-08-506Z_session-1.jsonl");
  mkdirSync(projectCwd, { recursive: true });
  mkdirSync(sessionDir, { recursive: true });
  writeFileSync(
    sessionFile,
    [
      JSON.stringify({ type: "session", version: 3, id: "session-1", timestamp: "2026-06-03T10:29:08.506Z", cwd: projectCwd }),
      JSON.stringify({ type: "message", message: { role: "user", content: [{ type: "text", text: "请总结当前项目" }] } }),
    ].join("\n"),
    "utf8",
  );

  const db = new AppDatabase(join(dir, "pi-gui.sqlite"));
  db.createProject({ id: "project-1", name: "Project", cwd: projectCwd, lastOpenedAt: 1 });

  withSessionRoot(sessionRoot, () => {
    const indexed = indexKnownPiSessions(db);
    assert.equal(indexed.length, 1);
    assert.equal(indexed[0]?.id, "session-1");
    assert.equal(indexed[0]?.piSessionFile, sessionFile);
    assert.equal(indexed[0]?.title, "请总结当前项目");
    assert.equal(db.listSessions("project-1").length, 1);
  });

  db.close();
});

test("findPiSessionFileById locates a session file by id", () => {
  const dir = mkdtempSync(join(tmpdir(), "pi-gui-session-find-"));
  const sessionRoot = join(dir, "sessions");
  const projectCwd = join(dir, "project");
  const sessionDir = join(sessionRoot, "--tmp-project--");
  const sessionFile = join(sessionDir, "2026-06-03T10-29-08-506Z_session-2.jsonl");
  mkdirSync(projectCwd, { recursive: true });
  mkdirSync(sessionDir, { recursive: true });
  writeFileSync(sessionFile, JSON.stringify({ type: "session", id: "session-2", cwd: projectCwd }) + "\n", "utf8");

  withSessionRoot(sessionRoot, () => {
    assert.equal(findPiSessionFileById("session-2", projectCwd), sessionFile);
    assert.equal(findPiSessionFileById("missing", projectCwd), undefined);
  });
});
