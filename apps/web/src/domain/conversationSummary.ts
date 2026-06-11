import { stripSerializedToolCallsFromText, type ConversationMessage, type RuntimeConversationSummary } from "@pi-gui/shared";
import { isLeakedToolCallMessage } from "./conversationDisplay";

const TITLE_MAX_LENGTH = 72;
const DETAIL_MAX_LENGTH = 96;

export function indexConversationSummaries(summaries: RuntimeConversationSummary[]): Record<string, RuntimeConversationSummary> {
  return Object.fromEntries(summaries.map((summary) => [summary.runtimeId, summary]));
}

export type ConversationSummaryMergeCache = {
  persisted: Record<string, RuntimeConversationSummary>;
  messagesByRuntime: Record<string, ConversationMessage[]>;
  summaries: Record<string, RuntimeConversationSummary>;
  projectionsByRuntime: Map<string, ConversationSummaryProjection | undefined>;
};

export function mergeConversationSummaries(
  persisted: Record<string, RuntimeConversationSummary>,
  messagesByRuntime: Record<string, ConversationMessage[]>,
): Record<string, RuntimeConversationSummary> {
  return mergeConversationSummariesCached(persisted, messagesByRuntime).summaries;
}

export function mergeConversationSummariesCached(
  persisted: Record<string, RuntimeConversationSummary>,
  messagesByRuntime: Record<string, ConversationMessage[]>,
  previous?: ConversationSummaryMergeCache,
): ConversationSummaryMergeCache {
  const projectionsByRuntime = new Map<string, ConversationSummaryProjection | undefined>();
  let summaries = persisted;

  for (const [runtimeId, messages] of Object.entries(messagesByRuntime)) {
    const previousProjection = previous?.projectionsByRuntime.get(runtimeId);
    const projection = conversationSummaryProjectionFromMessages(runtimeId, messages, previousProjection);
    projectionsByRuntime.set(runtimeId, projection);
    if (!projection?.summary) continue;
    if (summaries === persisted) summaries = { ...persisted };
    summaries[runtimeId] = mergeRuntimeConversationSummary(persisted[runtimeId], projection.summary);
  }

  return { persisted, messagesByRuntime, summaries, projectionsByRuntime };
}

type ConversationSummaryCandidate = {
  index: number;
  id: string;
  role: ConversationMessage["role"];
  projectId: string;
  titleText: string;
  detailText: string;
};

type ConversationSummaryProjection = {
  messages: ConversationMessage[];
  summary?: RuntimeConversationSummary;
  firstCandidate?: ConversationSummaryCandidate;
  firstUserCandidate?: ConversationSummaryCandidate;
  latestCandidate?: ConversationSummaryCandidate;
  messageCount: number;
  updatedAt: number;
  updatedAtIndex: number;
  latestAssistantCompletedAt: number;
  latestAssistantCompletedAtIndex: number;
};

export function conversationSummaryFromMessages(runtimeId: string, messages: ConversationMessage[]): RuntimeConversationSummary | undefined {
  let firstCandidate: ConversationMessage | undefined;
  let firstUserCandidate: ConversationMessage | undefined;
  let latestCandidate: ConversationMessage | undefined;
  let title = "";
  let userTitle = "";
  let latestText = "";
  let messageCount = 0;
  let updatedAt = 0;
  let latestAssistantCompletedAt = 0;

  for (const message of messages) {
    const messageUpdatedAt = message.updatedAt ?? message.timestamp ?? 0;
    if (messageUpdatedAt > updatedAt) updatedAt = messageUpdatedAt;
    if (message.role === "assistant" && !message.isStreaming && message.text.trim() && messageUpdatedAt > latestAssistantCompletedAt) latestAssistantCompletedAt = messageUpdatedAt;

    if (!isConversationSummaryCandidate(message)) continue;
    const candidateTitle = summaryText(message.text, TITLE_MAX_LENGTH);
    if (!candidateTitle) continue;

    messageCount += 1;
    if (!firstCandidate) {
      firstCandidate = message;
      title = candidateTitle;
    }
    if (!firstUserCandidate && message.role === "user") {
      firstUserCandidate = message;
      userTitle = candidateTitle;
    }
    latestCandidate = message;
    latestText = summaryText(message.text, DETAIL_MAX_LENGTH) ?? "";
  }

  const titleMessage = firstUserCandidate ?? firstCandidate;
  const finalTitle = firstUserCandidate ? userTitle : title;
  if (!titleMessage || !finalTitle) return undefined;

  const detail = latestCandidate && latestCandidate.id !== titleMessage.id && latestText ? `${messageRolePrefix(latestCandidate)}：${latestText}` : undefined;
  return {
    runtimeId,
    projectId: titleMessage.projectId,
    title: finalTitle,
    detail,
    updatedAt: updatedAt || undefined,
    messageCount,
    latestAssistantCompletedAt: latestAssistantCompletedAt || undefined,
  };
}

