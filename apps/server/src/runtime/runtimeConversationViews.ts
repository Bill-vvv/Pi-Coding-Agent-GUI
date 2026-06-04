import type { Runtime, RuntimeConversationSummary, ServerEvent } from "@pi-gui/shared";
import type { AppDatabase } from "../db.js";
import { runtimeConversationSummaryFromMessages } from "../db/summaries.js";
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
