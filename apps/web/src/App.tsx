import { useEffect, useMemo, useReducer, useState } from "react";
import type { ServerEvent } from "@pi-gui/shared";
import { ChatView } from "./components/ChatView";
import { Composer } from "./components/Composer";
import { ExtensionUiDialog } from "./components/ExtensionUiDialog";
import { ModelDebugPage } from "./components/ModelDebugPage";
import { PathPickerModal } from "./components/PathPickerModal";
import { SessionHistoryModal } from "./components/SessionHistoryModal";
import { SettingsModal } from "./components/SettingsModal";
import { Sidebar } from "./components/Sidebar";
import { ThinkingAnimationLab } from "./components/ThinkingAnimationLab";
import { mergeConversationSummaries } from "./domain/conversationSummary";
import { modelKey, modelSummaryFromKey, THINKING_LEVELS } from "./domain/models";
import { useComposerCommands } from "./hooks/useComposerCommands";
import { useConversationPrefetch } from "./hooks/useConversationPrefetch";
import { useExtensionUiRequests } from "./hooks/useExtensionUiRequests";
import { useGuiSocket } from "./hooks/useGuiSocket";
import { useModelCatalog } from "./hooks/useModelCatalog";
import { useModelRuntimeSettings } from "./hooks/useModelRuntimeSettings";
import { usePathPickerFlow } from "./hooks/usePathPickerFlow";
import { useProjectRuntimeActions } from "./hooks/useProjectRuntimeActions";
import { useSessionRestoreActions } from "./hooks/useSessionRestoreActions";
import { useUiPreferences } from "./hooks/useUiPreferences";
import { appReducer, initialAppState } from "./state/appReducer";