function conversationSummaryProjectionFromMessages(runtimeId: string, messages: ConversationMessage[], previous?: ConversationSummaryProjection): ConversationSummaryProjection | undefined {
  const incrementalProjection = incrementalConversationSummaryProjection(runtimeId, messages, previous);
  if (incrementalProjection) return incrementalProjection;
  return fullConversationSummaryProjection(runtimeId, messages);
}

function fullConversationSummaryProjection(runtimeId: string, messages: ConversationMessage[]): ConversationSummaryProjection | undefined {
  let projection: ConversationSummaryProjection = {
    messages,
    messageCount: 0,
    updatedAt: 0,
    updatedAtIndex: -1,
    latestAssistantCompletedAt: 0,
    latestAssistantCompletedAtIndex: -1,
  };

  for (let index = 0; index < messages.length; index += 1) projection = applyMessageToProjection(runtimeId, projection, messages[index]!, index);
  projection.summary = summaryFromProjection(runtimeId, projection);
  return projection;
}

function incrementalConversationSummaryProjection(runtimeId: string, messages: ConversationMessage[], previous: ConversationSummaryProjection | undefined): ConversationSummaryProjection | undefined {
  if (!previous || previous.messages.length === 0) return undefined;
  if (messages === previous.messages) return previous;

  if (messages.length > previous.messages.length && previous.messages[previous.messages.length - 1] === messages[previous.messages.length - 1]) {
    let projection = { ...previous, messages };
    for (let index = previous.messages.length; index < messages.length; index += 1) projection = applyMessageToProjection(runtimeId, projection, messages[index]!, index);
    projection.summary = summaryFromProjection(runtimeId, projection);
    return projection;
  }

  if (messages.length !== previous.messages.length) return undefined;
  const lastIndex = messages.length - 1;
  if (lastIndex < 0 || previous.messages[lastIndex - 1] !== messages[lastIndex - 1] || previous.messages[lastIndex] === messages[lastIndex]) return undefined;

  const oldMessage = previous.messages[lastIndex]!;
  const nextMessage = messages[lastIndex]!;
  const oldCandidate = summaryCandidateFromMessage(oldMessage, lastIndex);
  const nextCandidate = summaryCandidateFromMessage(nextMessage, lastIndex);
  if (previous.firstCandidate?.index === lastIndex && !nextCandidate) return undefined;
  if (previous.firstUserCandidate?.index === lastIndex && (!nextCandidate || nextCandidate.role !== "user")) return undefined;
  if (previous.latestCandidate?.index === lastIndex && !nextCandidate) return undefined;

  const nextUpdatedAt = nextMessage.updatedAt ?? nextMessage.timestamp ?? 0;
  if (previous.updatedAtIndex === lastIndex && nextUpdatedAt < previous.updatedAt) return undefined;
  const nextAssistantCompletedAt = assistantCompletedAt(nextMessage);
  if (previous.latestAssistantCompletedAtIndex === lastIndex && nextAssistantCompletedAt < previous.latestAssistantCompletedAt) return undefined;

  let projection: ConversationSummaryProjection = {
    ...previous,
    messages,
    messageCount: previous.messageCount + (nextCandidate ? 1 : 0) - (oldCandidate ? 1 : 0),
  };
  if (!projection.firstCandidate && nextCandidate) projection.firstCandidate = nextCandidate;
  if (projection.firstCandidate?.index === lastIndex && nextCandidate) projection.firstCandidate = nextCandidate;
  if (!projection.firstUserCandidate && nextCandidate?.role === "user") projection.firstUserCandidate = nextCandidate;
  if (projection.firstUserCandidate?.index === lastIndex && nextCandidate?.role === "user") projection.firstUserCandidate = nextCandidate;
  if (nextCandidate) projection.latestCandidate = nextCandidate;
  if (nextUpdatedAt >= projection.updatedAt) {
    projection.updatedAt = nextUpdatedAt;
    projection.updatedAtIndex = lastIndex;
  }
  if (nextAssistantCompletedAt >= projection.latestAssistantCompletedAt) {
    projection.latestAssistantCompletedAt = nextAssistantCompletedAt;
    projection.latestAssistantCompletedAtIndex = lastIndex;
  }
  projection.summary = summaryFromProjection(runtimeId, projection);
  return projection;
}

