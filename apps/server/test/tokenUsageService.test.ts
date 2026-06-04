import assert from "node:assert/strict";
import { mkdirSync, writeFileSync } from "node:fs";
import { mkdtempSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import test from "node:test";
import { AppDatabase } from "../src/db.js";
import { TokenUsageService } from "../src/services/tokenUsageService.js";

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

function createDb(dir: string, projects: Array<{ id: string; cwd: string }>): AppDatabase {
  const db = new AppDatabase(join(dir, "pi-gui.sqlite"));
  for (const project of projects) {
    mkdirSync(project.cwd, { recursive: true });
    db.createProject({ id: project.id, name: project.id, cwd: project.cwd, lastOpenedAt: 1 });
  }
  return db;
}

function writeSession(root: string, name: string, lines: unknown[]): string {
  const sessionDir = join(root, name);
  mkdirSync(sessionDir, { recursive: true });
  const file = join(sessionDir, `${name}.jsonl`);
  const content = lines.map((line) => (typeof line === "string" ? line : JSON.stringify(line))).join("\n");
  writeFileSync(file, `${content}\n`, "utf8");
  return file;
}

test("token usage overview aggregates recorded assistant usage by local day and aliases", () => {
  const dir = mkdtempSync(join(tmpdir(), "pi-gui-usage-"));
  const sessionRoot = join(dir, "sessions");
  const projectCwd = join(dir, "project-a");
  const otherProjectCwd = join(dir, "project-b");
  const db = createDb(dir, [
    { id: "project-a", cwd: projectCwd },
    { id: "project-b", cwd: otherProjectCwd },
  ]);

  writeSession(sessionRoot, "session-a", [
    { type: "session", id: "session-a", cwd: projectCwd, timestamp: "2026-06-04T08:00:00.000Z" },
    { type: "model_change", provider: "openai-codex", modelId: "codex-large" },
    { type: "message", timestamp: "2026-06-04T09:00:00.000Z", message: { role: "assistant", usage: { inputTokens: 10, output_tokens: 5, cache_read_tokens: 2, cacheCreationTokens: 3 } } },
    { type: "message", message: { role: "assistant", timestamp: "2026-06-04T11:00:00.000Z", provider: "anthropic", model: "claude", usage: { prompt_tokens: 7, completionTokens: 8, totalTokens: 30, cost: 0.12 } } },
    { type: "message", timestamp: "2026-06-04T10:00:00.000Z", message: { role: "assistant" } },
  ]);
  writeSession(sessionRoot, "session-b", [
    { type: "session", id: "session-b", cwd: otherProjectCwd, timestamp: "2026-06-04T08:00:00.000Z" },
    { type: "message", timestamp: "2026-06-04T09:00:00.000Z", message: { role: "assistant", model: "other", usage: { tokens: 99 } } },
  ]);

  const service = new TokenUsageService({ now: () => Date.parse("2026-06-05T12:00:00.000Z") });
  withSessionRoot(sessionRoot, () => {
    const overview = service.getOverview(db, { range: "30d", projectId: "project-a" });
    const day = overview.days.find((item) => item.day === "2026-06-04");
    assert.ok(day);
    assert.equal(day.tokens.total, 50);
    assert.equal(day.tokens.input, 17);
    assert.equal(day.tokens.output, 13);
    assert.equal(day.tokens.cacheRead, 2);
    assert.equal(day.tokens.cacheWrite, 3);
    assert.equal(day.tokens.cost, 0.12);
    assert.equal(overview.summary.totalTokens, 50);
    assert.equal(overview.summary.messages, 2);
    assert.equal(overview.coverage.assistantMessages, 3);
    assert.equal(overview.coverage.recordedUsageMessages, 2);
    assert.equal(overview.coverage.missingUsageMessages, 1);
    assert.equal(overview.summary.quality, "partial");
    assert.equal(overview.models[0]?.model, "claude");
    assert.equal(overview.models[1]?.provider, "openai-codex");
  });

  db.close();
});

test("token usage overview handles timestamp variants, malformed/truncated lines, and missing timestamps", () => {
  const dir = mkdtempSync(join(tmpdir(), "pi-gui-usage-edge-"));
  const sessionRoot = join(dir, "sessions");
  const projectCwd = join(dir, "project");
  const db = createDb(dir, [{ id: "project", cwd: projectCwd }]);
  const hugeLine = JSON.stringify({ type: "message", timestamp: "2026-06-04T00:00:00.000Z", message: { role: "assistant", usage: { totalTokens: 1000 } } });

  writeSession(sessionRoot, "session-edge", [
    { type: "session", id: "session-edge", cwd: projectCwd, timestamp: "2026-06-01T00:00:00.000Z" },
    { type: "message", timestamp: 1780531200000, message: { role: "assistant", model: "ms", usage: { total_tokens: 11 } } },
    { type: "message", timestamp: 1780617600, message: { role: "assistant", model: "s", usage: { token_count: 13 } } },
    { type: "message", message: { role: "assistant", model: "missing-time", usage: { tokens: 17 } } },
    "{bad json",
    `${hugeLine}${" ".repeat(200)}`,
  ]);

  const service = new TokenUsageService({ now: () => Date.parse("2026-06-05T12:00:00.000Z"), maxLineBytes: 260 });
  withSessionRoot(sessionRoot, () => {
    const overview = service.getOverview(db, { range: "7d" });
    assert.equal(overview.summary.totalTokens, 24);
    assert.equal(overview.days.find((day) => day.day === "2026-06-04")?.tokens.total, 11);
    assert.equal(overview.days.find((day) => day.day === "2026-06-05")?.tokens.total, 13);
    assert.equal(overview.coverage.skippedMissingTimestamp, 1);
    assert.equal(overview.coverage.malformedLines, 1);
    assert.equal(overview.coverage.truncatedLines, 1);
    assert.equal(overview.summary.quality, "partial");
  });

  db.close();
});

test("token usage overview supports project filtering, safe empty unknown project, all range, and cache hits", () => {
  const dir = mkdtempSync(join(tmpdir(), "pi-gui-usage-cache-"));
  const sessionRoot = join(dir, "sessions");
  const projectCwd = join(dir, "project");
  const db = createDb(dir, [{ id: "project", cwd: projectCwd }]);
  writeSession(sessionRoot, "session-cache", [
    { type: "session", id: "session-cache", cwd: projectCwd, timestamp: "2026-05-01T00:00:00.000Z" },
    { type: "message", timestamp: "2026-05-01T01:00:00.000Z", message: { role: "assistant", model: "old", usage: { totalTokens: 41 } } },
  ]);

  const service = new TokenUsageService({ now: () => Date.parse("2026-06-05T12:00:00.000Z") });
  withSessionRoot(sessionRoot, () => {
    const all = service.getOverview(db, { range: "all", projectId: "project" });
    assert.deepEqual(all.days.map((day) => day.day), ["2026-05-01"]);
    assert.equal(all.summary.totalTokens, 41);

    const cached = service.getOverview(db, { range: "all", projectId: "project" });
    assert.equal(cached.coverage.cachedFiles, 1);
    assert.equal(cached.coverage.scannedFiles, 1);

    const empty = service.getOverview(db, { range: "all", projectId: "missing" });
    assert.equal(empty.summary.totalTokens, 0);
    assert.equal(empty.projectId, "missing");
  });

  db.close();
});
