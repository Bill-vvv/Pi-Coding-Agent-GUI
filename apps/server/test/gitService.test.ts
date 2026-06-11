import assert from "node:assert/strict";
import { spawnSync } from "node:child_process";
import { mkdtemp, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import test from "node:test";
import type { Project } from "@pi-gui/shared";
import { createGitBranch, deleteMergedGitBranch, readGitStatus, switchGitBranch } from "../src/services/gitService.js";

function project(cwd: string): Project {
  return { id: "project-1", name: "Project", cwd, lastOpenedAt: 1 };
}

test("createGitBranch carries dirty work onto the new branch", async (t) => {
  const dir = await initRepo(t);
  await writeFile(join(dir, "demo.txt"), "dirty\n", "utf8");
  const status = createGitBranch(project(dir), "feat/test");
  assert.equal(status.branch, "feat/test");
  assert.equal(status.dirty, true);
});

test("createGitBranch creates and checks out a new local branch", async (t) => {
  const dir = await initRepo(t);
  const status = createGitBranch(project(dir), "feat/test");
  assert.equal(status.branch, "feat/test");
  assert.equal(status.branches?.find((branch) => branch.name === "feat/test")?.current, true);
});

test("switchGitBranch changes the checked out branch", async (t) => {
  const dir = await initRepo(t);
  git(dir, ["switch", "-c", "feat/test"]);
  git(dir, ["switch", "main"]);
  const status = switchGitBranch(project(dir), "feat/test");
  assert.equal(status.branch, "feat/test");
});

test("deleteMergedGitBranch deletes merged local branches only", async (t) => {
  const dir = await initRepo(t);
  git(dir, ["switch", "-c", "feat/test"]);
  await writeFile(join(dir, "feature.txt"), "feature\n", "utf8");
  git(dir, ["add", "feature.txt"]);
  git(dir, ["commit", "-m", "feature"]);
  git(dir, ["switch", "main"]);
  git(dir, ["merge", "--ff-only", "feat/test"]);

  const beforeDelete = readGitStatus(project(dir));
  assert.equal(beforeDelete.branches?.find((branch) => branch.name === "feat/test")?.mergedIntoDefault, true);

  const afterDelete = deleteMergedGitBranch(project(dir), "feat/test");
  assert.equal(afterDelete.branches?.some((branch) => branch.name === "feat/test"), false);
});

test("deleteMergedGitBranch refuses deleting the current branch", async (t) => {
  const dir = await initRepo(t);
  assert.throws(() => deleteMergedGitBranch(project(dir), "main"), /currently checked out/);
});

async function initRepo(t: test.TestContext): Promise<string> {
  const dir = await mkdtemp(join(tmpdir(), "pi-gui-git-service-"));
  const remoteDir = await mkdtemp(join(tmpdir(), "pi-gui-git-remote-"));
  t.after(async () => {
    await rm(dir, { recursive: true, force: true });
    await rm(remoteDir, { recursive: true, force: true });
  });
  git(dir, ["init", "-b", "main"]);
  git(dir, ["config", "user.email", "test@example.com"]);
  git(dir, ["config", "user.name", "Pi GUI Test"]);
  await writeFile(join(dir, "demo.txt"), "one\n", "utf8");
  git(dir, ["add", "demo.txt"]);
  git(dir, ["commit", "-m", "init"]);
  git(remoteDir, ["init", "--bare"]);
  git(dir, ["remote", "add", "origin", remoteDir]);
  git(dir, ["push", "-u", "origin", "main"]);
  return dir;
}

function git(cwd: string, args: string[]): void {
  const result = spawnSync("git", ["-C", cwd, ...args], { encoding: "utf8" });
  if (result.status !== 0) throw new Error(result.stderr || `git ${args.join(" ")} failed`);
}
