import { isSerializedToolCallText, stripSerializedToolCallsFromText, type ConversationMessage, type ConversationToolDetails, type SubagentRun } from "@pi-gui/shared";
import { subagentRunIsActive } from "./subagents";

// Conversation display modes are intentionally centralized so future modes
// can switch rendering policy without changing ChatView.
export type ConversationDisplayMode = "compact" | "chronological" | "tui";
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
  toolDetails?: ConversationToolDetails;
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

export type SubagentProcessDisplayModel = {
  run: SubagentRun;
  status: ToolDisplayStatus;
  statusLabel: string;
  summary: string;
  detail: string;
  updatedAt: number;
};

export type ProcessCurrentDisplayModel = {
  kind: "thinking" | "tool" | "subagent";
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
  subagentCount: number;
  runningCount: number;
  failedCount: number;
  completedCount: number;
  toolNameCounts: ToolNameCount[];
  thinking: ThinkingDisplayModel[];
  tools: ToolDisplayModel[];
  subagents: SubagentProcessDisplayModel[];
  current?: ProcessCurrentDisplayModel;
};

export type TuiProcessDisplayModel = {
  kind: "thinking" | "tool" | "subagent";
  title: string;
  status: ToolDisplayStatus;
  statusLabel: string;
  summary: string;
  detail: string;
  updatedAt: number;
  tool?: ToolDisplayModel;
  thinking?: ThinkingDisplayModel;
  subagent?: SubagentProcessDisplayModel;
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
      subagentRuns: SubagentRun[];
      model: ToolGroupDisplayModel;
      isStreaming: boolean;
    }
  | {
      type: "tui_process";
      id: string;
      model: TuiProcessDisplayModel;
      isStreaming: boolean;
    };

export type ConversationDisplayOptions = {
  activeRuntimeIsBusy?: boolean;
  subagentRuns?: SubagentRun[];
};

export type ConversationDisplayBuildCache = {
  messages: ConversationMessage[];
  mode: ConversationDisplayMode;
  options: ConversationDisplayOptions;
  blocks: ConversationDisplayBlock[];
  messageFirstIndexById: Map<string, number>;
};

const TOOL_STATUS_SUFFIX_RE = /\s+(运行中|完成|失败)$/;
const TOOL_SUMMARY_MAX_CHARS = 150;
const TOOL_SUMMARY_LINE_MAX_CHARS = 110;
const TOOL_GROUP_SUMMARY_MAX_ITEMS = 4;
const SYNTHETIC_USER_INPUT_DEDUPE_MS = 5000;

export function buildConversationDisplayBlocks(
  messages: ConversationMessage[],
  mode: ConversationDisplayMode = "compact",
  options: ConversationDisplayOptions = {},
): ConversationDisplayBlock[] {
  const displayMessages = dedupeSyntheticSnapshotMessages(messages);
  if (mode === "chronological") return buildChronologicalConversationDisplayBlocks(displayMessages, options);
  if (mode === "tui") return buildTuiConversationDisplayBlocks(displayMessages, options);
  return buildCompactConversationDisplayBlocks(displayMessages, options);
}

export function buildConversationDisplayBlocksCached(
  messages: ConversationMessage[],
  mode: ConversationDisplayMode = "compact",
  options: ConversationDisplayOptions = {},
  previous?: ConversationDisplayBuildCache,
): ConversationDisplayBuildCache {
  const incremental = buildIncrementalCompactConversationDisplayBlocks(messages, mode, options, previous);
  if (incremental) return { messages, mode, options, blocks: incremental.blocks, messageFirstIndexById: incremental.messageFirstIndexById };

  const blocks = buildConversationDisplayBlocks(messages, mode, options);
  return { messages, mode, options, blocks, messageFirstIndexById: indexMessageFirstPositions(messages) };
}

