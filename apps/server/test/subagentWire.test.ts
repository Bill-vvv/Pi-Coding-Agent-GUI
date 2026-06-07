import assert from "node:assert/strict";
import test from "node:test";
import type { SubagentRun } from "@pi-gui/shared";
import { subagentRunForWire } from "../src/runtime/subagent/subagentWire.js";

test("subagentRunForWire bounds large output fields without mutating persisted run", () => {
  const hugeFinalText = "x".repeat(20_000);
  const hugeArgs = "a".repeat(8_000);
  const run: SubagentRun = {
    id: "run-1",
    projectId: "project-1",
    parentRuntimeId: "runtime-1",
    parentToolCallId: "tool-call-1",
    parentToolMessageId: "tool-tool-call-1",
    agent: "trellis-check",
    mode: "single",
    status: "succeeded",
    startedAt: 1,
    updatedAt: 2,
    finishedAt: 3,
    finalText: hugeFinalText,
    runs: [
      {
        id: "child-1",
        agent: "trellis-check",
        status: "succeeded",
        prompt: "p".repeat(3_000),
        finalText: hugeFinalText,
        textTail: "t".repeat(10_000),
        tools: [{ id: "tool-1", name: "bash", status: "succeeded", args: hugeArgs }],
      },
    ],
  };

  const wired = subagentRunForWire(run);

  assert.equal(run.finalText, hugeFinalText);
  assert.equal(run.runs[0]?.finalText, hugeFinalText);
  assert.equal(run.runs[0]?.tools?.[0]?.args, hugeArgs);
  assert.ok((wired.finalText?.length ?? 0) < hugeFinalText.length);
  assert.match(wired.finalText ?? "", /truncated/);
  assert.ok((wired.runs[0]?.prompt?.length ?? 0) < 3_000);
  assert.ok((wired.runs[0]?.finalText?.length ?? 0) < hugeFinalText.length);
  assert.ok((wired.runs[0]?.textTail?.length ?? 0) < 10_000);
  assert.ok((wired.runs[0]?.tools?.[0]?.args?.length ?? 0) < hugeArgs.length);
});

test("subagentRunForWire keeps the latest bounded tool traces", () => {
  const run: SubagentRun = {
    id: "run-1",
    projectId: "project-1",
    parentRuntimeId: "runtime-1",
    parentToolCallId: "tool-call-1",
    parentToolMessageId: "tool-tool-call-1",
    agent: "trellis-check",
    mode: "single",
    status: "running",
    startedAt: 1,
    updatedAt: 2,
    runs: [
      {
        id: "child-1",
        agent: "trellis-check",
        status: "running",
        tools: Array.from({ length: 60 }, (_, index) => ({ id: `tool-${index}`, name: "bash", status: "succeeded" as const })),
      },
    ],
  };

  const wired = subagentRunForWire(run);

  assert.equal(wired.runs[0]?.tools?.length, 50);
  assert.equal(wired.runs[0]?.tools?.[0]?.id, "tool-10");
  assert.equal(wired.runs[0]?.tools?.at(-1)?.id, "tool-59");
});