export function App() {
  const [state, dispatch] = useReducer(appReducer, initialAppState);
  const models = useModelCatalog();
  const [modelPickerOpen, setModelPickerOpen] = useState(false);
  const [settingsOpen, setSettingsOpen] = useState(false);
  const [commandMenuOpenSignal, setCommandMenuOpenSignal] = useState(0);
  const { uiPreferences, setUiPreferences } = useUiPreferences();
  const debugRoute = useMemo(() => {
    const params = new URLSearchParams(window.location.search);
    return window.location.pathname === "/debug/models" || params.has("modelDebug");
  }, []);
  const showThinkingPreview = useMemo(() => new URLSearchParams(window.location.search).has("thinkingPreview"), []);

  const {
    projects,
    runtimes,
    sessions,
    messagesByRuntime,
    persistedConversationSummaries,
    contextUsageByRuntime,
    busyByRuntime,
    commandsByRuntime,
    selectedProjectId,
    selectedRuntimeId,
    projectCwd,
    settings,
    selectedModelKey: defaultModelKey,
    selectedThinkingLevel: defaultThinkingLevel,
    responseMode: defaultResponseMode,
    lastError,
    showArchived,
  } = state;

  const { connection, send } = useGuiSocket({
    onEvent: handleServerEvent,
    onError: (message) => dispatch({ type: "set.lastError", error: message }),
    onOpen: () => dispatch({ type: "set.lastError", error: undefined }),
  });
  const selectedProject = projects.find((project) => project.id === selectedProjectId) ?? projects[0];
  const selectedProjectRuntimes = useMemo(
    () => runtimes.filter((runtime) => runtime.projectId === selectedProject?.id),
    [runtimes, selectedProject?.id],
  );
  const visibleProjectRuntimes = useMemo(
    () => selectedProjectRuntimes.filter((runtime) => showArchived || !runtime.archivedAt),
    [selectedProjectRuntimes, showArchived],
  );
  const selectedRuntime = selectedRuntimeId ? visibleProjectRuntimes.find((runtime) => runtime.id === selectedRuntimeId) : undefined;
  const activeRuntime = selectedRuntime ?? visibleProjectRuntimes.find((runtime) => runtime.status === "running") ?? visibleProjectRuntimes[0];
  const activeRuntimeModelKey = activeRuntime ? activeRuntime.model : defaultModelKey;
  const selectedModel = activeRuntimeModelKey
    ? models.find((model) => modelKey(model) === activeRuntimeModelKey) ?? modelSummaryFromKey(activeRuntimeModelKey)
    : undefined;
  const selectedThinkingLevel = activeRuntime ? activeRuntime.thinkingLevel ?? "medium" : defaultThinkingLevel;
  const responseMode = activeRuntime ? activeRuntime.responseMode ?? "normal" : defaultResponseMode;
  const availableThinkingLevels = selectedModel?.supportedThinkingLevels ?? THINKING_LEVELS.map((level) => level.value);
  const conversationMessages = activeRuntime ? messagesByRuntime[activeRuntime.id] ?? [] : [];
  const lastAssistantText = [...conversationMessages].reverse().find((message) => message.role === "assistant" && message.text.trim())?.text;
  const conversationSummaries = useMemo(
    () => mergeConversationSummaries(persistedConversationSummaries, messagesByRuntime),
    [persistedConversationSummaries, messagesByRuntime],
  );
  const activeRuntimeConversationSummary = activeRuntime ? conversationSummaries[activeRuntime.id] : undefined;
  const activeRuntimeContextUsage = activeRuntime ? contextUsageByRuntime[activeRuntime.id] : undefined;
  const activeRuntimeCommands = activeRuntime ? commandsByRuntime[activeRuntime.id] ?? [] : [];
  const activeRuntimeIsBusy = activeRuntime ? busyByRuntime[activeRuntime.id] ?? false : false;
  const { markRuntimeConversationStale } = useConversationPrefetch({
    connection,
    activeRuntime,
    runtimes,
    busyByRuntime,
    conversationSummaries,
    showArchived,
    send,
  });
  const { defaultRuntimeModelKey, chooseModel, chooseThinkingLevel, chooseResponseMode } = useModelRuntimeSettings({
    models,
    settings,
    defaultModelKey,
    defaultThinkingLevel,
    defaultResponseMode,
    activeRuntime,
    responseMode,
    dispatch,
    send,
  });
  const {
    sessionHistoryProjectId,
    pendingHistoryRestoreId,
    openSessionHistory,
    closeSessionHistory,
    resumeSessionFromHistory,
    handleSessionRestoreServerEvent,
  } = useSessionRestoreActions({
    defaultRuntimeModelKey,
    defaultThinkingLevel,
    defaultResponseMode,
    send,
  });
  const sessionHistoryProject = sessionHistoryProjectId ? projects.find((project) => project.id === sessionHistoryProjectId) : undefined;
  const {
    prompt,
    setPrompt,
    createProjectOnly,
    startRuntimeForSidebarProject,
    archiveRuntime,
    submitPrompt,
    handleProjectRuntimeServerEvent,
  } = useProjectRuntimeActions({
    projects,
    runtimes,
    messagesByRuntime,
    conversationSummaries,
    activeRuntime,
    activeRuntimeIsBusy,
    selectedProject,
    projectCwd,
    defaultRuntimeModelKey,
    defaultThinkingLevel,
    defaultResponseMode,
    dispatch,
    send,
    markRuntimeConversationStale,
  });
  const { pathPicker, openPathPicker, choosePickerCwd, title: pathPickerTitle, confirmLabel: pathPickerConfirmLabel } = usePathPickerFlow({
    projectCwd,
    createProjectOnly,
    dispatch,
  });
  const { extensionUiDialog, handleExtensionUiServerEvent, sendExtensionUiResponse } = useExtensionUiRequests({
    dispatch,
    send,
    setPrompt,
  });
  const { executeCommandInput } = useComposerCommands({
    activeRuntime,
    activeRuntimeIsBusy,
    selectedProject,
    lastAssistantText,
    dispatch,
    send,
    setPrompt,
    setModelPickerOpen,
    setSettingsOpen,
    openSessionHistory,
    startRuntimeForSidebarProject,
  });

  useEffect(() => {
    if (connection !== "open" || activeRuntime?.status !== "running") return;
    send({ type: "runtime.commands.list", runtimeId: activeRuntime.id });
  }, [activeRuntime?.id, activeRuntime?.status, connection, send]);

  useEffect(() => {
    function handleKeyDown(event: KeyboardEvent) {
      if ((event.metaKey || event.ctrlKey) && event.key.toLowerCase() === "k") {
        event.preventDefault();
        setCommandMenuOpenSignal((value) => value + 1);
      }
    }
    window.addEventListener("keydown", handleKeyDown);
    return () => window.removeEventListener("keydown", handleKeyDown);
  }, []);

  if (debugRoute) return <ModelDebugPage />;
  if (showThinkingPreview) return <ThinkingAnimationLab />;

  function handleServerEvent(event: ServerEvent) {
    dispatch({ type: "server.event", event });
    handleServerSideEffects(event);
  }

  function handleServerSideEffects(event: ServerEvent) {
    handleProjectRuntimeServerEvent(event);
    handleSessionRestoreServerEvent(event);
    handleExtensionUiServerEvent(event);
  }

  return (
    <main className="app-shell">
      <Sidebar
        connection={connection}
        projects={projects}
        runtimes={runtimes}
        sessions={sessions}
        selectedProject={selectedProject}
        activeRuntime={activeRuntime}
        showArchived={showArchived}
        activeRuntimeIsBusy={activeRuntimeIsBusy}
        busyByRuntime={busyByRuntime}
        messagesByRuntime={messagesByRuntime}
        onAddProject={() => void openPathPicker("addProject")}
        onStartRuntimeForProject={startRuntimeForSidebarProject}
        onOpenSessionHistory={openSessionHistory}
        onSelectProject={(projectId) => dispatch({ type: "select.project", projectId })}
        onSelectRuntime={(projectId, runtimeId) => dispatch({ type: "select.runtime", projectId, runtimeId })}
        onArchiveRuntime={archiveRuntime}
        onOpenSettings={() => setSettingsOpen(true)}
        conversationSummaries={conversationSummaries}
      />

      <section className="main-chat">
        <ChatView
          lastError={lastError}
          activeRuntime={activeRuntime}
          conversationSummary={activeRuntimeConversationSummary}
          messages={conversationMessages}
          activeRuntimeIsBusy={activeRuntimeIsBusy}
        />

        <Composer
          prompt={prompt}
          projectCwd={projectCwd}
          selectedProject={selectedProject}
          models={models}
          selectedModel={selectedModel}
          selectedThinkingLevel={selectedThinkingLevel}
          availableThinkingLevels={availableThinkingLevels}
          responseMode={responseMode}
          modelPickerOpen={modelPickerOpen}
          contextUsage={activeRuntimeContextUsage}
          slashCommands={activeRuntimeCommands}
          commandMenuOpenSignal={commandMenuOpenSignal}
          connection={connection}
          activeRuntime={activeRuntime}
          activeRuntimeIsBusy={activeRuntimeIsBusy}
          onSubmit={submitPrompt}
          onPromptChange={setPrompt}
          onExecuteCommandInput={executeCommandInput}
          onOpenPathPicker={() => void openPathPicker("composer")}
          onAbortRuntime={(runtimeId) => send({ type: "runtime.abort", runtimeId })}
          onToggleModelPicker={() => setModelPickerOpen((value) => !value)}
          onCloseModelPicker={() => setModelPickerOpen(false)}
          onChooseModel={chooseModel}
          onChooseThinkingLevel={chooseThinkingLevel}
          onChooseResponseMode={chooseResponseMode}
        />
      </section>


      <ExtensionUiDialog
        request={extensionUiDialog?.request}
        onRespond={sendExtensionUiResponse}
        onCancel={() => sendExtensionUiResponse({ cancelled: true })}
      />

      <SettingsModal
        open={settingsOpen}
        preferences={uiPreferences}
        onClose={() => setSettingsOpen(false)}
        onChangePreferences={setUiPreferences}
      />

      <SessionHistoryModal
        open={Boolean(sessionHistoryProject)}
        project={sessionHistoryProject}
        sessions={sessions}
        runtimes={runtimes}
        connection={connection}
        pendingRestoreId={pendingHistoryRestoreId}
        onClose={closeSessionHistory}
        onResumeSession={resumeSessionFromHistory}
        onSelectRuntime={(projectId: string, runtimeId: string) => dispatch({ type: "select.runtime", projectId, runtimeId })}
      />

      <PathPickerModal
        open={pathPicker.open}
        cwd={pathPicker.cwd}
        parent={pathPicker.parent}
        entries={pathPicker.entries}
        loading={pathPicker.loading}
        error={pathPicker.error}
        onClose={pathPicker.closePicker}
        onLoadDirectory={pathPicker.loadDirectory}
        onChooseCurrentCwd={choosePickerCwd}
        title={pathPickerTitle}
        confirmLabel={pathPickerConfirmLabel}
      />
    </main>
  );
}
