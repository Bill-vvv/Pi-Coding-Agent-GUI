import { isSerializedToolCallText, stripSerializedToolCallsFromText, type ConversationMessage } from "@pi-gui/shared";

// Conversation display modes are intentionally centralized so future modes
// (for example detailed/raw) can switch rendering policy without changing ChatView.
export type ConversationDisplayMode = "normal";
export type ConversationMessageDisplayKind = "hidden" | "markdown" | "plain" | "tool";
export type RenderableConversationMessageDisplayKind = "markdown" | "plain";
export type ToolDisplayStatus = "running" | "completed" | "failed";

export type ToolDisplayModel = {
  name: string;
  status: ToolDisplayStatus;
  statusLabel: string;
  summary: string;
  detailLabel: string;
  detail: string;
  updatedAt: number;
};

export type ThinkingDisplayModel = {
  id: string;
  text: string;
  isStreaming: boolean;
  updatedAt: number;
};

export type ToolNameCount = {
  name: string;
  count: number;
};

export type ProcessCurrentDisplayModel = {
  kind: "thinking" | "tool";
  title: string;
  status: ToolDisplayStatus;
  statusLabel: string;
  content: string;
};

export type ToolGroupDisplayModel = {
  title: string;
  status: ToolDisplayStatus;
  statusLabel: string;
  summary: string;
  thinkingCount: number;
  toolCount: number;
  runningCount: number;
  failedCount: number;
  completedCount: number;
  toolNameCounts: ToolNameCount[];
  thinking: ThinkingDisplayModel[];
  tools: ToolDisplayModel[];
  current?: ProcessCurrentDisplayModel;
};

export type ConversationDisplayBlock =
  | {
      type: "message";
      id: string;
      message: ConversationMessage;
      displayKind: RenderableConversationMessageDisplayKind;
      isStreaming: boolean;
    }
  | {
      type: "tool_group";
      id: string;
      tools: ConversationMessage[];
      thinkingMessages: ConversationMessage[];
      model: ToolGroupDisplayModel;
      isStreaming: boolean;
    };

export type ConversationDisplayOptions = {
  activeRuntimeIsBusy?: boolean;
};

const TOOL_STATUS_SUFFIX_RE = /\s+(运行中|完成|失败)$/;
const TOOL_SUMMARY_MAX_CHARS = 150;
const TOOL_SUMMARY_LINE_MAX_CHARS = 110;
const TOOL_GROUP_SUMMARY_MAX_ITEMS = 4;
const PROCESS_PREVIEW_MAX_CHARS = 1600;
const PROCESS_PREVIEW_MAX_LINES = 18;

export function buildConversationDisplayBlocks(
  messages: ConversationMessage[],
  mode: ConversationDisplayMode = "normal",
  options: ConversationDisplayOptions = {},
): ConversationDisplayBlock[] {
  const blocks: ConversationDisplayBlock[] = [];
  let segmentBlocks: ConversationDisplayBlock[] = [];
  let segmentTools: ConversationMessage[] = [];
  let segmentThinkingMessages: ConversationMessage[] = [];
  let segmentUserMessageId = "root";
  let processInsertIndex: number | undefined;

  function flushSegment(forceRunning = false) {
    if (segmentTools.length > 0 || segmentThinkingMessages.length > 0) {
      const insertAt = processInsertIndex ?? segmentBlocks.length;
      segmentBlocks.splice(insertAt, 0, toolGroupBlock(segmentTools, segmentThinkingMessages, segmentUserMessageId, forceRunning));
    }

    blocks.push(...segmentBlocks);
    segmentBlocks = [];
    segmentTools = [];
    segmentThinkingMessages = [];
    segmentUserMessageId = "root";
    processInsertIndex = undefined;
  }

  for (const message of messages) {
    if (mode === "normal" && message.role === "assistant" && message.thinking?.trim()) {
      if (processInsertIndex === undefined) processInsertIndex = segmentBlocks.length;
      segmentThinkingMessages.push(message);
    }

    const displayMessage = conversationMessageForDisplay(message, mode);
    if (!displayMessage) continue;

    const displayKind = conversationMessageDisplayKind(displayMessage, mode);
    if (displayKind === "hidden") continue;

    if (displayMessage.role === "user") {
      flushSegment();
      segmentUserMessageId = displayMessage.id;
      segmentBlocks.push(messageBlock(displayMessage, "markdown"));
      continue;
    }

    if (displayKind === "tool") {
      if (processInsertIndex === undefined) processInsertIndex = segmentBlocks.length;
      segmentTools.push(displayMessage);
      continue;
    }

    segmentBlocks.push(messageBlock(displayMessage, displayKind));
  }

  flushSegment(options.activeRuntimeIsBusy === true);
  return blocks;
}

export function conversationMessageDisplayKind(
  message: ConversationMessage,
  mode: ConversationDisplayMode = "normal",
): ConversationMessageDisplayKind {
  if (mode === "normal" && isLeakedToolCallMessage(message)) return "hidden";
  if (mode === "normal" && isToolDisplayMessage(message)) return "tool";
  if (message.role === "assistant" || message.role === "user") return "markdown";
  return "plain";
}