function buildIncrementalCompactConversationDisplayBlocks(
  messages: ConversationMessage[],
  mode: ConversationDisplayMode,
  options: ConversationDisplayOptions,
  previous: ConversationDisplayBuildCache | undefined,
): { blocks: ConversationDisplayBlock[]; messageFirstIndexById: Map<string, number> } | undefined {
  if (!previous || mode !== "compact" || previous.mode !== mode) return undefined;
  if (previous.options.activeRuntimeIsBusy !== options.activeRuntimeIsBusy || previous.options.subagentRuns !== options.subagentRuns) return undefined;
  if (previous.messages === messages) return { blocks: previous.blocks, messageFirstIndexById: previous.messageFirstIndexById };

  const firstChangedIndex = tailAppendOrUpdateStartIndex(previous.messages, messages);
  if (firstChangedIndex === undefined) return undefined;

  const rebuildStartIndex = segmentStartIndexForCompactIncrementalBuild(messages, firstChangedIndex);
  if (rebuildStartIndex === undefined) return undefined;
  const prefixEndIndex = prefixBlockEndIndex(previous.blocks, messages[rebuildStartIndex]?.id);
  if (prefixEndIndex === undefined) return undefined;

  const suffixMessages = messages.slice(rebuildStartIndex);
  if (!safeIncrementalCompactSuffix(suffixMessages, rebuildStartIndex, previous.messageFirstIndexById)) return undefined;
  return {
    blocks: [...previous.blocks.slice(0, prefixEndIndex), ...buildCompactConversationDisplayBlocks(suffixMessages, options)],
    messageFirstIndexById: incrementalMessageFirstPositions(previous.messageFirstIndexById, previous.messages.length, messages),
  };
}

function buildCompactConversationDisplayBlocks(displayMessages: ConversationMessage[], options: ConversationDisplayOptions): ConversationDisplayBlock[] {
  const blocks: ConversationDisplayBlock[] = [];
  const subagentRunByToolMessageId = new Map((options.subagentRuns ?? []).map((run) => [run.parentToolMessageId, run]));
  let segmentBlocks: ConversationDisplayBlock[] = [];
  let segmentTools: ConversationMessage[] = [];
  let segmentThinkingMessages: ConversationMessage[] = [];
  let segmentSubagentRuns: SubagentRun[] = [];
  let segmentUserMessageId = "root";
  let processInsertIndex: number | undefined;

  function flushSegment(forceRunning = false) {
    if (segmentTools.length > 0 || segmentThinkingMessages.length > 0 || segmentSubagentRuns.length > 0) {
      const insertAt = processInsertIndex ?? segmentBlocks.length;
      segmentBlocks.splice(insertAt, 0, toolGroupBlock(segmentTools, segmentThinkingMessages, segmentSubagentRuns, segmentUserMessageId, forceRunning));
    }

    blocks.push(...segmentBlocks);
    segmentBlocks = [];
    segmentTools = [];
    segmentThinkingMessages = [];
    segmentSubagentRuns = [];
    segmentUserMessageId = "root";
    processInsertIndex = undefined;
  }

  for (const message of displayMessages) {
    const hasAssistantThinking = message.role === "assistant" && Boolean(message.thinking?.trim());
    if (hasAssistantThinking) {
      if (processInsertIndex === undefined) processInsertIndex = segmentBlocks.length;
      segmentThinkingMessages.push(message);
    }

    const displayMessage = conversationMessageForDisplay(message, "compact");
    if (!displayMessage) continue;

    const displayKind = conversationMessageDisplayKind(displayMessage, "compact");
    if (displayKind === "hidden") continue;

    if (displayMessage.role === "user") {
      flushSegment();
      segmentUserMessageId = displayMessage.id;
      segmentBlocks.push(messageBlock(displayMessage, "markdown"));
      continue;
    }

    if (displayKind === "tool") {
      const subagentRun = subagentRunByToolMessageId.get(displayMessage.id);
      if (subagentRun) {
        if (processInsertIndex === undefined) processInsertIndex = segmentBlocks.length;
        segmentSubagentRuns.push(subagentRun);
        continue;
      }
      if (processInsertIndex === undefined) processInsertIndex = segmentBlocks.length;
      segmentTools.push(displayMessage);
      continue;
    }

    segmentBlocks.push(messageBlock(displayMessage, displayKind));
  }

  flushSegment(options.activeRuntimeIsBusy === true);
  return blocks;
}