function applyMessageToProjection(runtimeId: string, projection: ConversationSummaryProjection, message: ConversationMessage, index: number): ConversationSummaryProjection {
  const next = { ...projection };
  const updatedAt = message.updatedAt ?? message.timestamp ?? 0;
  if (updatedAt >= next.updatedAt) {
    next.updatedAt = updatedAt;
    next.updatedAtIndex = index;
  }
  const completedAt = assistantCompletedAt(message);
  if (completedAt >= next.latestAssistantCompletedAt) {
    next.latestAssistantCompletedAt = completedAt;
    next.latestAssistantCompletedAtIndex = index;
  }
  const candidate = summaryCandidateFromMessage(message, index);
  if (candidate) {
    next.messageCount += 1;
    next.firstCandidate ??= candidate;
    if (!next.firstUserCandidate && candidate.role === "user") next.firstUserCandidate = candidate;
    next.latestCandidate = candidate;
  }
  return next;
}

function summaryCandidateFromMessage(message: ConversationMessage, index: number): ConversationSummaryCandidate | undefined {
  if (!isConversationSummaryCandidate(message)) return undefined;
  const titleText = summaryText(message.text, TITLE_MAX_LENGTH);
  if (!titleText) return undefined;
  return { index, id: message.id, role: message.role, projectId: message.projectId, titleText, detailText: summaryText(message.text, DETAIL_MAX_LENGTH) ?? "" };
}

function summaryFromProjection(runtimeId: string, projection: ConversationSummaryProjection): RuntimeConversationSummary | undefined {
  const titleCandidate = projection.firstUserCandidate ?? projection.firstCandidate;
  if (!titleCandidate) return undefined;
  const detail = projection.latestCandidate && projection.latestCandidate.id !== titleCandidate.id && projection.latestCandidate.detailText ? `${messageRolePrefix(projection.latestCandidate)}：${projection.latestCandidate.detailText}` : undefined;
  return {
    runtimeId,
    projectId: titleCandidate.projectId,
    title: titleCandidate.titleText,
    detail,
    updatedAt: projection.updatedAt || undefined,
    messageCount: projection.messageCount,
    latestAssistantCompletedAt: projection.latestAssistantCompletedAt || undefined,
  };
}

function mergeRuntimeConversationSummary(previous: RuntimeConversationSummary | undefined, summary: RuntimeConversationSummary): RuntimeConversationSummary {
  return previous
    ? {
        ...summary,
        title: previous.title || summary.title,
        detail: summary.detail ?? previous.detail,
        updatedAt: Math.max(previous.updatedAt ?? 0, summary.updatedAt ?? 0) || undefined,
        messageCount: Math.max(previous.messageCount, summary.messageCount),
        latestAssistantCompletedAt: Math.max(previous.latestAssistantCompletedAt ?? 0, summary.latestAssistantCompletedAt ?? 0) || undefined,
      }
    : summary;
}

function assistantCompletedAt(message: ConversationMessage): number {
  if (message.role !== "assistant" || message.isStreaming || !message.text.trim()) return 0;
  return message.updatedAt ?? message.timestamp ?? 0;
}

function isConversationSummaryCandidate(message: ConversationMessage): boolean {
  if (isLeakedToolCallMessage(message)) return false;
  return message.role === "user" || message.role === "assistant";
}

function messageRolePrefix(message: Pick<ConversationMessage, "role">): string {
  return message.role === "user" ? "你" : "Pi";
}

function summaryText(value: string, maxLength: number): string | undefined {
  const normalized = stripSerializedToolCallsFromText(value)
    .replace(/```[\s\S]*?```/g, "代码块")
    .replace(/`([^`]+)`/g, "$1")
    .replace(/\s+/g, " ")
    .trim();
  if (!normalized) return undefined;
  return normalized.length > maxLength ? `${normalized.slice(0, Math.max(0, maxLength - 1))}…` : normalized;
}
