import { useReducer } from "react";
import type { ServerEvent } from "@pi-gui/shared";
import { AppModals } from "./components/AppModals";
import { ChatView } from "./components/ChatView";
import { Composer } from "./components/Composer";
import { ModelDebugPage } from "./components/ModelDebugPage";
import { Sidebar } from "./components/Sidebar";
import { ThinkingAnimationLab } from "./components/ThinkingAnimationLab";
import { useActiveRuntimeView } from "./hooks/useActiveRuntimeView";
import { useAppModalState } from "./hooks/useAppModalState";
import { useCommandMenuHotkey } from "./hooks/useCommandMenuHotkey";
import { useComposerCommands } from "./hooks/useComposerCommands";
import { useConversationPrefetch } from "./hooks/useConversationPrefetch";
import { useDebugRoutes } from "./hooks/useDebugRoutes";
import { useExtensionUiRequests } from "./hooks/useExtensionUiRequests";
import { useGuiSocket } from "./hooks/useGuiSocket";
import { useModelCatalog } from "./hooks/useModelCatalog";
import { useModelRuntimeSettings } from "./hooks/useModelRuntimeSettings";
import { usePathPickerFlow } from "./hooks/usePathPickerFlow";
import { useProjectRuntimeActions } from "./hooks/useProjectRuntimeActions";
import { useRuntimeCommandRefresh } from "./hooks/useRuntimeCommandRefresh";
import { useSessionRestoreActions } from "./hooks/useSessionRestoreActions";
import { useUiPreferences } from "./hooks/useUiPreferences";
import { appReducer, initialAppState } from "./state/appReducer";

export function App() {
  const [state, dispatch] = useReducer(appReducer, initialAppState);
  const models = useModelCatalog();
  const { modelPickerOpen, setModelPickerOpen, settingsOpen, setSettingsOpen, toggleModelPicker, closeModelPicker, closeSettings } = useAppModalState();
  const commandMenuOpenSignal = useCommandMenuHotkey();
  const { uiPreferences, setUiPreferences } = useUiPreferences();
  const { debugRoute, showThinkingPreview } = useDebugRoutes();

  const {
    projects,
    runtimes,
    sessions,
    messagesByRuntime,
    busyByRuntime,
    projectCwd,
    settings,
    selectedModelKey: defaultModelKey,
    selectedThinkingLevel: defaultThinkingLevel,
    responseMode: defaultResponseMode,
    lastError,
    showArchived,
  } = state;

  const { connection, send, connectionWarning } = useGuiSocket({
    onEvent: handleServerEvent,
    onError: (message) => dispatch({ type: "set.lastError", error: message }),
    onOpen: () => dispatch({ type: "clear.transportError" }),
  });
  const {
    selectedProject,
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
  } = useActiveRuntimeView(state, models);
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
  useRuntimeCommandRefresh({ connection, activeRuntime, send });

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
          connectionWarning={connectionWarning}
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
          onToggleModelPicker={toggleModelPicker}
          onCloseModelPicker={closeModelPicker}
          onChooseModel={chooseModel}
          onChooseThinkingLevel={chooseThinkingLevel}
          onChooseResponseMode={chooseResponseMode}
        />
      </section>


      <AppModals
        extensionUiRequest={extensionUiDialog?.request}
        onRespondExtensionUi={sendExtensionUiResponse}
        settingsOpen={settingsOpen}
        preferences={uiPreferences}
        onCloseSettings={closeSettings}
        onChangePreferences={setUiPreferences}
        sessionHistoryProject={sessionHistoryProject}
        sessions={sessions}
        runtimes={runtimes}
        connection={connection}
        pendingHistoryRestoreId={pendingHistoryRestoreId}
        onCloseSessionHistory={closeSessionHistory}
        onResumeSession={resumeSessionFromHistory}
        onSelectRuntime={(projectId: string, runtimeId: string) => dispatch({ type: "select.runtime", projectId, runtimeId })}
        pathPicker={pathPicker}
        onChoosePickerCwd={choosePickerCwd}
        pathPickerTitle={pathPickerTitle}
        pathPickerConfirmLabel={pathPickerConfirmLabel}
      />
    </main>
  );
}
