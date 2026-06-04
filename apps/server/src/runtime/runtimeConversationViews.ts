import type { Runtime, RuntimeConversationSummary, ServerEvent } from "@pi-gui/shared";
import type { AppDatabase } from "../db.js";
import { runtimeConversationSummaryFromMessages } from "../db/summaries.js";
import { readPiSessionConversationSummary } from "../services/sessionIndexService.js";
import type { ManagedRuntime } from "./managedRuntime.js";

export function buildRuntimeConversationSummaries({
  db,
  liveRuntimes,
  orderedRuntimes,
  limit = 100,
}: {
  db: AppDatabase;
  liveRuntimes: Iterable<ManagedRuntime>;
  orderedRuntimes: Runtime[];
  limit?: number;
}): RuntimeConversationSummary[] {
  const boundedLimit = Math.max(1, Math.min(limit, 500));
  const summaries = new Map(db.listRuntimeConversationSummaries(boundedLimit).map((summary) => [summary.runtimeId, summary]));

  for (const managed of liveRuntimes) {
    const snapshot = managed.projection.snapshot(120);
    if (snapshot?.type !== "conversation.snapshot") continue;

    const liveSummary = runtimeConversationSummaryFromMessages(managed.runtime.id, snapshot.messages);
    if (!liveSummary) continue;

    const persistedSummary = summaries.get(liveSummary.runtimeId);
    if (!persistedSummary) {
      summaries.set(liveSummary.runtimeId, liveSummary);
      continue;
    }

    summaries.set(liveSummary.runtimeId, {
      ...liveSummary,
      title: persistedSummary.title || liveSummary.title,
      detail: liveSummary.detail ?? (liveSummary.title !== persistedSummary.title ? liveSummary.title : persistedSummary.detail),
      updatedAt: Math.max(persistedSummary.updatedAt ?? 0, liveSummary.updatedAt ?? 0) || undefined,
      messageCount: Math.max(persistedSummary.messageCount, liveSummary.messageCount),
      latestAssistantCompletedAt: Math.max(persistedSummary.latestAssistantCompletedAt ?? 0, liveSummary.latestAssistantCompletedAt ?? 0) || undefined,
    });
  }

  for (const runtime of orderedRuntimes) {
    if (!runtime.sessionId) continue;
    const existingSummary = summaries.get(runtime.id);
    if (existingSummary?.title && existingSummary.detail) continue;

    const session = db.getSession(runtime.sessionId);
    if (!session) continue;
    const fileSummary = readPiSessionConversationSummary(session.piSessionFile);
    if (!fileSummary && !session.title) continue;

    summaries.set(runtime.id, {
      runtimeId: runtime.id,
      projectId: runtime.projectId,
      title: existingSummary?.title || session.title || fileSummary?.title || "已保存对话",
      detail: existingSummary?.detail ?? fileSummary?.detail,
      updatedAt: Math.max(existingSummary?.updatedAt ?? 0, fileSummary?.updatedAt ?? 0, session.updatedAt, runtime.startedAt ?? 0) || undefined,
      messageCount: Math.max(existingSummary?.messageCount ?? 0, fileSummary?.messageCount ?? 0),
      latestAssistantCompletedAt: Math.max(existingSummary?.latestAssistantCompletedAt ?? 0, fileSummary?.latestAssistantCompletedAt ?? 0) || undefined,
    });
  }

  const runtimeOrder = new Map(orderedRuntimes.map((runtime, index) => [runtime.id, index]));
  return [...summaries.values()]
    .sort((left, right) => {
      const leftOrder = runtimeOrder.get(left.runtimeId) ?? Number.MAX_SAFE_INTEGER;
      const rightOrder = runtimeOrder.get(right.runtimeId) ?? Number.MAX_SAFE_INTEGER;
      return leftOrder - rightOrder || (right.updatedAt ?? 0) - (left.updatedAt ?? 0);
    })
    .slice(0, boundedLimit);
}

export function runtimeConversationPageBefore(db: AppDatabase, runtimeId: string, beforeMessageId: string, limit?: number): ServerEvent | undefined {
  const runtime = db.getRuntime(runtimeId);
  if (!runtime) return undefined;
  const page = db.listConversationMessagesBefore(runtimeId, beforeMessageId, limit ?? 100);
  return {
    type: "conversation.page",
    runtimeId: runtime.id,
    projectId: runtime.projectId,
    beforeMessageId,
    messages: page.messages,
    hasMoreBefore: page.hasMoreBefore,
  };
}

export function runtimeConversationSnapshot(db: AppDatabase, runtimes: Map<string, ManagedRuntime>, runtimeId: string, limit?: number): ServerEvent | undefined {
  const managed = runtimes.get(runtimeId);
  if (managed) return managed.projection.snapshot(limit);

  const runtime = db.getRuntime(runtimeId);
  if (!runtime) return undefined;
  return {
    type: "conversation.snapshot",
    runtimeId: runtime.id,
    projectId: runtime.projectId,
    messages: db.listConversationMessages(runtime.id, limit ?? 100),
    contextUsage: db.getConversationContext(runtime.id),
    busy: db.getConversationBusy(runtime.id),
  };
}
