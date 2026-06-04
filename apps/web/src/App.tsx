import { useReducer } from "react";
import type { ServerEvent } from "@pi-gui/shared";
import { AppModals } from "./components/AppModals";
import { ChatView } from "./components/ChatView";
import { Composer } from "./components/Composer";
import { Sidebar } from "./components/Sidebar";
import { useActiveRuntimeView } from "./hooks/useActiveRuntimeView";
import { useAppModalState } from "./hooks/useAppModalState";
import { useCommandMenuHotkey } from "./hooks/useCommandMenuHotkey";
import { useComposerCommands } from "./hooks/useComposerCommands";
import { useConversationPrefetch } from "./hooks/useConversationPrefetch";
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
    operationError,
    notice,
  } = state;

  const { connection, send, connectionWarning } = useGuiSocket({
    onEvent: handleServerEvent,
    onError: (message) => dispatch({ type: "set.operationError", error: message }),
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
          operationError={operationError}
          notice={notice}
          connectionWarning={connectionWarning}
          activeRuntime={activeRuntime}
          conversationSummary={activeRuntimeConversationSummary}
          messages={conversationMessages}
          activeRuntimeIsBusy={activeRuntimeIsBusy}
          onDismissOperationError={() => dispatch({ type: "clear.operationError" })}
          onDismissNotice={() => dispatch({ type: "clear.notice" })}
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
        projects={projects}
        conversationSummaries={conversationSummaries}
        messagesByRuntime={messagesByRuntime}
        onCloseSettings={closeSettings}
        onChangePreferences={setUiPreferences}
        onOpenArchivedRuntime={(runtimeId: string) => {
          send({ type: "conversation.open", runtimeId, limit: 200 }, { notifyOnDisconnected: false });
        }}
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
