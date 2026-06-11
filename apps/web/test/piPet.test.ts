import assert from "node:assert/strict";
import test from "node:test";
import type { ConversationMessage, Runtime, SubagentRun } from "@pi-gui/shared";
import { countBackgroundPiPetActivity, derivePiPetDisplay } from "../src/domain/piPet";

function runtime(overrides: Partial<Runtime> = {}): Runtime {
  return {
    id: "runtime-1",
    projectId: "project-1",
    cwd: "/repo",
    status: "running",
    ...overrides,
  };
}

function message(overrides: Partial<ConversationMessage> = {}): ConversationMessage {
  return {
    id: "message-1",
    runtimeId: "runtime-1",
    projectId: "project-1",
    role: "assistant",
    text: "done",
    updatedAt: 1,
    ...overrides,
  };
}

function subagentRun(overrides: Partial<SubagentRun> = {}): SubagentRun {
  return {
    id: "subagent-1",
    projectId: "project-1",
    parentRuntimeId: "runtime-1",
    parentToolCallId: "tool-1",
    parentToolMessageId: "tool-1",
    agent: "trellis-check",
    mode: "single",
    status: "running",
    startedAt: 1,
    updatedAt: 1,
    runs: [],
    ...overrides,
  };
}

test("derivePiPetDisplay prioritizes waiting input over busy state", () => {
  const display = derivePiPetDisplay({
    activeRuntime: runtime(),
    activeRuntimeIsBusy: true,
    messages: [message({ role: "tool", title: "read 运行中", text: "", isStreaming: true })],
    waitingForInput: true,
    subagentRuns: [subagentRun()],
  });

  assert.equal(display.mood, "waiting");
  assert.equal(display.tone, "attention");
  assert.deepEqual(display.signals.map((signal) => signal.label), ["Runtime", "输入", "Subagent", "Tool"]);
  assert.deepEqual(display.activities.map((activity) => activity.text), [
    "交互表单正在等待你的回复",
    "Subagent 工作中：trellis-check",
    "工具运行中：read",
  ]);
});

test("derivePiPetDisplay surfaces active subagent before generic tool work", () => {
  const display = derivePiPetDisplay({
    activeRuntime: runtime(),
    activeRuntimeIsBusy: true,
    messages: [message({ role: "tool", title: "agent_run 运行中", text: "", isStreaming: true })],
    waitingForInput: false,
    subagentRuns: [subagentRun({ id: "run-active" })],
  });

  assert.equal(display.mood, "subagents");
  assert.equal(display.activeSubagentRunId, "run-active");
  assert.equal(display.satelliteCount, 2);
});

test("derivePiPetDisplay adds safe context/background badges and native signals", () => {
  const display = derivePiPetDisplay({
    activeRuntime: runtime(),
    activeRuntimeIsBusy: false,
    messages: [],
    contextUsage: { percent: 91 },
    waitingForInput: false,
    subagentRuns: [],
    backgroundBusyCount: 2,
    backgroundAttentionCount: 1,
  });

  assert.equal(display.satelliteCount, 2);
  assert.deepEqual(display.badges, ["上下文高压", "后台 2 个运行中", "后台 1 个需关注"]);
  assert.deepEqual(display.signals.map((signal) => `${signal.label}:${signal.value}`), ["Runtime:已连接", "Context:91%", "后台:2 忙碌 · 1 需关注"]);
  assert.deepEqual(display.activities.map((activity) => activity.text), ["上下文占用 91%", "2 个后台 runtime 忙碌，1 个后台 runtime 需关注"]);
});

test("derivePiPetDisplay promotes high context pressure when idle", () => {
  const display = derivePiPetDisplay({
    activeRuntime: runtime(),
    activeRuntimeIsBusy: false,
    messages: [message({ role: "assistant", text: "done" })],
    contextUsage: { percent: 95 },
    waitingForInput: false,
    subagentRuns: [],
  });

  assert.equal(display.mood, "context");
  assert.equal(display.tone, "attention");
  assert.equal(display.title, "Pi 上下文高压");
  assert.ok(display.badges.includes("上下文高压"));
});

test("derivePiPetDisplay surfaces background attention when active runtime is otherwise idle", () => {
  const display = derivePiPetDisplay({
    activeRuntime: runtime(),
    activeRuntimeIsBusy: false,
    messages: [message({ role: "assistant", text: "done" })],
    waitingForInput: false,
    subagentRuns: [],
    backgroundBusyCount: 1,
    backgroundAttentionCount: 2,
  });

  assert.equal(display.mood, "background");
  assert.equal(display.tone, "attention");
  assert.equal(display.title, "后台 Pi 需要关注");
  assert.match(display.detail, /2 个后台 runtime 需要关注/);
  assert.equal(display.satelliteCount, 2);
});

test("derivePiPetDisplay stays awake for background activity without an active runtime", () => {
  const display = derivePiPetDisplay({
    activeRuntime: undefined,
    activeRuntimeIsBusy: false,
    messages: [],
    waitingForInput: false,
    subagentRuns: [],
    backgroundBusyCount: 1,
  });

  assert.equal(display.mood, "background");
  assert.equal(display.tone, "active");
  assert.equal(display.title, "后台 Pi 正在运行");
  assert.match(display.detail, /1 个后台 runtime 正在运行/);
});

test("derivePiPetDisplay labels recoverable runtime interruptions without danger tone", () => {
  const display = derivePiPetDisplay({
    activeRuntime: runtime({ status: "crashed", sessionId: "session-1" }),
    activeRuntimeIsBusy: false,
    messages: [],
    waitingForInput: false,
    recoverableRuntimeInterruption: true,
    subagentRuns: [],
  });

  assert.equal(display.mood, "recovering");
  assert.equal(display.tone, "attention");
  assert.equal(display.title, "Pi 可恢复中断");
  assert.equal(display.signals[0]?.value, "可恢复");
  assert.equal(display.activities[0]?.text, "Runtime 中断但 session 可恢复");
});

test("derivePiPetDisplay does not present stopped runtimes as ready for input", () => {
  const display = derivePiPetDisplay({
    activeRuntime: runtime({ status: "stopped" }),
    activeRuntimeIsBusy: false,
    messages: [message({ role: "assistant", text: "done" })],
    waitingForInput: false,
    subagentRuns: [],
  });

  assert.equal(display.mood, "idle");
  assert.equal(display.title, "Pi 已停止");
  assert.equal(display.canOpenRuntimeLogs, true);
  assert.doesNotMatch(display.detail, /继续输入/);
});

test("countBackgroundPiPetActivity excludes active and archived runtimes", () => {
  const counts = countBackgroundPiPetActivity(
    [
      runtime({ id: "active" }),
      runtime({ id: "busy" }),
      runtime({ id: "starting", status: "starting" }),
      runtime({ id: "crashed", status: "crashed" }),
      runtime({ id: "archived", archivedAt: 10, status: "crashed" }),
    ],
    { active: true, busy: true },
    "active",
  );

  assert.deepEqual(counts, {
    busy: 2,
    attention: 1,
    attentionRuntimeId: "crashed",
    attentionProjectId: "project-1",
    busyRuntimeId: "busy",
    busyProjectId: "project-1",
  });
});
