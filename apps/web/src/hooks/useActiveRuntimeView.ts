import { useMemo, useRef } from "react";
import type { ModelSummary } from "@pi-gui/shared";
import { mergeConversationSummariesCached, type ConversationSummaryMergeCache } from "../domain/conversationSummary";
import { modelKey, modelSummaryFromKey, THINKING_LEVELS } from "../domain/models";
import type { AppState } from "../state/appReducer";
import type { ConversationMessage } from "../types";

export function useActiveRuntimeView(state: AppState, models: ModelSummary[]) {
  const conversationSummaryCacheRef = useRef<ConversationSummaryMergeCache | undefined>(undefined);
  const {
    projects,
    runtimes,
    messagesByRuntime,
    persistedConversationSummaries,
    contextUsageByRuntime,
    busyByRuntime,
    queueByRuntime,
    commandsByRuntime,
    selectedProjectId,
    selectedRuntimeId,
    selectedModelKey: defaultModelKey,
    selectedThinkingLevel: defaultThinkingLevel,
    responseMode: defaultResponseMode,
  } = state;

  const selectedProject = useMemo(
    () => projects.find((project) => project.id === selectedProjectId) ?? projects[0],
    [projects, selectedProjectId],
  );
  const selectedProjectRuntimes = useMemo(
    () => runtimes.filter((runtime) => runtime.projectId === selectedProject?.id),
    [runtimes, selectedProject?.id],
  );
  const visibleProjectRuntimes = useMemo(
    () => selectedProjectRuntimes.filter((runtime) => !runtime.archivedAt),
    [selectedProjectRuntimes],
  );
  const selectedRuntime = useMemo(
    () => (selectedRuntimeId ? visibleProjectRuntimes.find((runtime) => runtime.id === selectedRuntimeId) : undefined),
    [selectedRuntimeId, visibleProjectRuntimes],
  );
  const activeRuntime = selectedRuntime;
  const selectedModel = useMemo(() => {
    const activeRuntimeModelKey = activeRuntime ? activeRuntime.model : defaultModelKey;
    return activeRuntimeModelKey
      ? models.find((model) => modelKey(model) === activeRuntimeModelKey) ?? modelSummaryFromKey(activeRuntimeModelKey)
      : undefined;
  }, [activeRuntime, defaultModelKey, models]);
  const selectedThinkingLevel = activeRuntime ? activeRuntime.thinkingLevel ?? "medium" : defaultThinkingLevel;
  const responseMode = activeRuntime ? activeRuntime.responseMode ?? "normal" : defaultResponseMode;
  const availableThinkingLevels = selectedModel?.supportedThinkingLevels ?? THINKING_LEVELS.map((level) => level.value);
  const conversationMessages = useMemo(
    () => (activeRuntime ? messagesByRuntime[activeRuntime.id] ?? [] : []),
    [activeRuntime, messagesByRuntime],
  );
  const lastAssistantText = useMemo(() => latestAssistantText(conversationMessages), [conversationMessages]);
  const conversationSummaries = useMemo(() => {
    const cache = mergeConversationSummariesCached(persistedConversationSummaries, messagesByRuntime, conversationSummaryCacheRef.current);
    conversationSummaryCacheRef.current = cache;
    return cache.summaries;
  }, [persistedConversationSummaries, messagesByRuntime]);
  const activeRuntimeConversationSummary = activeRuntime ? conversationSummaries[activeRuntime.id] : undefined;
  const activeRuntimeContextUsage = activeRuntime ? contextUsageByRuntime[activeRuntime.id] : undefined;
  const activeRuntimeQueue = activeRuntime ? queueByRuntime[activeRuntime.id] : undefined;
  const activeRuntimeCommands = activeRuntime ? commandsByRuntime[activeRuntime.id] ?? [] : [];
  const activeRuntimeIsBusy = activeRuntime ? busyByRuntime[activeRuntime.id] ?? false : false;

  return {
    selectedProject,
    selectedProjectRuntimes,
    visibleProjectRuntimes,
    selectedRuntime,
    activeRuntime,
    selectedModel,
    selectedThinkingLevel,
    responseMode,
    availableThinkingLevels,
    conversationMessages,
    lastAssistantText,
    conversationSummaries,
    activeRuntimeConversationSummary,
    activeRuntimeContextUsage,
    activeRuntimeQueue,
    activeRuntimeCommands,
    activeRuntimeIsBusy,
  };
}

function latestAssistantText(messages: ConversationMessage[]): string | undefined {
  for (let index = messages.length - 1; index >= 0; index -= 1) {
    const message = messages[index];
    if (message?.role === "assistant" && message.text.trim()) return message.text;
  }
  return undefined;
}
