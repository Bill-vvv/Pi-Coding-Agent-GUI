import type { ConversationContextUsage, ConversationMessage, Runtime, RuntimeQueue, SubagentRun } from "@pi-gui/shared";

export type PiPetMood = "sleeping" | "idle" | "starting" | "thinking" | "tool" | "subagents" | "waiting" | "queued" | "context" | "background" | "recovering" | "ready" | "error";
export type PiPetTone = "neutral" | "active" | "attention" | "success" | "danger";
export type DesktopPetStatus = "idle" | "running" | "waiting" | "review" | "done" | "failed" | "message";
export type CodexPetAnimationName = "idle" | "running-right" | "running-left" | "waving" | "jumping" | "failed" | "waiting" | "running" | "review";

export type PiPetSignal = {
  label: string;
  value: string;
  tone: PiPetTone;
};

export type PiPetActivity = {
  text: string;
  tone: PiPetTone;
};

export type PiPetDisplay = {
  mood: PiPetMood;
  tone: PiPetTone;
  title: string;
  detail: string;
  badges: string[];
  signals: PiPetSignal[];
  activities: PiPetActivity[];
  satelliteCount: number;
  activeSubagentRunId?: string;
  canOpenRuntimeLogs: boolean;
};

export type PiPetDisplayInput = {
  activeRuntime?: Runtime;
  activeRuntimeIsBusy: boolean;
  messages: ConversationMessage[];
  contextUsage?: ConversationContextUsage;
  queue?: RuntimeQueue;
  waitingForInput: boolean;
  recoverableRuntimeInterruption?: boolean;
  subagentRuns: SubagentRun[];
  backgroundBusyCount?: number;
  backgroundAttentionCount?: number;
};

export type PiPetBackgroundActivity = {
  busy: number;
  attention: number;
  attentionRuntimeId?: string;
  attentionProjectId?: string;
  busyRuntimeId?: string;
  busyProjectId?: string;
};