export function isToolDisplayMessage(message: ConversationMessage): boolean {
  return message.role === "tool" || (message.role === "error" && message.id.startsWith("tool-"));
}

export function isLeakedToolCallMessage(message: ConversationMessage): boolean {
  return message.role === "assistant" && isSerializedToolCallText(message.text);
}

function conversationMessageForDisplay(message: ConversationMessage, mode: ConversationDisplayMode): ConversationMessage | undefined {
  if (mode !== "normal" || message.role !== "assistant") return message;

  const text = stripSerializedToolCallsFromText(message.text);
  if (!text) return undefined;
  return text === message.text && !message.thinking ? message : { ...message, text, thinking: undefined };
}

export function toolDisplayModel(message: ConversationMessage): ToolDisplayModel {
  const status = toolStatus(message);
  const statusLabel = toolStatusLabel(status);
  const outputSummary = status === "running" ? "" : summarizeToolOutput(message.text);
  const summary = outputSummary || (status === "running" ? "等待工具结果" : "无输出");

  return {
    name: toolName(message),
    status,
    statusLabel,
    summary,
    detailLabel: status === "failed" ? "错误详情" : status === "running" ? "工具详情" : "工具输出",
    detail: message.text.trim(),
    updatedAt: message.updatedAt ?? message.timestamp ?? 0,
  };
}

export function toolGroupDisplayModel(tools: ConversationMessage[], thinkingMessages: ConversationMessage[] = [], forceRunning = false): ToolGroupDisplayModel {
  const displayTools = tools.map(toolDisplayModel);
  const thinking = thinkingMessages.flatMap(thinkingDisplayModel);
  const thinkingRunningCount = thinking.filter((item) => item.isStreaming).length;
  const toolRunningCount = displayTools.filter((tool) => tool.status === "running").length;
  const failedCount = displayTools.filter((tool) => tool.status === "failed").length;
  const runningCount = toolRunningCount + thinkingRunningCount;
  const completedCount = displayTools.length - toolRunningCount - failedCount;
  const isProcessing = forceRunning || runningCount > 0;
  const status: ToolDisplayStatus = isProcessing ? "running" : failedCount > 0 ? "failed" : "completed";
  const toolNameCounts = countToolNames(displayTools);

  return {
    title: "",
    status,
    statusLabel: toolGroupStatusLabel(status, failedCount, displayTools.length),
    summary: toolGroupSummary(toolNameCounts, { thinkingCount: thinking.length, runningCount, failedCount, completedCount, isProcessing }),
    thinkingCount: thinking.length,
    toolCount: displayTools.length,
    runningCount,
    failedCount,
    completedCount,
    toolNameCounts,
    thinking,
    tools: displayTools,
    current: currentProcessDisplayModel(displayTools, thinking, isProcessing),
  };
}

function messageBlock(message: ConversationMessage, displayKind: RenderableConversationMessageDisplayKind): ConversationDisplayBlock {
  return {
    type: "message",
    id: message.id,
    message,
    displayKind,
    isStreaming: message.isStreaming ?? false,
  };
}

function toolGroupBlock(tools: ConversationMessage[], thinkingMessages: ConversationMessage[], groupId: string, forceRunning: boolean): ConversationDisplayBlock {
  const model = toolGroupDisplayModel(tools, thinkingMessages, forceRunning);
  return {
    type: "tool_group",
    id: `process-group-${groupId}`,
    tools,
    thinkingMessages,
    model,
    isStreaming: model.status === "running",
  };
}

function thinkingDisplayModel(message: ConversationMessage): ThinkingDisplayModel[] {
  const text = message.thinking?.trim();
  if (!text) return [];
  return [{ id: `${message.id}-thinking`, text, isStreaming: message.isStreaming ?? false, updatedAt: message.updatedAt ?? message.timestamp ?? 0 }];
}

function currentProcessDisplayModel(tools: ToolDisplayModel[], thinking: ThinkingDisplayModel[], isProcessing: boolean): ProcessCurrentDisplayModel | undefined {
  if (!isProcessing) return undefined;

  const runningThinking = thinking.filter((item) => item.isStreaming).map((item) => ({ kind: "thinking" as const, updatedAt: item.updatedAt, item }));
  const runningTools = tools.filter((tool) => tool.status === "running").map((tool) => ({ kind: "tool" as const, updatedAt: tool.updatedAt, item: tool }));
  const runningCurrent = latestByUpdatedAt([...runningThinking, ...runningTools]);
  if (runningCurrent) return processCurrentFromCandidate(runningCurrent);

  const latestThinking = thinking.map((item) => ({ kind: "thinking" as const, updatedAt: item.updatedAt, item }));
  const latestTools = tools.map((tool) => ({ kind: "tool" as const, updatedAt: tool.updatedAt, item: tool }));
  const latest = latestByUpdatedAt([...latestThinking, ...latestTools]);
  return latest ? processCurrentFromCandidate(latest) : undefined;
}

