import { useMemo } from "react";
import type { ModelSummary } from "@pi-gui/shared";
import { mergeConversationSummaries } from "../domain/conversationSummary";
import { modelKey, modelSummaryFromKey, THINKING_LEVELS } from "../domain/models";
import type { AppState } from "../state/appReducer";

export function useActiveRuntimeView(state: AppState, models: ModelSummary[]) {
  const {
    projects,
    runtimes,
    messagesByRuntime,
    persistedConversationSummaries,
    contextUsageByRuntime,
    busyByRuntime,
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
  const activeRuntime = useMemo(
    () => selectedRuntime ?? visibleProjectRuntimes.find((runtime) => runtime.status === "running") ?? visibleProjectRuntimes[0],
    [selectedRuntime, visibleProjectRuntimes],
  );
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
  const lastAssistantText = useMemo(
    () => [...conversationMessages].reverse().find((message) => message.role === "assistant" && message.text.trim())?.text,
    [conversationMessages],
  );
  const conversationSummaries = useMemo(
    () => mergeConversationSummaries(persistedConversationSummaries, messagesByRuntime),
    [persistedConversationSummaries, messagesByRuntime],
  );
  const activeRuntimeConversationSummary = activeRuntime ? conversationSummaries[activeRuntime.id] : undefined;
  const activeRuntimeContextUsage = activeRuntime ? contextUsageByRuntime[activeRuntime.id] : undefined;
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
    activeRuntimeCommands,
    activeRuntimeIsBusy,
  };
}