export function derivePiPetDisplay(input: PiPetDisplayInput): PiPetDisplay {
  const badges = petBadges(input);
  const runtime = input.activeRuntime;
  if (!runtime || runtime.archivedAt) {
    const queuedCount = queueSize(input.queue);
    const signals = petSignals(input, { queuedCount });
    const activities = petActivities(input, { queuedCount });
    const satelliteCount = petSatelliteCount(input, { queuedCount });
    const backgroundAttention = input.backgroundAttentionCount ?? 0;
    const backgroundBusy = input.backgroundBusyCount ?? 0;
    if (backgroundAttention > 0 || backgroundBusy > 0) {
      return {
        mood: "background",
        tone: backgroundAttention > 0 ? "attention" : "active",
        title: backgroundAttention > 0 ? "后台 Pi 需要关注" : "后台 Pi 正在运行",
        detail: backgroundDetail(backgroundBusy, backgroundAttention),
        badges,
        signals,
        activities,
        satelliteCount,
        canOpenRuntimeLogs: false,
      };
    }
    return {
      mood: "sleeping",
      tone: "neutral",
      title: "Pi PET 休息中",
      detail: "启动或选择一个 runtime 后，我会同步显示 Pi 的状态。",
      badges,
      signals,
      activities,
      satelliteCount,
      canOpenRuntimeLogs: false,
    };
  }

  const runningSubagent = input.subagentRuns.find((run) => run.status === "running" || run.status === "pending");
  const latestMessage = latestVisibleMessage(input.messages);
  const streamingTool = latestStreamingTool(input.messages);
  const queuedCount = queueSize(input.queue);
  const signals = petSignals(input, { runtime, runningSubagent, streamingTool, queuedCount });
  const activities = petActivities(input, { runtime, runningSubagent, streamingTool, latestMessage, queuedCount });
  const satelliteCount = petSatelliteCount(input, { runningSubagent, streamingTool, queuedCount });

  if (runtime.status === "crashed") {
    return {
      mood: input.recoverableRuntimeInterruption ? "recovering" : "error",
      tone: input.recoverableRuntimeInterruption ? "attention" : "danger",
      title: input.recoverableRuntimeInterruption ? "Pi 可恢复中断" : "Pi 运行中断",
      detail: input.recoverableRuntimeInterruption ? "当前进程已断开，但 session 仍可恢复；可以打开日志或恢复对话。" : "当前 runtime 已崩溃，可以打开日志查看原因。",
      badges,
      signals,
      activities,
      satelliteCount,
      canOpenRuntimeLogs: true,
    };
  }

  if (input.waitingForInput) {
    return {
      mood: "waiting",
      tone: "attention",
      title: "Pi 在等你决定",
      detail: "有交互请求需要回复；完成后 Pi 会继续执行。",
      badges,
      signals,
      activities,
      satelliteCount,
      canOpenRuntimeLogs: false,
    };
  }

  if (runtime.status === "starting") {
    return {
      mood: "starting",
      tone: "active",
      title: "Pi 正在苏醒",
      detail: "Runtime 正在启动，稍后就可以接收任务。",
      badges,
      signals,
      activities,
      satelliteCount,
      canOpenRuntimeLogs: true,
    };
  }

  if (runningSubagent) {
    return {
      mood: "subagents",
      tone: "active",
      title: "Pi 分身在工作",
      detail: subagentDetail(runningSubagent, input.subagentRuns),
      badges,
      signals,
      activities,
      satelliteCount,
      activeSubagentRunId: runningSubagent.id,
      canOpenRuntimeLogs: false,
    };
  }

  if (streamingTool) {
    return {
      mood: "tool",
      tone: "active",
      title: "Pi 正在调用工具",
      detail: safeToolDetail(streamingTool),
      badges,
      signals,
      activities,
      satelliteCount,
      canOpenRuntimeLogs: false,
    };
  }

  if (input.activeRuntimeIsBusy) {
    return {
      mood: "thinking",
      tone: "active",
      title: "Pi 正在思考",
      detail: "我会跟随真实 runtime 事件更新状态。",
      badges,
      signals,
      activities,
      satelliteCount,
      canOpenRuntimeLogs: false,
    };
  }

  if (runtime.status === "stopped") {
    return {
      mood: "idle",
      tone: "neutral",
      title: "Pi 已停止",
      detail: "选择恢复或启动 runtime 后继续。",
      badges,
      signals,
      activities,
      satelliteCount,
      canOpenRuntimeLogs: true,
    };
  }

  if (queuedCount > 0) {
    return {
      mood: "queued",
      tone: "attention",
      title: "Pi 背包里有排队任务",
      detail: `${queuedCount} 条消息在队列中，当前回复结束后会继续处理。`,
      badges,
      signals,
      activities,
      satelliteCount,
      canOpenRuntimeLogs: false,
    };
  }

  const contextPercent = numericValue(input.contextUsage?.percent);
  if (contextPercent !== undefined && contextPercent >= 90) {
    return {
      mood: "context",
      tone: "attention",
      title: "Pi 上下文高压",
      detail: "当前会话接近上下文上限，建议整理或压缩后继续。",
      badges,
      signals,
      activities,
      satelliteCount,
      canOpenRuntimeLogs: false,
    };
  }

  if (latestMessage?.role === "error") {
    return {
      mood: "error",
      tone: "danger",
      title: "Pi 遇到错误",
      detail: "最近一次响应包含错误信息，可以查看对话或日志。",
      badges,
      signals,
      activities,
      satelliteCount,
      canOpenRuntimeLogs: true,
    };
  }

  const backgroundAttention = input.backgroundAttentionCount ?? 0;
  if (backgroundAttention > 0) {
    return {
      mood: "background",
      tone: "attention",
      title: "后台 Pi 需要关注",
      detail: backgroundDetail(input.backgroundBusyCount ?? 0, backgroundAttention),
      badges,
      signals,
      activities,
      satelliteCount,
      canOpenRuntimeLogs: false,
    };
  }

  if (latestMessage && (latestMessage.role === "assistant" || latestMessage.role === "tool" || latestMessage.role === "log")) {
    return {
      mood: "ready",
      tone: "success",
      title: "Pi 已完成这一轮",
      detail: "当前 runtime 空闲，可以继续输入下一步。",
      badges,
      signals,
      activities,
      satelliteCount,
      canOpenRuntimeLogs: false,
    };
  }

  return {
    mood: "idle",
    tone: "neutral",
    title: "Pi 待命中",
    detail: "Runtime 已连接，正在等待你的下一条消息。",
    badges,
    signals,
    activities,
    satelliteCount,
    canOpenRuntimeLogs: false,
  };
}

