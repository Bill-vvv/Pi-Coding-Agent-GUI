import assert from "node:assert/strict";
import { appendFileSync, mkdirSync, writeFileSync } from "node:fs";
import { mkdtempSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import test from "node:test";
import { AppDatabase } from "../src/db.js";
import { findPiSessionFileById, indexKnownPiSessions, readPiSessionConversationSummary } from "../src/services/sessionIndexService.js";

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

test("indexKnownPiSessions skips empty session files without conversation content", () => {
  const dir = mkdtempSync(join(tmpdir(), "pi-gui-empty-session-index-"));
  const sessionRoot = join(dir, "sessions");
  const projectCwd = join(dir, "project");
  const sessionDir = join(sessionRoot, "--tmp-project--");
  const sessionFile = join(sessionDir, "2026-06-03T10-29-08-506Z_empty-session.jsonl");
  mkdirSync(projectCwd, { recursive: true });
  mkdirSync(sessionDir, { recursive: true });
  writeFileSync(sessionFile, JSON.stringify({ type: "session", version: 3, id: "empty-session", timestamp: "2026-06-03T10:29:08.506Z", cwd: projectCwd }) + "\n", "utf8");

  const db = new AppDatabase(join(dir, "pi-gui.sqlite"));
  db.createProject({ id: "project-1", name: "Project", cwd: projectCwd, lastOpenedAt: 1 });

  withSessionRoot(sessionRoot, () => {
    const indexed = indexKnownPiSessions(db);
    assert.equal(indexed.length, 0);
    assert.equal(db.listSessions("project-1").length, 0);
  });

  db.close();
});

test("readPiSessionConversationSummary scans beyond initial metadata lines and extracts latest detail", () => {
  const dir = mkdtempSync(join(tmpdir(), "pi-gui-session-summary-"));
  const sessionFile = join(dir, "session-3.jsonl");
  const setupLines = Array.from({ length: 20 }, (_, index) => JSON.stringify({ type: "model_change", id: `model-${index}` }));
  writeFileSync(
    sessionFile,
    [
      JSON.stringify({ type: "session", id: "session-3", cwd: dir }),
      ...setupLines,
      JSON.stringify({ type: "message", id: "user-1", timestamp: "2026-06-03T10:00:00.000Z", message: { role: "user", content: [{ type: "text", text: "这是用户提出的第一个问题" }] } }),
      "{ malformed truncated line",
      JSON.stringify({ type: "message", id: "assistant-1", timestamp: "2026-06-03T10:01:00.000Z", message: { role: "assistant", content: [{ type: "text", text: "这是 Pi 的最后一句回复" }] } }),
    ].join("\n"),
    "utf8",
  );

  const summary = readPiSessionConversationSummary(sessionFile);

  assert.equal(summary?.title, "这是用户提出的第一个问题");
  assert.equal(summary?.detail, "这是 Pi 的最后一句回复");
  assert.equal(summary?.messageCount, 2);
  assert.equal(summary?.latestAssistantCompletedAt, Date.parse("2026-06-03T10:01:00.000Z"));
});

test("session summary cache persists across database instances and invalidates on file changes", () => {
  const dir = mkdtempSync(join(tmpdir(), "pi-gui-session-summary-cache-"));
  const dbPath = join(dir, "pi-gui.sqlite");
  const sessionFile = join(dir, "session-cache.jsonl");
  writeFileSync(
    sessionFile,
    [
      JSON.stringify({ type: "session", id: "session-cache", cwd: dir }),
      JSON.stringify({ type: "message", id: "user-1", timestamp: "2026-06-03T10:00:00.000Z", message: { role: "user", content: [{ type: "text", text: "缓存前的问题" }] } }),
    ].join("\n") + "\n",
    "utf8",
  );

  const firstDb = new AppDatabase(dbPath);
  const first = readPiSessionConversationSummary(sessionFile, firstDb);
  assert.equal(first?.title, "缓存前的问题");
  firstDb.close();

  const secondDb = new AppDatabase(dbPath);
  const cached = readPiSessionConversationSummary(sessionFile, secondDb);
  assert.equal(cached?.title, "缓存前的问题");

  appendFileSync(
    sessionFile,
    `${JSON.stringify({ type: "message", id: "assistant-1", timestamp: "2026-06-03T10:01:00.000Z", message: { role: "assistant", content: [{ type: "text", text: "文件变化后的回答" }] } })}\n`,
    "utf8",
  );
  const updated = readPiSessionConversationSummary(sessionFile, secondDb);
  assert.equal(updated?.title, "缓存前的问题");
  assert.equal(updated?.detail, "文件变化后的回答");
  assert.equal(updated?.messageCount, 2);
  secondDb.close();
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
