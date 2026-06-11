import assert from "node:assert/strict";
import test from "node:test";
import type { Project } from "@pi-gui/shared";
import { projectGitChipModel } from "../src/domain/projectGitDisplay";

function project(git?: Project["git"]): Project {
  return { id: "project-1", name: "Project", cwd: "/tmp/project", lastOpenedAt: 1, git };
}

test("projectGitChipModel shows no git fallback", () => {
  const model = projectGitChipModel(project());
  assert.equal(model.label, "no git");
  assert.equal(model.tone, "neutral");
});

test("projectGitChipModel formats branch markers", () => {
  const model = projectGitChipModel(project({
    available: true,
    branch: "feat/branch-visibility",
    dirty: true,
    ahead: 2,
    behind: 1,
    changedFiles: 3,
    defaultBranch: "main",
    isDefaultBranch: false,
  }));
  assert.equal(model.label, "feat/branch-visibility ● ↑2 ↓1");
  assert.equal(model.tone, "working");
  assert.match(model.title, /Default: main/);
  assert.match(model.title, /3 changed/);
});

test("projectGitChipModel formats detached head", () => {
  const model = projectGitChipModel(project({
    available: true,
    detached: true,
    head: "1234abcd",
    changedFiles: 0,
  }));
  assert.equal(model.label, "detached 1234abcd");
  assert.equal(model.tone, "warning");
});