function buildChronologicalConversationDisplayBlocks(displayMessages: ConversationMessage[], options: ConversationDisplayOptions): ConversationDisplayBlock[] {
  const blocks: ConversationDisplayBlock[] = [];
  const subagentRunByToolMessageId = new Map((options.subagentRuns ?? []).map((run) => [run.parentToolMessageId, run]));
  let processTools: ConversationMessage[] = [];
  let processThinkingMessages: ConversationMessage[] = [];
  let processSubagentRuns: SubagentRun[] = [];
  let processGroupId: string | undefined;

  function addProcessAnchor(message: ConversationMessage) {
    if (!processGroupId) processGroupId = message.id;
  }

  function flushProcessGroup(forceRunning = false) {
    if (processTools.length > 0 || processThinkingMessages.length > 0 || processSubagentRuns.length > 0) {
      blocks.push(toolGroupBlock(processTools, processThinkingMessages, processSubagentRuns, processGroupId ?? "chronological", forceRunning));
    }
    processTools = [];
    processThinkingMessages = [];
    processSubagentRuns = [];
    processGroupId = undefined;
  }

  for (const message of displayMessages) {
    const displayMessage = conversationMessageForDisplay(message, "chronological");
    if (!displayMessage) continue;

    const hasAssistantThinking = displayMessage.role === "assistant" && Boolean(displayMessage.thinking?.trim());
    if (hasAssistantThinking) {
      addProcessAnchor(displayMessage);
      processThinkingMessages.push(displayMessage);
    }

    if (isToolDisplayMessage(displayMessage)) {
      addProcessAnchor(displayMessage);
      const subagentRun = subagentRunByToolMessageId.get(displayMessage.id);
      if (subagentRun) processSubagentRuns.push(subagentRun);
      else processTools.push(displayMessage);
      continue;
    }

    const textMessage = hasAssistantThinking ? { ...displayMessage, thinking: undefined } : displayMessage;
    if (!textMessage.text) continue;

    const displayKind = conversationMessageDisplayKind(textMessage, "chronological");
    if (displayKind === "hidden" || displayKind === "tool") continue;
    flushProcessGroup();
    blocks.push(messageBlock(textMessage, displayKind));
  }

  flushProcessGroup(options.activeRuntimeIsBusy === true);
  return blocks;
}

function buildTuiConversationDisplayBlocks(displayMessages: ConversationMessage[], options: ConversationDisplayOptions): ConversationDisplayBlock[] {
  const blocks: ConversationDisplayBlock[] = [];
  const subagentRunByToolMessageId = new Map((options.subagentRuns ?? []).map((run) => [run.parentToolMessageId, run]));

  for (const message of displayMessages) {
    const displayMessage = conversationMessageForDisplay(message, "tui");
    if (!displayMessage) continue;

    const hasAssistantThinking = displayMessage.role === "assistant" && Boolean(displayMessage.thinking?.trim());
    if (hasAssistantThinking) {
      const thinking = thinkingDisplayModel(displayMessage)[0];
      if (thinking) blocks.push(tuiProcessBlock(tuiThinkingProcessModel(thinking), `${displayMessage.id}-thinking`));
    }

    if (isToolDisplayMessage(displayMessage)) {
      const subagentRun = subagentRunByToolMessageId.get(displayMessage.id);
      blocks.push(subagentRun ? tuiProcessBlock(tuiSubagentProcessModel(subagentRun), `${displayMessage.id}-subagent`) : tuiProcessBlock(tuiToolProcessModel(displayMessage), displayMessage.id));
      continue;
    }

    const textMessage = hasAssistantThinking ? { ...displayMessage, thinking: undefined } : displayMessage;
    if (!textMessage.text) continue;

    const displayKind = conversationMessageDisplayKind(textMessage, "tui");
    if (displayKind === "hidden" || displayKind === "tool") continue;
    blocks.push(messageBlock(textMessage, displayKind));
  }

  return blocks;
}

export function conversationMessageDisplayKind(
  message: ConversationMessage,
  mode: ConversationDisplayMode = "compact",
): ConversationMessageDisplayKind {
  if (isLeakedToolCallMessage(message)) return "hidden";
  if (mode === "compact" && isToolDisplayMessage(message)) return "tool";
  if (message.role === "assistant" || message.role === "user") return "markdown";
  return "plain";
}

export function isToolDisplayMessage(message: ConversationMessage): boolean {
  return message.role === "tool" || (message.role === "error" && message.id.startsWith("tool-"));
}

export function isLeakedToolCallMessage(message: ConversationMessage): boolean {
  return message.role === "assistant" && isSerializedToolCallText(message.text);
}