export function desktopPetStatusFromMood(mood: PiPetMood): DesktopPetStatus {
  switch (mood) {
    case "starting":
    case "thinking":
    case "tool":
    case "subagents":
    case "background":
      return "running";
    case "waiting":
    case "queued":
      return "waiting";
    case "context":
    case "recovering":
      return "review";
    case "ready":
      return "done";
    case "error":
      return "failed";
    case "sleeping":
    case "idle":
      return "idle";
  }
}

export function codexPetAnimationFromMood(mood: PiPetMood): CodexPetAnimationName {
  switch (mood) {
    case "starting":
    case "thinking":
    case "tool":
    case "subagents":
    case "background":
      return "running";
    case "waiting":
    case "queued":
      return "waiting";
    case "context":
    case "recovering":
      return "review";
    case "ready":
      return "waving";
    case "error":
      return "failed";
    case "sleeping":
    case "idle":
      return "idle";
  }
}

export function countBackgroundPiPetActivity(runtimes: Runtime[], busyByRuntime: Record<string, boolean>, activeRuntimeId?: string): PiPetBackgroundActivity {
  const activity: PiPetBackgroundActivity = { busy: 0, attention: 0 };
  for (const runtime of runtimes) {
    if (runtime.archivedAt || runtime.id === activeRuntimeId) continue;
    if (runtime.status === "crashed") {
      activity.attention += 1;
      activity.attentionRuntimeId ??= runtime.id;
      activity.attentionProjectId ??= runtime.projectId;
      continue;
    }
    if (runtime.status === "starting" || busyByRuntime[runtime.id] === true) {
      activity.busy += 1;
      activity.busyRuntimeId ??= runtime.id;
      activity.busyProjectId ??= runtime.projectId;
    }
  }
  return activity;
}

function petSatelliteCount(
  input: PiPetDisplayInput,
  derived: { runningSubagent?: SubagentRun; streamingTool?: ConversationMessage; queuedCount?: number },
): number {
  let count = 0;
  if (derived.runningSubagent) count += Math.max(1, Math.min(2, activeSubagentCount(input.subagentRuns)));
  if (derived.streamingTool) count += 1;
  if ((derived.queuedCount ?? queueSize(input.queue)) > 0) count += 1;
  if ((input.backgroundBusyCount ?? 0) > 0) count += 1;
  if ((input.backgroundAttentionCount ?? 0) > 0) count += 1;
  return Math.max(0, Math.min(3, count));
}

