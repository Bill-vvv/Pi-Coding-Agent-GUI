import assert from "node:assert/strict";
import test from "node:test";
import type { SubagentRun } from "@pi-gui/shared";
import { buildSubagentLiveConversationMessages, subagentRunPreview } from "../src/domain/subagents";

function subagentRun(overrides: Partial<SubagentRun> = {}): SubagentRun {
  return {
    id: "runtime-1:subagent-1",
    projectId: "project-1",
    parentRuntimeId: "runtime-1",
    parentToolCallId: "subagent-1",
    parentToolMessageId: "tool-subagent-1",
    agent: "review-agent",
    mode: "single",
    status: "running",
    startedAt: 100,
    updatedAt: 200,
    runs: [
      {
        id: "review-agent-1",
        agent: "review-agent",
        status: "running",
        startedAt: 110,
        thinkingTail: "checking the implementation",
        tools: [{ id: "tool-1", name: "read", args: '{"path":"apps/web/src/App.tsx"}', status: "succeeded", startedAt: 120, finishedAt: 130 }],
      },
    ],
    ...overrides,
  };
}

test("buildSubagentLiveConversationMessages emits streaming thinking and tools before session file exists", () => {
  const run = subagentRun();
  const messages = buildSubagentLiveConversationMessages(run, run.runs[0]);

  assert.equal(messages.length, 2);
  assert.equal(messages[0]?.role, "tool");
  assert.equal(messages[0]?.isStreaming, false);
  assert.equal(messages[1]?.role, "assistant");
  assert.equal(messages[1]?.thinking, "checking the implementation");
  assert.equal(messages[1]?.isStreaming, true);
});

test("subagentRunPreview uses live thinking as non-final preview", () => {
  assert.equal(subagentRunPreview(subagentRun(), 80), "思考中：checking the implementation");
});