function dedupeSyntheticSnapshotMessages(messages: ConversationMessage[]): ConversationMessage[] {
  const result: ConversationMessage[] = [];
  const indexById = new Map<string, number>();
  const indexBySignature = new Map<string, number>();
  const indexBySyntheticUserInput = new Map<string, number>();

  for (const message of messages) {
    const syntheticUserInput = syntheticUserInputSignature(message);
    const syntheticUserInputIndex = syntheticUserInput ? indexBySyntheticUserInput.get(syntheticUserInput) : undefined;
    const syntheticUserInputMatch = syntheticUserInputIndex !== undefined ? result[syntheticUserInputIndex] : undefined;
    if (syntheticUserInputIndex !== undefined && syntheticUserInputMatch && shouldDedupeSyntheticUserInput(syntheticUserInputMatch, message)) {
      const next = isSyntheticUserInputMessageId(syntheticUserInputMatch.id) ? message : syntheticUserInputMatch;
      result[syntheticUserInputIndex] = next;
      indexById.delete(syntheticUserInputMatch.id);
      indexById.set(next.id, syntheticUserInputIndex);
      continue;
    }

    const signature = snapshotDuplicateSignature(message);
    const signatureIndex = signature ? indexBySignature.get(signature) : undefined;
    const signatureMatch = signatureIndex !== undefined ? result[signatureIndex] : undefined;
    if (signatureIndex !== undefined && signatureMatch) {
      const currentIsSynthetic = isSyntheticSnapshotMessageId(message.id);
      const matchIsSynthetic = isSyntheticSnapshotMessageId(signatureMatch.id);
      if (currentIsSynthetic || matchIsSynthetic) {
        const next = matchIsSynthetic && !currentIsSynthetic ? message : signatureMatch;
        result[signatureIndex] = next;
        indexById.delete(signatureMatch.id);
        indexById.set(next.id, signatureIndex);
        continue;
      }
    }

    const idIndex = indexById.get(message.id);
    if (idIndex !== undefined) {
      result[idIndex] = message;
      if (signature) indexBySignature.set(signature, idIndex);
      continue;
    }

    indexById.set(message.id, result.length);
    if (signature) indexBySignature.set(signature, result.length);
    if (syntheticUserInput) indexBySyntheticUserInput.set(syntheticUserInput, result.length);
    result.push(message);
  }

  return result;
}

function syntheticUserInputSignature(message: ConversationMessage): string | undefined {
  if (message.role !== "user") return undefined;
  const text = message.text.trim();
  return text || undefined;
}

function shouldDedupeSyntheticUserInput(left: ConversationMessage, right: ConversationMessage): boolean {
  if (!isSyntheticUserInputMessageId(left.id) || isSyntheticUserInputMessageId(right.id)) return false;
  if (left.timestamp === undefined || right.timestamp === undefined) return true;
  return Math.abs(left.timestamp - right.timestamp) <= SYNTHETIC_USER_INPUT_DEDUPE_MS;
}

function snapshotDuplicateSignature(message: ConversationMessage): string | undefined {
  if (message.timestamp === undefined || !Number.isFinite(message.timestamp)) return undefined;
  if (!message.text && !message.thinking) return undefined;
  return JSON.stringify([message.role, message.timestamp, message.text, message.thinking ?? "", message.title ?? ""]);
}

function isSyntheticSnapshotMessageId(id: string): boolean {
  return /^snapshot-\d+-\d+$/.test(id) || /^tool-snapshot-\d+-\d+$/.test(id) || /^bash-\d+-\d+$/.test(id);
}

function isSyntheticUserInputMessageId(id: string): boolean {
  return id.startsWith("user-gui-command-");
}

function tailAppendOrUpdateStartIndex(previousMessages: ConversationMessage[], messages: ConversationMessage[]): number | undefined {
  if (previousMessages.length === 0) return undefined;

  if (messages.length === previousMessages.length) {
    const lastIndex = messages.length - 1;
    if (previousMessages[lastIndex] !== messages[lastIndex] && (lastIndex === 0 || previousMessages[lastIndex - 1] === messages[lastIndex - 1])) return lastIndex;
    return undefined;
  }

  if (messages.length > previousMessages.length && previousMessages[previousMessages.length - 1] === messages[previousMessages.length - 1]) return previousMessages.length;
  return undefined;
}

