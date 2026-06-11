import assert from "node:assert/strict";
import { mkdtemp, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { spawnSync } from "node:child_process";
import test from "node:test";
import { parseGitStatus, readProjectGitSummary } from "../src/services/projectGitSummary.js";

test("parseGitStatus reads branch, ahead/behind, and changed files from porcelain v2", () => {
  const parsed = parseGitStatus([
    "# branch.oid 1234567890abcdef",
    "# branch.head feat/demo",
    "# branch.upstream origin/feat/demo",
    "# branch.ab +2 -1",
    "1 .M N... 100644 100644 100644 abcdef abcdef file-a.ts",
    "? new-file.ts",
  ].join("\n"));

  assert.equal(parsed.branch, "feat/demo");
  assert.equal(parsed.head, "12345678");
  assert.equal(parsed.upstream, "origin/feat/demo");
  assert.equal(parsed.ahead, 2);
  assert.equal(parsed.behind, 1);
  assert.equal(parsed.changedFiles, 2);
  assert.equal(parsed.dirty, true);
  assert.equal(parsed.detached, false);
});

test("readProjectGitSummary reports non-git directories safely", async (t) => {
  const dir = await mkdtemp(join(tmpdir(), "pi-gui-project-git-"));
  t.after(async () => { await rm(dir, { recursive: true, force: true }); });

  const summary = readProjectGitSummary(dir);
  assert.equal(summary.available, false);
  assert.equal(summary.branch, undefined);
});

test("readProjectGitSummary reports branch and dirty state for git repos", async (t) => {
  const dir = await mkdtemp(join(tmpdir(), "pi-gui-project-git-"));
  t.after(async () => { await rm(dir, { recursive: true, force: true }); });

  git(dir, ["init", "-b", "main"]);
  git(dir, ["config", "user.email", "test@example.com"]);
  git(dir, ["config", "user.name", "Pi GUI Test"]);
  await writeFile(join(dir, "demo.txt"), "one\n", "utf8");
  git(dir, ["add", "demo.txt"]);
  git(dir, ["commit", "-m", "init"]);
  await writeFile(join(dir, "demo.txt"), "two\n", "utf8");

  const summary = readProjectGitSummary(dir);
  assert.equal(summary.available, true);
  assert.equal(summary.branch, "main");
  assert.equal(summary.dirty, true);
  assert.equal(summary.changedFiles, 1);
  assert.equal(summary.detached, false);
  assert.equal(summary.root, dir);
});

function git(cwd: string, args: string[]): void {
  const result = spawnSync("git", ["-C", cwd, ...args], { encoding: "utf8" });
  if (result.status !== 0) throw new Error(result.stderr || `git ${args.join(" ")} failed`);
}
