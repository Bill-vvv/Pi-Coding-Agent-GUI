import { useEffect, useMemo, useReducer, useState } from "react";
import type { ServerEvent, SubagentRun } from "@pi-gui/shared";
import { AppModals } from "./components/AppModals";
import { ChatView } from "./components/ChatView";
import { Composer } from "./components/Composer";
import { Sidebar } from "./components/Sidebar";
import { SubagentDetailDrawer } from "./components/SubagentDetailDrawer";
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
import { subagentCopyText, subagentDetailKey, subagentRunIsActive } from "./domain/subagents";
import { appReducer, initialAppState } from "./state/appReducer";

export function App() {
  const [state, dispatch] = useReducer(appReducer, initialAppState);
  const models = useModelCatalog();
  const { modelPickerOpen, setModelPickerOpen, settingsOpen, setSettingsOpen, toggleModelPicker, closeModelPicker, closeSettings } = useAppModalState();
  const commandMenuOpenSignal = useCommandMenuHotkey();
  const { uiPreferences, setUiPreferences } = useUiPreferences();
  const [subagentDrawer, setSubagentDrawer] = useState<{ runId: string; childRunId?: string } | undefined>();

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
    subagentRuns,
    subagentDetails,
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

  const activeRuntimeSubagentRuns = useMemo(
    () => Object.values(subagentRuns).filter((run) => run.parentRuntimeId === activeRuntime?.id),
    [activeRuntime?.id, subagentRuns],
  );
  const selectedSubagentRun = subagentDrawer ? subagentRuns[subagentDrawer.runId] : undefined;
  const selectedSubagentChildRunId = selectedSubagentRun ? subagentDrawer?.childRunId ?? selectedSubagentRun.runs[0]?.id : undefined;
  const selectedSubagentDetail = selectedSubagentRun && selectedSubagentChildRunId ? subagentDetails[subagentDetailKey(selectedSubagentRun.id, selectedSubagentChildRunId)] : undefined;
  const selectedSubagentRunIsActive = selectedSubagentRun ? subagentRunIsActive(selectedSubagentRun) : false;

  useEffect(() => {
    if (!selectedSubagentRun || !selectedSubagentChildRunId) return;
    requestSubagentDetail(selectedSubagentRun.id, selectedSubagentChildRunId);
    if (!selectedSubagentRunIsActive) return;
    const timer = window.setInterval(() => requestSubagentDetail(selectedSubagentRun.id, selectedSubagentChildRunId), 1600);
    return () => window.clearInterval(timer);
  }, [selectedSubagentRun?.id, selectedSubagentRunIsActive, selectedSubagentChildRunId, send]);

  function handleServerEvent(event: ServerEvent) {
    dispatch({ type: "server.event", event });
    handleServerSideEffects(event);
  }

  function handleServerSideEffects(event: ServerEvent) {
    handleProjectRuntimeServerEvent(event);
    handleSessionRestoreServerEvent(event);
    handleExtensionUiServerEvent(event);
  }

  function requestSubagentDetail(runId: string, childRunId?: string) {
    send({ type: "subagent.detail.open", runId, childRunId, limit: 240 }, { notifyOnDisconnected: false });
  }

  function copySubagentOutput(run: SubagentRun) {
    const text = subagentCopyText(run);
    if (!text) return;
    void navigator.clipboard.writeText(text).then(
      () => dispatch({ type: "set.notice", notice: "已复制子代理结果" }),
      () => dispatch({ type: "set.operationError", error: "复制子代理结果失败" }),
    );
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
        subagentRuns={subagentRuns}
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
          subagentRuns={activeRuntimeSubagentRuns}
          onOpenSubagentRun={(runId) => setSubagentDrawer({ runId })}
          onCopySubagentOutput={copySubagentOutput}
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

      <SubagentDetailDrawer
        run={selectedSubagentRun}
        selectedChildRunId={selectedSubagentChildRunId}
        detail={selectedSubagentDetail}
        onClose={() => setSubagentDrawer(undefined)}
        onSelectChildRun={(childRunId) => selectedSubagentRun && setSubagentDrawer({ runId: selectedSubagentRun.id, childRunId })}
      />

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