function segmentStartIndexForCompactIncrementalBuild(messages: ConversationMessage[], firstChangedIndex: number): number | undefined {
  for (let index = Math.min(firstChangedIndex, messages.length - 1); index >= 0; index -= 1) {
    if (messages[index]?.role === "user") return index;
  }
  return undefined;
}

function prefixBlockEndIndex(blocks: ConversationDisplayBlock[], startMessageId: string | undefined): number | undefined {
  if (!startMessageId) return blocks.length;
  for (let index = blocks.length - 1; index >= 0; index -= 1) {
    const block = blocks[index];
    if (block?.type === "message" && block.message.id === startMessageId) return index;
  }
  return undefined;
}

function safeIncrementalCompactSuffix(messages: ConversationMessage[], rebuildStartIndex: number, previousFirstIndexById: Map<string, number>): boolean {
  const suffixIds = new Set<string>();
  return messages.every((message, index) => {
    if (index > 0 && message.role === "user") return false;
    if (isSyntheticSnapshotMessageId(message.id) || isSyntheticUserInputMessageId(message.id)) return false;
    if (suffixIds.has(message.id)) return false;
    suffixIds.add(message.id);
    const previousFirstIndex = previousFirstIndexById.get(message.id);
    return previousFirstIndex === undefined || previousFirstIndex >= rebuildStartIndex;
  });
}

function indexMessageFirstPositions(messages: ConversationMessage[]): Map<string, number> {
  const positions = new Map<string, number>();
  for (const [index, message] of messages.entries()) {
    if (!positions.has(message.id)) positions.set(message.id, index);
  }
  return positions;
}

function incrementalMessageFirstPositions(previous: Map<string, number>, previousLength: number, messages: ConversationMessage[]): Map<string, number> {
  if (messages.length <= previousLength) return previous;
  const next = new Map(previous);
  for (let index = previousLength; index < messages.length; index += 1) {
    const id = messages[index]?.id;
    if (id && !next.has(id)) next.set(id, index);
  }
  return next;
}

function conversationMessageForDisplay(message: ConversationMessage, mode: ConversationDisplayMode): ConversationMessage | undefined {
  if (message.role !== "assistant") return message;

  const text = stripSerializedToolCallsFromText(message.text);
  const thinking = mode === "compact" ? undefined : message.thinking;
  if (!text && !thinking?.trim()) return undefined;
  return text === message.text && thinking === message.thinking ? message : { ...message, text, thinking };
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
    detailLabel: message.toolDetails?.diff ? "编辑差异" : status === "failed" ? "错误详情" : status === "running" ? "工具详情" : "工具输出",
    detail: message.text.trim(),
    toolDetails: message.toolDetails,
    updatedAt: message.updatedAt ?? message.timestamp ?? 0,
  };
}