function latestByUpdatedAt<T extends { updatedAt: number }>(items: T[]): T | undefined {
  return items.reduce<T | undefined>((latest, item) => (!latest || item.updatedAt >= latest.updatedAt ? item : latest), undefined);
}

function processCurrentFromCandidate(
  candidate: { kind: "thinking"; item: ThinkingDisplayModel } | { kind: "tool"; item: ToolDisplayModel },
): ProcessCurrentDisplayModel {
  if (candidate.kind === "thinking") {
    const preview = truncateProcessPreview(candidate.item.text);
    return {
      kind: "thinking",
      title: "正在思考",
      status: candidate.item.isStreaming ? "running" : "completed",
      statusLabel: candidate.item.isStreaming ? "进行中" : "最近思考",
      content: preview || "等待思考内容…",
    };
  }

  const preview = truncateProcessPreview(candidate.item.detail || candidate.item.summary);
  return {
    kind: "tool",
    title: `正在执行 ${candidate.item.name}`,
    status: candidate.item.status,
    statusLabel: candidate.item.statusLabel,
    content: preview || "等待工具输出…",
  };
}

function truncateProcessPreview(text: string): string {
  const normalized = text.trim();
  if (!normalized) return "";

  const lines = normalized.split(/\r?\n/);
  const lineLimited = lines.length > PROCESS_PREVIEW_MAX_LINES ? lines.slice(-PROCESS_PREVIEW_MAX_LINES).join("\n") : normalized;
  return lineLimited.length > PROCESS_PREVIEW_MAX_CHARS ? lineLimited.slice(lineLimited.length - PROCESS_PREVIEW_MAX_CHARS) : lineLimited;
}

function toolName(message: ConversationMessage): string {
  const title = message.title?.trim();
  if (title) return title.replace(TOOL_STATUS_SUFFIX_RE, "").trim() || title;
  const idName = message.id.startsWith("tool-") ? message.id.slice("tool-".length) : message.id;
  return idName ? `工具 ${idName.slice(0, 8)}` : "工具";
}

function toolStatus(message: ConversationMessage): ToolDisplayStatus {
  if (message.isStreaming) return "running";
  if (message.role === "error" || message.title?.includes("失败")) return "failed";
  return "completed";
}

function toolStatusLabel(status: ToolDisplayStatus): string {
  if (status === "running") return "运行中";
  if (status === "failed") return "失败";
  return "完成";
}

function toolGroupStatusLabel(status: ToolDisplayStatus, failedCount: number, toolCount: number): string {
  if (status === "running") return "处理中";
  if (status === "failed") return failedCount === toolCount ? "失败" : "部分失败";
  return "已完成";
}

function countToolNames(tools: ToolDisplayModel[]): ToolNameCount[] {
  const counts = new Map<string, number>();
  for (const tool of tools) counts.set(tool.name, (counts.get(tool.name) ?? 0) + 1);
  return [...counts.entries()].map(([name, count]) => ({ name, count }));
}

function toolGroupSummary(
  toolNameCounts: ToolNameCount[],
  counts: { thinkingCount: number; runningCount: number; failedCount: number; completedCount: number; isProcessing: boolean },
): string {
  const parts: string[] = [];
  if (counts.thinkingCount > 0) parts.push(`思考 ${counts.thinkingCount} 段`);

  const nameSummary = formatToolNameCounts(toolNameCounts);
  if (nameSummary) parts.push(nameSummary);

  if (counts.runningCount > 0) parts.push(`${counts.runningCount} 项运行中`);
  if (counts.failedCount > 0) parts.push(`${counts.failedCount} 次失败`);
  if (counts.failedCount > 0 && counts.completedCount > 0) parts.push(`${counts.completedCount} 次完成`);

  return parts.join(" · ");
}

function formatToolNameCounts(toolNameCounts: ToolNameCount[]): string {
  const visible = toolNameCounts.slice(0, TOOL_GROUP_SUMMARY_MAX_ITEMS);
  const hiddenCount = toolNameCounts.length - visible.length;
  const parts = visible.map(({ name, count }) => `${name} ×${count}`);
  if (hiddenCount > 0) parts.push(`另 ${hiddenCount} 类`);
  return parts.join(" · ");
}

function summarizeToolOutput(text: string): string {
  const trimmed = text.trim();
  if (!trimmed) return "";

  const lines = trimmed.split(/\r?\n/).map((line) => line.trim()).filter(Boolean);
  const lineCount = lines.length || 1;
  const firstLine = truncate((lines[0] ?? trimmed).replace(/\s+/g, " "), TOOL_SUMMARY_LINE_MAX_CHARS);
  const countLabel = lineCount > 1 ? `${lineCount} 行输出` : "1 行输出";
  const summary = firstLine ? `${countLabel}：${firstLine}` : countLabel;
  return truncate(summary, TOOL_SUMMARY_MAX_CHARS);
}

function truncate(value: string, maxChars: number): string {
  if (value.length <= maxChars) return value;
  return `${value.slice(0, Math.max(0, maxChars - 1))}…`;
}
