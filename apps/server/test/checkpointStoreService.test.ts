import assert from "node:assert/strict";
import { mkdir, writeFile } from "node:fs/promises";
import { mkdtempSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import test from "node:test";
import type { Project } from "@pi-gui/shared";
import { listProjectRewindCheckpoints } from "../src/services/checkpointStoreService.js";

function project(cwd: string): Project {
  return { id: "project-1", name: "Project", cwd, lastOpenedAt: 1 };
}

async function writeStore(cwd: string, lines: unknown[]): Promise<void> {
  const dir = join(cwd, ".pi", "rewind");
  await mkdir(dir, { recursive: true });
  const text = lines.map((line) => (typeof line === "string" ? line : JSON.stringify(line))).join("\n") + "\n";
  await writeFile(join(dir, "checkpoints.jsonl"), text);
}

test("checkpoint store reader returns empty list when store is missing", async () => {
  const cwd = mkdtempSync(join(tmpdir(), "pi-gui-checkpoint-missing-"));

  const checkpoints = await listProjectRewindCheckpoints(project(cwd));

  assert.deepEqual(checkpoints, []);
});

test("checkpoint store reader ignores malformed lines and jump records", async () => {
  const cwd = mkdtempSync(join(tmpdir(), "pi-gui-checkpoint-store-"));
  await writeStore(cwd, [
    "not-json",
    { kind: "jump", version: 1, fromLeafId: "leaf", targetEntryId: "target", targetPrompt: "prompt", createdAt: 3, cwd, git: { available: false } },
    { kind: "checkpoint", version: 1, id: "later", entryId: "entry-2", prompt: "later prompt", createdAt: 20, cwd, sessionFile: "/tmp/session.jsonl", git: { available: true, dirty: false, backend: "patch" } },
    { kind: "checkpoint", version: 1, id: "other-cwd", entryId: "entry-3", prompt: "other", createdAt: 30, cwd: "/other", git: { available: false } },
    { kind: "checkpoint", version: 1, entryId: "entry-1", prompt: "first prompt", createdAt: 10, cwd, git: { available: true, dirty: true, backend: "patch", statusPreview: " M a.txt" } },
  ]);

  const checkpoints = await listProjectRewindCheckpoints(project(cwd));

  assert.deepEqual(
    checkpoints.map((checkpoint) => ({ id: checkpoint.id, entry: checkpoint.sessionEntryId, prompt: checkpoint.prompt, backend: checkpoint.git.backend })),
    [
      { id: "later", entry: "entry-2", prompt: "later prompt", backend: "patch" },
      { id: "entry-1", entry: "entry-1", prompt: "first prompt", backend: "patch" },
    ],
  );
  assert.equal(checkpoints[0]?.projectId, "project-1");
  assert.equal(checkpoints[0]?.sessionFile, "/tmp/session.jsonl");
});
