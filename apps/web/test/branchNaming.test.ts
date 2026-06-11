import assert from "node:assert/strict";
import test from "node:test";
import { generateBranchName, slugifyBranchTitle } from "../src/domain/branchNaming";

test("slugifyBranchTitle normalizes simple titles", () => {
  assert.equal(slugifyBranchTitle(" Branch Visibility "), "branch-visibility");
  assert.equal(slugifyBranchTitle("Fix: PR target guidance!!"), "fix-pr-target-guidance");
});

test("generateBranchName falls back when title has no ascii slug", () => {
  assert.equal(generateBranchName("feat", "功能优化"), "feat/workbench-change");
});