function petSignals(
  input: PiPetDisplayInput,
  derived: { runtime?: Runtime; runningSubagent?: SubagentRun; streamingTool?: ConversationMessage; queuedCount?: number },
): PiPetSignal[] {
  const signals: PiPetSignal[] = [];
  const runtime = derived.runtime;
  if (runtime) {
    signals.push({
      label: "Runtime",
      value: input.recoverableRuntimeInterruption && runtime.status === "crashed" ? "可恢复" : runtimeStatusLabel(runtime.status),
      tone: runtime.status === "crashed" ? (input.recoverableRuntimeInterruption ? "attention" : "danger") : runtime.status === "running" ? "success" : runtime.status === "starting" ? "active" : "neutral",
    });
  }

  if (input.waitingForInput) signals.push({ label: "输入", value: "等待用户决定", tone: "attention" });
  if (derived.runningSubagent) signals.push({ label: "Subagent", value: subagentSignalValue(derived.runningSubagent, input.subagentRuns), tone: "active" });
  if (derived.streamingTool) signals.push({ label: "Tool", value: toolSignalValue(derived.streamingTool), tone: "active" });
  else if (input.activeRuntimeIsBusy) signals.push({ label: "Agent", value: "思考/生成中", tone: "active" });

  const queuedCount = derived.queuedCount ?? queueSize(input.queue);
  if (queuedCount > 0) signals.push({ label: "Queue", value: `${queuedCount} 条待处理`, tone: "attention" });

  const contextPercent = numericValue(input.contextUsage?.percent);
  if (contextPercent !== undefined) {
    signals.push({ label: "Context", value: `${Math.round(contextPercent)}%`, tone: contextPercent >= 90 ? "danger" : contextPercent >= 70 ? "attention" : "neutral" });
  }

  const backgroundBusy = input.backgroundBusyCount ?? 0;
  const backgroundAttention = input.backgroundAttentionCount ?? 0;
  if (backgroundBusy > 0 || backgroundAttention > 0) {
    const parts = [backgroundBusy > 0 ? `${backgroundBusy} 忙碌` : undefined, backgroundAttention > 0 ? `${backgroundAttention} 需关注` : undefined].filter(Boolean);
    signals.push({ label: "后台", value: parts.join(" · "), tone: backgroundAttention > 0 ? "attention" : "active" });
  }

  return signals.slice(0, 5);
}

function petActivities(
  input: PiPetDisplayInput,
  derived: { runtime?: Runtime; runningSubagent?: SubagentRun; streamingTool?: ConversationMessage; latestMessage?: ConversationMessage; queuedCount?: number },
): PiPetActivity[] {
  const activities: PiPetActivity[] = [];
  const runtime = derived.runtime;
  if (!runtime || runtime.archivedAt) activities.push({ text: "等待 runtime 启动", tone: "neutral" });
  else if (runtime.status === "crashed") {
    activities.push(input.recoverableRuntimeInterruption ? { text: "Runtime 中断但 session 可恢复", tone: "attention" } : { text: "Runtime 崩溃，需要查看日志", tone: "danger" });
  }
  else if (runtime.status === "starting") activities.push({ text: "Runtime 正在启动", tone: "active" });

  if (input.waitingForInput) activities.push({ text: "交互表单正在等待你的回复", tone: "attention" });
  if (derived.runningSubagent) activities.push({ text: `Subagent 工作中：${subagentSignalValue(derived.runningSubagent, input.subagentRuns)}`, tone: "active" });
  if (derived.streamingTool) activities.push({ text: `工具运行中：${toolSignalValue(derived.streamingTool)}`, tone: "active" });
  else if (input.activeRuntimeIsBusy) activities.push({ text: "Agent 正在思考或生成回复", tone: "active" });

  const queuedCount = derived.queuedCount ?? queueSize(input.queue);
  if (queuedCount > 0) activities.push({ text: `${queuedCount} 条消息在队列中`, tone: "attention" });

  const contextPercent = numericValue(input.contextUsage?.percent);
  if (contextPercent !== undefined && contextPercent >= 70) {
    activities.push({ text: `上下文占用 ${Math.round(contextPercent)}%`, tone: contextPercent >= 90 ? "danger" : "attention" });
  }

  const backgroundBusy = input.backgroundBusyCount ?? 0;
  const backgroundAttention = input.backgroundAttentionCount ?? 0;
  if (backgroundBusy > 0 || backgroundAttention > 0) {
    const parts = [backgroundBusy > 0 ? `${backgroundBusy} 个后台 runtime 忙碌` : undefined, backgroundAttention > 0 ? `${backgroundAttention} 个后台 runtime 需关注` : undefined].filter(Boolean);
    activities.push({ text: parts.join("，"), tone: backgroundAttention > 0 ? "attention" : "active" });
  }

  const latest = derived.latestMessage;
  if (latest?.role === "error") activities.push({ text: "最近一条消息是错误", tone: "danger" });
  else if (!input.activeRuntimeIsBusy && latest && (latest.role === "assistant" || latest.role === "tool" || latest.role === "log")) {
    activities.push({ text: "最近一轮已有结果", tone: "success" });
  }

  return dedupeActivities(activities).slice(0, 4);
}

