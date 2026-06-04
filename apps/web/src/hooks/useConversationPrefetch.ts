import { useCallback, useEffect, useRef } from "react";
import type { ClientCommand, Runtime, RuntimeConversationSummary } from "@pi-gui/shared";
import type { ConnectionState } from "../types";

const SIDEBAR_CONVERSATION_PREFETCH_LIMIT = 120;
const SIDEBAR_CONVERSATION_PREFETCH_MAX = 80;

type UseConversationPrefetchOptions = {
  connection: ConnectionState;
  activeRuntime?: Runtime;
  runtimes: Runtime[];
  busyByRuntime: Record<string, boolean>;
  conversationSummaries: Record<string, RuntimeConversationSummary>;
  showArchived: boolean;
  send: (command: ClientCommand) => boolean;
};

export function useConversationPrefetch({
  connection,
  activeRuntime,
  runtimes,
  busyByRuntime,
  conversationSummaries,
  showArchived,
  send,
}: UseConversationPrefetchOptions) {
  const openedRuntimeIdsRef = useRef<Set<string>>(new Set());
  const prefetchedRuntimeIdsRef = useRef<Set<string>>(new Set());

  const clearConversationPrefetchState = useCallback(() => {
    openedRuntimeIdsRef.current.clear();
    prefetchedRuntimeIdsRef.current.clear();
  }, []);

  const markRuntimeConversationStale = useCallback((runtimeId: string) => {
    openedRuntimeIdsRef.current.delete(runtimeId);
  }, []);

  useEffect(() => {
    if (connection === "open") return;
    clearConversationPrefetchState();
  }, [connection, clearConversationPrefetchState]);

  useEffect(() => {
    if (connection !== "open" || !activeRuntime) return;
    if (openedRuntimeIdsRef.current.has(activeRuntime.id)) return;
    openedRuntimeIdsRef.current.add(activeRuntime.id);
    send({ type: "conversation.open", runtimeId: activeRuntime.id, limit: 120 });
  }, [connection, activeRuntime?.id, send]);

  useEffect(() => {
    if (connection !== "open") return;
    const remainingBudget = SIDEBAR_CONVERSATION_PREFETCH_MAX - prefetchedRuntimeIdsRef.current.size;
    if (remainingBudget <= 0) return;

    const candidates = runtimes
      .filter((runtime) => (showArchived || !runtime.archivedAt) && runtime.id !== activeRuntime?.id)
      .sort((left, right) => prefetchPriority(right, busyByRuntime, conversationSummaries) - prefetchPriority(left, busyByRuntime, conversationSummaries))
      .slice(0, remainingBudget);

    for (const runtime of candidates) {
      if (prefetchedRuntimeIdsRef.current.has(runtime.id)) continue;
      if (send({ type: "conversation.open", runtimeId: runtime.id, limit: SIDEBAR_CONVERSATION_PREFETCH_LIMIT })) {
        prefetchedRuntimeIdsRef.current.add(runtime.id);
      }
    }
  }, [connection, runtimes, activeRuntime?.id, busyByRuntime, conversationSummaries, showArchived, send]);

  return { clearConversationPrefetchState, markRuntimeConversationStale };
}

function prefetchPriority(
  runtime: Runtime,
  busyByRuntime: Record<string, boolean>,
  conversationSummaries: Record<string, RuntimeConversationSummary>,
): number {
  if (busyByRuntime[runtime.id]) return 40;
  if (runtime.status === "running" || runtime.status === "starting") return 30;
  if (conversationSummaries[runtime.id]) return 20;
  return 10;
}
