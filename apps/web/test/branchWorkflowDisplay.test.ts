import assert from "node:assert/strict";
import test from "node:test";
import type { GitRepositoryStatus, Project } from "@pi-gui/shared";
import { branchWorkflowViewModel } from "../src/domain/branchWorkflowDisplay";

const project: Project = { id: "project-1", name: "Project", cwd: "/tmp/project", lastOpenedAt: 1 };

test("branchWorkflowViewModel formats available status", () => {
  const status: GitRepositoryStatus = {
    projectId: "project-1",
    available: true,
    branch: "feat/branch-visibility",
    defaultBranch: "main",
    changedFiles: 3,
    ahead: 2,
    behind: 1,
    branches: [
      { name: "main", current: false, default: true, mergedIntoDefault: true },
      { name: "feat/branch-visibility", current: true, mergedIntoDefault: false },
    ],
  };
  const model = branchWorkflowViewModel(project, status);
  assert.equal(model.currentBranchLabel, "feat/branch-visibility");
  assert.equal(model.defaultBranchLabel, "main");
  assert.equal(model.compareBranchLabel, "feat/branch-visibility");
  assert.equal(model.changedFilesLabel, "3 changes");
  assert.equal(model.syncLabel, "ahead 2 · behind 1");
  assert.equal(model.branches[0]?.name, "main");
});

test("branchWorkflowViewModel formats unavailable repositories", () => {
  const model = branchWorkflowViewModel(project, { projectId: "project-1", available: false, error: "not a local directory" });
  assert.equal(model.currentBranchLabel, "no git");
  assert.match(model.noGitMessage ?? "", /not a local directory/);
});