export function toolGroupDisplayModel(tools: ConversationMessage[], thinkingMessages: ConversationMessage[] = [], subagentRuns: SubagentRun[] = [], forceRunning = false): ToolGroupDisplayModel {
  const displayTools = tools.map(toolDisplayModel);
  const thinking = thinkingMessages.flatMap(thinkingDisplayModel);
  const subagents = subagentRuns.map(subagentProcessDisplayModel);
  const thinkingRunningCount = thinking.filter((item) => item.isStreaming).length;
  const toolRunningCount = displayTools.filter((tool) => tool.status === "running").length;
  const subagentRunningCount = subagents.filter((item) => item.status === "running").length;
  const failedCount = displayTools.filter((tool) => tool.status === "failed").length + subagents.filter((item) => item.status === "failed").length;
  const runningCount = toolRunningCount + thinkingRunningCount + subagentRunningCount;
  const completedCount = displayTools.length + subagents.length - toolRunningCount - subagentRunningCount - failedCount;
  const isProcessing = forceRunning || runningCount > 0;
  const status: ToolDisplayStatus = isProcessing ? "running" : failedCount > 0 ? "failed" : "completed";
  const toolNameCounts = countToolNames(displayTools);

  return {
    title: "",
    status,
    statusLabel: toolGroupStatusLabel(status, failedCount, displayTools.length + subagents.length),
    summary: toolGroupSummary(toolNameCounts, { thinkingCount: thinking.length, subagentCount: subagents.length, runningCount, failedCount, completedCount, isProcessing }),
    thinkingCount: thinking.length,
    toolCount: displayTools.length,
    subagentCount: subagents.length,
    runningCount,
    failedCount,
    completedCount,
    toolNameCounts,
    thinking,
    tools: displayTools,
    subagents,
    current: currentProcessDisplayModel(displayTools, thinking, subagents, isProcessing),
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

function toolGroupBlock(tools: ConversationMessage[], thinkingMessages: ConversationMessage[], subagentRuns: SubagentRun[], groupId: string, forceRunning: boolean): ConversationDisplayBlock {
  const model = toolGroupDisplayModel(tools, thinkingMessages, subagentRuns, forceRunning);
  return {
    type: "tool_group",
    id: `process-group-${groupId}`,
    tools,
    thinkingMessages,
    subagentRuns,
    model,
    isStreaming: model.status === "running",
  };
}

function tuiProcessBlock(model: TuiProcessDisplayModel, id: string): ConversationDisplayBlock {
  return {
    type: "tui_process",
    id: `tui-process-${id}`,
    model,
    isStreaming: model.status === "running",
  };
}

function tuiThinkingProcessModel(thinking: ThinkingDisplayModel): TuiProcessDisplayModel {
  return {
    kind: "thinking",
    title: "thinking",
    status: thinking.isStreaming ? "running" : "completed",
    statusLabel: thinking.isStreaming ? "running" : "done",
    summary: truncate(thinking.text.replace(/\s+/g, " ").trim() || "Thinking ...", TOOL_SUMMARY_LINE_MAX_CHARS),
    detail: thinking.text,
    updatedAt: thinking.updatedAt,
    thinking,
  };
}

function tuiToolProcessModel(message: ConversationMessage): TuiProcessDisplayModel {
  const tool = toolDisplayModel(message);
  return {
    kind: "tool",
    title: tool.name,
    status: tool.status,
    statusLabel: tool.status === "running" ? "running" : tool.status === "failed" ? "error" : "done",
    summary: tuiToolSummary(tool),
    detail: tool.detail,
    updatedAt: tool.updatedAt,
    tool,
  };
}

function tuiSubagentProcessModel(run: SubagentRun): TuiProcessDisplayModel {
  const subagent = subagentProcessDisplayModel(run);
  return {
    kind: "subagent",
    title: `agent ${run.agent}`,
    status: subagent.status,
    statusLabel: subagent.status === "running" ? "running" : subagent.status === "failed" ? "error" : "done",
    summary: subagent.summary,
    detail: subagent.detail,
    updatedAt: subagent.updatedAt,
    subagent,
  };
}

function tuiToolSummary(tool: ToolDisplayModel): string {
  if (tool.status === "running") return "Running ...";
  if (tool.toolDetails?.diff) return tool.toolDetails.path ? `${tool.toolDetails.path} · ${tool.summary}` : tool.summary;
  return tool.summary;
}

function thinkingDisplayModel(message: ConversationMessage): ThinkingDisplayModel[] {
  const text = message.thinking?.trim();
  if (!text) return [];
  return [{ id: `${message.id}-thinking`, text, isStreaming: message.isStreaming ?? false, updatedAt: message.updatedAt ?? message.timestamp ?? 0 }];
}

function subagentProcessDisplayModel(run: SubagentRun): SubagentProcessDisplayModel {
  const status = subagentRunProcessStatus(run);
  return {
    run,
    status,
    statusLabel: subagentRunStatusLabel(run.status),
    summary: subagentRunSummary(run),
    detail: subagentRunDetail(run),
    updatedAt: run.updatedAt,
  };
}

function currentProcessDisplayModel(tools: ToolDisplayModel[], thinking: ThinkingDisplayModel[], subagents: SubagentProcessDisplayModel[], isProcessing: boolean): ProcessCurrentDisplayModel | undefined {
  if (!isProcessing) return undefined;

  const runningThinking = thinking.filter((item) => item.isStreaming).map((item) => ({ kind: "thinking" as const, updatedAt: item.updatedAt, item }));
  const runningTools = tools.filter((tool) => tool.status === "running").map((tool) => ({ kind: "tool" as const, updatedAt: tool.updatedAt, item: tool }));
  const runningSubagents = subagents.filter((subagent) => subagent.status === "running").map((subagent) => ({ kind: "subagent" as const, updatedAt: subagent.updatedAt, item: subagent }));
  const runningCurrent = latestByUpdatedAt([...runningThinking, ...runningTools, ...runningSubagents]);
  if (runningCurrent) return processCurrentFromCandidate(runningCurrent);

  const latestThinking = thinking.map((item) => ({ kind: "thinking" as const, updatedAt: item.updatedAt, item }));
  const latestTools = tools.map((tool) => ({ kind: "tool" as const, updatedAt: tool.updatedAt, item: tool }));
  const latestSubagents = subagents.map((subagent) => ({ kind: "subagent" as const, updatedAt: subagent.updatedAt, item: subagent }));
  const latest = latestByUpdatedAt([...latestThinking, ...latestTools, ...latestSubagents]);
  return latest ? processCurrentFromCandidate(latest) : undefined;
}

function latestByUpdatedAt<T extends { updatedAt: number }>(items: T[]): T | undefined {
  return items.reduce<T | undefined>((latest, item) => (!latest || item.updatedAt >= latest.updatedAt ? item : latest), undefined);
}

function processCurrentFromCandidate(
  candidate: { kind: "thinking"; item: ThinkingDisplayModel } | { kind: "tool"; item: ToolDisplayModel } | { kind: "subagent"; item: SubagentProcessDisplayModel },
): ProcessCurrentDisplayModel {
  if (candidate.kind === "thinking") {
    const content = candidate.item.text.trim();
    return {
      kind: "thinking",
      title: "正在思考",
      status: candidate.item.isStreaming ? "running" : "completed",
      statusLabel: candidate.item.isStreaming ? "进行中" : "最近思考",
      content: content || "等待思考内容…",
    };
  }

  if (candidate.kind === "subagent") {
    const content = (candidate.item.detail || candidate.item.summary).trim();
    return {
      kind: "subagent",
      title: `子代理 ${candidate.item.run.agent}`,
      status: candidate.item.status,
      statusLabel: candidate.item.statusLabel,
      content: content || "等待子代理输出…",
    };
  }

  const content = (candidate.item.detail || candidate.item.summary).trim();
  return {
    kind: "tool",
    title: `正在执行 ${candidate.item.name}`,
    status: candidate.item.status,
    statusLabel: candidate.item.statusLabel,
    content: content || "等待工具输出…",
  };
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

function subagentRunProcessStatus(run: SubagentRun): ToolDisplayStatus {
  if (run.status === "failed" || run.status === "cancelled") return "failed";
  if (subagentRunIsActive(run)) return "running";
  return "completed";
}

function subagentRunStatusLabel(status: SubagentRun["status"]): string {
  if (status === "pending") return "等待中";
  if (status === "running") return "运行中";
  if (status === "succeeded") return "完成";
  if (status === "failed") return "失败";
  return "已取消";
}

function subagentRunSummary(run: SubagentRun): string {
  const childCount = run.runs.length || 1;
  const runningCount = run.runs.filter((child) => child.status === "pending" || child.status === "running").length;
  return [run.agent, `${childCount} child`, runningCount > 0 ? `${runningCount} 运行中` : subagentRunStatusLabel(run.status)].join(" · ");
}

function subagentRunDetail(run: SubagentRun): string {
  const final = run.finalText?.trim();
  if (final) return final;
  const latest = latestSubagentChild(run);
  return latest?.finalText?.trim() || latest?.textTail?.trim() || latest?.thinkingTail?.trim() || latest?.errorMessage?.trim() || latest?.stderrTail?.trim() || "";
}

function latestSubagentChild(run: SubagentRun): SubagentRun["runs"][number] | undefined {
  return run.runs.reduce<SubagentRun["runs"][number] | undefined>((latest, child) => {
    const updatedAt = child.finishedAt ?? child.startedAt ?? 0;
    const latestUpdatedAt = latest ? latest.finishedAt ?? latest.startedAt ?? 0 : -1;
    return updatedAt >= latestUpdatedAt ? child : latest;
  }, undefined);
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
  counts: { thinkingCount: number; subagentCount: number; runningCount: number; failedCount: number; completedCount: number; isProcessing: boolean },
): string {
  const parts: string[] = [];
  if (counts.thinkingCount > 0) parts.push(`思考 ${counts.thinkingCount} 段`);
  if (counts.subagentCount > 0) parts.push(`子代理 ${counts.subagentCount} 项`);

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
