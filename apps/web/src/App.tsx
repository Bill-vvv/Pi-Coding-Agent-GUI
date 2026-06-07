import { useCallback, useEffect, useMemo, useReducer, useRef, useState } from "react";
import type { ConversationDelta, ServerEvent, SubagentRun } from "@pi-gui/shared";
import { AppModals } from "./components/AppModals";
import { ChatView } from "./components/ChatView";
import { Composer } from "./components/Composer";
import { Sidebar } from "./components/Sidebar";
import { SettingsPanel } from "./components/SettingsPanel";
import { SubagentDetailDrawer } from "./components/SubagentDetailDrawer";
import { TokenUsageOverview } from "./components/TokenUsageOverview";
import { useActiveRuntimeView } from "./hooks/useActiveRuntimeView";
import { useAppModalState } from "./hooks/useAppModalState";
import { useCheckpointActions } from "./hooks/useCheckpointActions";
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
import { performanceFixtureEvents } from "./domain/performanceFixtures";
import { subagentCopyText, subagentDetailKey, subagentRunIsActive } from "./domain/subagents";
import { appReducer, initialAppState } from "./state/appReducer";

export function App() {
  const [state, dispatch] = useReducer(appReducer, initialAppState);
  const models = useModelCatalog();
  const { modelPickerOpen, setModelPickerOpen, settingsOpen, setSettingsOpen, toggleModelPicker, closeModelPicker, closeSettings } = useAppModalState();
  const commandMenuOpenSignal = useCommandMenuHotkey();
  const { uiPreferences, setUiPreferences } = useUiPreferences();
  const [subagentDrawer, setSubagentDrawer] = useState<{ runId: string; childRunId?: string } | undefined>();
  const pendingConversationDeltasRef = useRef<ConversationDelta[]>([]);
  const conversationDeltaFrameRef = useRef<number | undefined>(undefined);
  const performanceFixtureMode = import.meta.env.DEV && new URLSearchParams(window.location.search).get("fixture") === "performance";
  const [compactSidebarExpanded, setCompactSidebarExpanded] = useState(false);

  const {
    projects,
    runtimes,
    sessions,
    checkpointsByProject,
    messagesByRuntime,
    hasMoreBeforeByRuntime,
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
    extensionUiByRuntime,
  } = state;

  useEffect(() => {
    if (!performanceFixtureMode) return;
    for (const event of performanceFixtureEvents()) dispatch({ type: "server.event", event });
  }, [performanceFixtureMode]);

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
    activeRuntimeQueue,
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
    checkpointPanelProjectId,
    checkpointPanelRuntimeId,
    pendingCheckpointActionId,
    openCheckpointPanel,
    closeCheckpointPanel,
    refreshCheckpoints,
    restoreCheckpoint,
    fastForward,
    handleCheckpointServerEvent,
  } = useCheckpointActions({ send });
  const checkpointPanelProject = checkpointPanelProjectId ? projects.find((project) => project.id === checkpointPanelProjectId) : undefined;
  const checkpointPanelRuntime = checkpointPanelRuntimeId ? runtimes.find((runtime) => runtime.id === checkpointPanelRuntimeId) : activeRuntime;
  const checkpointPanelCheckpoints = checkpointPanelProjectId ? checkpointsByProject[checkpointPanelProjectId] ?? [] : [];
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
    uiPreferences,
    projects,
    runtimes,
    activeRuntime,
    conversationSummaries,
  });
  const { executeCommandInput, handleComposerCommandServerEvent } = useComposerCommands({
    activeRuntime,
    activeRuntimeIsBusy,
    selectedProject,
    lastAssistantText,
    defaultRuntimeModelKey,
    defaultThinkingLevel,
    defaultResponseMode,
    dispatch,
    send,
    setPrompt,
    setModelPickerOpen,
    setSettingsOpen,
    openSessionHistory,
    openCheckpoints: (projectId?: string, runtimeId?: string) => {
      const targetProjectId = projectId ?? selectedProject?.id;
      if (!targetProjectId) {
        dispatch({ type: "set.operationError", error: "请先选择项目" });
        return;
      }
      openCheckpointPanel(targetProjectId, runtimeId ?? activeRuntime?.id);
    },
    startRuntimeForSidebarProject,
  });
  useRuntimeCommandRefresh({ connection, activeRuntime, send });

  const activeRuntimeSubagentRuns = useMemo(
    () => Object.values(subagentRuns).filter((run) => run.parentRuntimeId === activeRuntime?.id),
    [activeRuntime?.id, subagentRuns],
  );
  const activeRuntimeExtensionUi = activeRuntime ? extensionUiByRuntime[activeRuntime.id] : undefined;
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

  useEffect(() => {
    return () => {
      if (conversationDeltaFrameRef.current !== undefined) window.cancelAnimationFrame(conversationDeltaFrameRef.current);
    };
  }, []);

  function handleServerEvent(event: ServerEvent) {
    if (performanceFixtureMode) return;
    if (event.type === "conversation.delta") {
      pendingConversationDeltasRef.current.push(event.delta);
      if (conversationDeltaFrameRef.current === undefined) {
        conversationDeltaFrameRef.current = window.requestAnimationFrame(() => {
          conversationDeltaFrameRef.current = undefined;
          flushConversationDeltas();
        });
      }
      return;
    }

    flushConversationDeltas();
    dispatch({ type: "server.event", event });
    handleServerSideEffects(event);
  }

  function flushConversationDeltas() {
    if (pendingConversationDeltasRef.current.length === 0) return;
    const deltas = pendingConversationDeltasRef.current;
    pendingConversationDeltasRef.current = [];
    dispatch({ type: "server.deltaBatch", deltas });
  }

  function handleServerSideEffects(event: ServerEvent) {
    handleProjectRuntimeServerEvent(event);
    handleSessionRestoreServerEvent(event);
    handleExtensionUiServerEvent(event);
    handleCheckpointServerEvent(event);
    handleComposerCommandServerEvent(event);
  }

  function requestSubagentDetail(runId: string, childRunId?: string) {
    send({ type: "subagent.detail.open", runId, childRunId, limit: 240 }, { notifyOnDisconnected: false });
  }

  const firstActiveConversationMessageId = conversationMessages[0]?.id;
  const loadOlderActiveConversationMessages = useCallback(() => {
    const runtimeId = activeRuntime?.id;
    if (!runtimeId || !firstActiveConversationMessageId) return;
    send({ type: "conversation.page", runtimeId, beforeMessageId: firstActiveConversationMessageId, limit: 200 }, { notifyOnDisconnected: false });
  }, [activeRuntime?.id, firstActiveConversationMessageId, send]);

  const openSubagentRun = useCallback((runId: string) => setSubagentDrawer({ runId }), []);

  const copySubagentOutput = useCallback((run: SubagentRun) => {
    const text = subagentCopyText(run);
    if (!text) return;
    void navigator.clipboard.writeText(text).then(
      () => dispatch({ type: "set.notice", notice: "已复制子代理结果" }),
      () => dispatch({ type: "set.operationError", error: "复制子代理结果失败" }),
    );
  }, []);

  const dismissOperationError = useCallback((expectedError?: string) => dispatch({ type: "clear.operationError", error: expectedError }), []);
  const dismissNotice = useCallback((expectedNotice?: string) => dispatch({ type: "clear.notice", notice: expectedNotice }), []);

  function collapseCompactSidebar() {
    setCompactSidebarExpanded(false);
  }

  function openUsageOverview() {
    closeSettings();
    dispatch({ type: "select.project", projectId: selectedProject?.id });
  }

  return (
    <main className={`app-shell ${compactSidebarExpanded ? "sidebar-compact-expanded" : ""}`}>
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
        compactExpanded={compactSidebarExpanded}
        onToggleCompact={() => setCompactSidebarExpanded((expanded) => !expanded)}
        onAddProject={() => {
          collapseCompactSidebar();
          void openPathPicker("addProject");
        }}
        onStartRuntimeForProject={(projectId) => {
          collapseCompactSidebar();
          startRuntimeForSidebarProject(projectId);
        }}
        onOpenSessionHistory={(projectId) => {
          collapseCompactSidebar();
          openSessionHistory(projectId);
        }}
        onOpenCheckpoints={(projectId, runtimeId) => {
          collapseCompactSidebar();
          openCheckpointPanel(projectId, runtimeId);
        }}
        onSelectProject={(projectId) => {
          collapseCompactSidebar();
          dispatch({ type: "select.project", projectId });
        }}
        onSelectRuntime={(projectId, runtimeId) => {
          collapseCompactSidebar();
          dispatch({ type: "select.runtime", projectId, runtimeId });
        }}
        onArchiveRuntime={archiveRuntime}
        onOpenSettings={() => {
          collapseCompactSidebar();
          setSettingsOpen(true);
        }}
        conversationSummaries={conversationSummaries}
      />

      <section className={`main-chat ${settingsOpen ? "settings-mode" : ""}`}>
        {settingsOpen ? (
          <SettingsPanel
            open={settingsOpen}
            settings={settings}
            preferences={uiPreferences}
            projects={projects}
            sessions={sessions}
            runtimes={runtimes}
            conversationSummaries={conversationSummaries}
            messagesByRuntime={messagesByRuntime}
            onClose={closeSettings}
            onChangePreferences={setUiPreferences}
            onChangeSettings={(nextSettings) => send({ type: "settings.update", settings: nextSettings })}
            onOpenArchivedRuntime={(runtimeId: string) => {
              send({ type: "conversation.open", runtimeId, limit: 200 }, { notifyOnDisconnected: false });
            }}
            onOpenUsageOverview={openUsageOverview}
          />
        ) : !activeRuntime ? (
          <TokenUsageOverview projects={projects} />
        ) : (
          <>
            <ChatView
              operationError={operationError}
              notice={notice}
              connectionWarning={connectionWarning}
              activeRuntime={activeRuntime}
              conversationSummary={activeRuntimeConversationSummary}
              messages={conversationMessages}
              activeRuntimeIsBusy={activeRuntimeIsBusy}
              hasMoreBefore={activeRuntime ? hasMoreBeforeByRuntime[activeRuntime.id] !== false && conversationMessages.length > 0 : false}
              subagentRuns={activeRuntimeSubagentRuns}
              extensionUi={activeRuntimeExtensionUi}
              onLoadOlderMessages={activeRuntime ? loadOlderActiveConversationMessages : undefined}
              onOpenSubagentRun={openSubagentRun}
              onCopySubagentOutput={copySubagentOutput}
              onDismissOperationError={dismissOperationError}
              onDismissNotice={dismissNotice}
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
              activeRuntimeQueue={activeRuntimeQueue}
              slashCommands={activeRuntimeCommands}
              extensionUi={activeRuntimeExtensionUi}
              commandMenuOpenSignal={commandMenuOpenSignal}
              connection={connection}
              activeRuntime={activeRuntime}
              activeRuntimeIsBusy={activeRuntimeIsBusy}
              voiceInputSettings={settings.voiceInput}
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
          </>
        )}
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
        sessionHistoryProject={sessionHistoryProject}
        sessions={sessions}
        runtimes={runtimes}
        connection={connection}
        pendingHistoryRestoreId={pendingHistoryRestoreId}
        onCloseSessionHistory={closeSessionHistory}
        onResumeSession={resumeSessionFromHistory}
        onSelectRuntime={(projectId: string, runtimeId: string) => dispatch({ type: "select.runtime", projectId, runtimeId })}
        checkpointPanelProject={checkpointPanelProject}
        checkpointPanelRuntime={checkpointPanelRuntime}
        checkpoints={checkpointPanelCheckpoints}
        pendingCheckpointActionId={pendingCheckpointActionId}
        onCloseCheckpointPanel={closeCheckpointPanel}
        onRefreshCheckpoints={() => refreshCheckpoints(checkpointPanelProjectId)}
        onRestoreCheckpoint={(checkpointId: string, restoreFiles: boolean) => restoreCheckpoint(checkpointPanelRuntime, checkpointId, restoreFiles)}
        onFastForwardCheckpoint={(restoreFiles: boolean) => fastForward(checkpointPanelRuntime, restoreFiles)}
        pathPicker={pathPicker}
        onChoosePickerCwd={choosePickerCwd}
        pathPickerTitle={pathPickerTitle}
        pathPickerConfirmLabel={pathPickerConfirmLabel}
      />
    </main>
  );
}