function backgroundDetail(backgroundBusy: number, backgroundAttention: number): string {
  const parts = [
    backgroundAttention > 0 ? `${backgroundAttention} 个后台 runtime 需要关注` : undefined,
    backgroundBusy > 0 ? `${backgroundBusy} 个后台 runtime 正在运行` : undefined,
  ].filter(Boolean);
  return `${parts.join("，")}；PET 会保持当前对话不被打断。`;
}

function dedupeActivities(activities: PiPetActivity[]): PiPetActivity[] {
  const seen = new Set<string>();
  return activities.filter((activity) => {
    if (seen.has(activity.text)) return false;
    seen.add(activity.text);
    return true;
  });
}

function petBadges(input: PiPetDisplayInput): string[] {
  const badges: string[] = [];
  const contextPercent = numericValue(input.contextUsage?.percent);
  if (contextPercent !== undefined && contextPercent >= 90) badges.push("上下文高压");
  else if (contextPercent !== undefined && contextPercent >= 70) badges.push("上下文偏高");

  const backgroundBusy = input.backgroundBusyCount ?? 0;
  if (backgroundBusy > 0) badges.push(`后台 ${backgroundBusy} 个运行中`);

  const backgroundAttention = input.backgroundAttentionCount ?? 0;
  if (backgroundAttention > 0) badges.push(`后台 ${backgroundAttention} 个需关注`);

  return badges;
}

function latestVisibleMessage(messages: ConversationMessage[]): ConversationMessage | undefined {
  for (let index = messages.length - 1; index >= 0; index -= 1) {
    const message = messages[index];
    if (message && (message.text.trim() || message.thinking?.trim() || message.title?.trim())) return message;
  }
  return undefined;
}

function latestStreamingTool(messages: ConversationMessage[]): ConversationMessage | undefined {
  for (let index = messages.length - 1; index >= 0; index -= 1) {
    const message = messages[index];
    if (message?.role === "tool" && message.isStreaming === true) return message;
  }
  return undefined;
}

function queueSize(queue: RuntimeQueue | undefined): number {
  return (queue?.steering.length ?? 0) + (queue?.followUp.length ?? 0);
}

function runtimeStatusLabel(status: Runtime["status"]): string {
  switch (status) {
    case "running":
      return "已连接";
    case "starting":
      return "启动中";
    case "crashed":
      return "已崩溃";
    case "stopped":
      return "已停止";
  }
}

function subagentDetail(activeRun: SubagentRun, runs: SubagentRun[]): string {
  const activeCount = activeSubagentCount(runs);
  const agent = activeRun.agent.trim() || "subagent";
  return activeCount > 1 ? `${activeCount} 个 subagent 正在协作，当前焦点：${agent}。` : `${agent} 正在处理子任务。`;
}

function subagentSignalValue(activeRun: SubagentRun, runs: SubagentRun[]): string {
  const activeCount = activeSubagentCount(runs);
  const agent = activeRun.agent.trim() || "subagent";
  return activeCount > 1 ? `${activeCount} 个 · ${agent}` : agent;
}

function activeSubagentCount(runs: SubagentRun[]): number {
  return runs.filter((run) => run.status === "running" || run.status === "pending").length;
}

function safeToolDetail(message: ConversationMessage): string {
  const title = message.title?.trim();
  if (!title) return "工具调用正在进行，结果会回到对话流。";
  const firstWord = title.split(/\s+/)[0]?.trim();
  return firstWord ? `${firstWord} 正在运行；为避免泄露细节，PET 只显示工具状态。` : "工具调用正在进行，结果会回到对话流。";
}

function toolSignalValue(message: ConversationMessage): string {
  return message.title?.trim().split(/\s+/)[0]?.trim() || "运行中";
}

function numericValue(value: number | null | undefined): number | undefined {
  return typeof value === "number" && Number.isFinite(value) ? value : undefined;
}
