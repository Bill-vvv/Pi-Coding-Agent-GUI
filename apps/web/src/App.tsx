import { lazy, Suspense, useCallback, useEffect, useMemo, useReducer, useRef, useState } from "react";
import type { AppSettings } from "@pi-gui/shared";
import { AppModals } from "./components/AppModals";
import { ChatView } from "./components/ChatView";
import { Composer } from "./components/Composer";
import { DesktopWindowChrome } from "./components/DesktopWindowChrome";
import { isExtensionUiDialogRequest } from "./components/ExtensionUiDialog";
import { Sidebar } from "./components/Sidebar";
import { ProviderAuthPanel } from "./components/ProviderAuthPanel";
import { ScopedModelsPanel } from "./components/ScopedModelsPanel";
import { SessionTreeForkPanel } from "./components/SessionTreeForkPanel";
import { RewindPanel } from "./components/RewindPanel";

import { useActiveRuntimeView } from "./hooks/useActiveRuntimeView";
import { useAppModalState } from "./hooks/useAppModalState";
import { useAppServerEvents, useAppServerEventSideEffects } from "./hooks/useAppServerEvents";
import { useCheckpointControls } from "./hooks/useCheckpointControls";
import { useCommandMenuHotkey } from "./hooks/useCommandMenuHotkey";
import { useComposerBottomClearance } from "./hooks/useComposerBottomClearance";
import { useComposerCommands } from "./hooks/useComposerCommands";
import { useConversationDeltaBatch } from "./hooks/useConversationDeltaBatch";
import { useConversationPrefetch } from "./hooks/useConversationPrefetch";
import { useExtensionUiRequests } from "./hooks/useExtensionUiRequests";
import { useGuiSocket } from "./hooks/useGuiSocket";
import { useMainSurfaceMode } from "./hooks/useMainSurfaceMode";
import { useModelCatalog } from "./hooks/useModelCatalog";
import { useModelRuntimeSettings } from "./hooks/useModelRuntimeSettings";
import { usePathPickerFlow } from "./hooks/usePathPickerFlow";
import { useProjectRuntimeActions } from "./hooks/useProjectRuntimeActions";
import { useRuntimeCommandRefresh } from "./hooks/useRuntimeCommandRefresh";
import { useRuntimeLogsDrawer } from "./hooks/useRuntimeLogsDrawer";
import { useSessionRestoreActions } from "./hooks/useSessionRestoreActions";
import { useSessionTreeForkControls } from "./hooks/useSessionTreeForkControls";
import { useSubagentDrawer } from "./hooks/useSubagentDrawer";
import { useUiPreferences } from "./hooks/useUiPreferences";
import { shouldAutoArchiveBlankRuntime } from "./domain/blankRuntimeCleanup";
import { desktopShellBridge } from "./domain/desktopShell";
import { isRecoverableRuntimeInterruption } from "./domain/runtimeRecovery";
import { performanceFixtureEvents } from "./domain/performanceFixtures";
import { codexPetAnimationFromMood, countBackgroundPiPetActivity, derivePiPetDisplay, desktopPetStatusFromMood } from "./domain/piPet";
import { modelsInGuiScope } from "./domain/scopedModels";
import { appReducer, initialAppState } from "./state/appReducer";
import "./styles/rewind.css";
import "./styles/checkpoint.css";

const SettingsPanel = lazy(() => import("./components/SettingsPanel").then((module) => ({ default: module.SettingsPanel })));
const RuntimeLogDrawer = lazy(() => import("./components/RuntimeLogDrawer").then((module) => ({ default: module.RuntimeLogDrawer })));
const SessionHistoryPanel = lazy(() => import("./components/SessionHistoryPanel").then((module) => ({ default: module.SessionHistoryPanel })));
const SubagentDetailDrawer = lazy(() => import("./components/SubagentDetailDrawer").then((module) => ({ default: module.SubagentDetailDrawer })));
const TokenUsageOverview = lazy(() => import("./components/TokenUsageOverview").then((module) => ({ default: module.TokenUsageOverview })));

function MainSurfaceFallback() {
  return <div className="empty-state">加载中…</div>;
}

type LastUserMessageScrollRequest = {
  runtimeId?: string;
  sequence: number;
};

type LastUserMessageScrollAction = { type: "request"; runtimeId: string } | { type: "clear" } | { type: "handled"; sequence: number };

function lastUserMessageScrollRequestReducer(current: LastUserMessageScrollRequest, action: LastUserMessageScrollAction): LastUserMessageScrollRequest {
  if (action.type === "clear") return current.runtimeId ? { sequence: current.sequence } : current;
  if (action.type === "handled") return current.runtimeId && current.sequence === action.sequence ? { sequence: current.sequence } : current;
  return { runtimeId: action.runtimeId, sequence: current.sequence + 1 };
}

export function App() {
  const [state, dispatch] = useReducer(appReducer, initialAppState);
  const [scrollToBottomSignal, requestConversationScrollToBottom] = useReducer((value: number) => value + 1, 0);
  const [lastUserMessageScrollRequest, updateLastUserMessageScrollRequest] = useReducer(lastUserMessageScrollRequestReducer, { sequence: 0 });
  const [composerClearanceSignal, requestComposerClearanceFollow] = useReducer((value: number) => value + 1, 0);
  const [composerFocusSignal, requestComposerFocus] = useReducer((value: number) => value + 1, 0);
  const mainChatRef = useRef<HTMLElement | null>(null);
  const composerRef = useRef<HTMLFormElement | null>(null);
  const models = useModelCatalog();
  const { modelPickerOpen, setModelPickerOpen, settingsOpen, setSettingsOpen, toggleModelPicker, closeModelPicker, closeSettings } = useAppModalState();
  const [settingsFocusTab, setSettingsFocusTab] = useState<"ui" | "function" | "extension" | undefined>();
  const [settingsFocusCapabilityId, setSettingsFocusCapabilityId] = useState<string | undefined>();
  const { uiPreferences, setUiPreferences } = useUiPreferences();
  const [providerAuthAction, setProviderAuthAction] = useState<"login" | "logout" | undefined>();
  const [scopedModelsOpen, setScopedModelsOpen] = useState(false);
  const [rewindOpen, setRewindOpen] = useState(false);
  const scopedModels = useMemo(() => modelsInGuiScope(models, uiPreferences.guiScopedModels), [models, uiPreferences.guiScopedModels]);
  const {
    compactSidebarExpanded,
    usageOverviewOpen,
    toggleCompactSidebar,
    collapseCompactSidebar,
    closeUsageOverview,
    closeSurfaces,
    openUsageOverview: openMainUsageOverview,
  } = useMainSurfaceMode();

  const desktopShell = desktopShellBridge();
  const desktopPetAvailable = Boolean(desktopShell?.setDesktopPetVisible && desktopShell.updateDesktopPet);
  const performanceFixtureMode = import.meta.env.DEV && new URLSearchParams(window.location.search).get("fixture") === "performance";

  const closeCompactSidebarDrawer = useCallback(() => {
    collapseCompactSidebar();
    window.requestAnimationFrame(() => {
      document.querySelector<HTMLButtonElement>(".left-sidebar .project-session-group.selected .project-select, .left-sidebar .project-select")?.focus();
    });
  }, [collapseCompactSidebar]);

  useEffect(() => {
    if (!compactSidebarExpanded) return undefined;

    const handleCompactSidebarKeyDown = (event: KeyboardEvent) => {
      if (event.key !== "Escape") return;
      event.preventDefault();
      closeCompactSidebarDrawer();
    };

    window.addEventListener("keydown", handleCompactSidebarKeyDown);
    return () => window.removeEventListener("keydown", handleCompactSidebarKeyDown);
  }, [closeCompactSidebarDrawer, compactSidebarExpanded]);

  const {
    projects,
    runtimes,
    sessions,
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
    guiEvents,
    subagentRuns,
    subagentDetails,
    extensionUiByRuntime,
    executionHost,
    checkpointsByProject,
    checkpointPreviewsBySnapshot,
    checkpointRestoreResultsBySnapshot,
    checkpointJumpsByProject,
    checkpointHealthByProject,
    checkpointGcResultsByProject,
  } = state;

  useEffect(() => {
    if (!performanceFixtureMode) return;
    for (const event of performanceFixtureEvents()) dispatch({ type: "server.event", event });
  }, [performanceFixtureMode]);

  const { queueConversationDelta, flushConversationDeltas } = useConversationDeltaBatch({ dispatch });
  const { handleServerEvent, setServerEventSideEffectHandlers } = useAppServerEvents({
    performanceFixtureMode,
    dispatch,
    queueConversationDelta,
    flushConversationDeltas,
  });

  const { connection, send, connectionWarning } = useGuiSocket({
    onEvent: handleServerEvent,
    onError: (message) => dispatch({ type: "set.operationError", error: message }),
    onOpen: () => dispatch({ type: "clear.transportError" }),
  });
  const updateAppSettings = useCallback((next: Partial<AppSettings>) => {
    return send({ type: "settings.update", settings: { ...settings, ...next } });
  }, [send, settings]);
  const updateProjectRuntimeProfile = useCallback((projectId: string, defaultRuntimeProfileId: AppSettings["defaultRuntimeProfileId"] | null) => {
    return send({ type: "project.configure", projectId, defaultRuntimeProfileId });
  }, [send]);
  const {
    runtimeLogDrawerId,
    runtimeLogDrawerRuntime,
    runtimeLogDrawerState,
    runtimeLogDrawerBusy,
    openRuntimeLogs,
    closeRuntimeLogs,
    requestRuntimeLogs,
    copyRuntimeLogs,
    handleRuntimeLogsServerEvent,
  } = useRuntimeLogsDrawer({ runtimes, busyByRuntime, dispatch, send });
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
    onRestoredRuntime: (runtimeId) => updateLastUserMessageScrollRequest({ type: "request", runtimeId }),
  });
  const sessionHistoryProject = sessionHistoryProjectId ? projects.find((project) => project.id === sessionHistoryProjectId) : undefined;
  const {
    sessionTreeForkState,
    openSessionTreeForkControls,
    closeSessionTreeForkControls,
    forkFromMessage,
    handleSessionTreeForkServerEvent,
  } = useSessionTreeForkControls({ activeRuntime, runtimes, send });
  const {
    prompt,
    setPrompt,
    createProjectOnly,
    startRuntimeForSidebarProject,
    resumeRuntime,
    restartRuntime,
    archiveRuntime,
    dequeueRuntimeQueue,
    reorderRuntimeQueue,
    submitPrompt,
    markRuntimeLocalUserActivity,
    runtimeHasLocalUserActivity,
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
  const { pathPicker, openPathPicker, choosePickerCwd, title: pathPickerTitle, confirmLabel: pathPickerConfirmLabel, allowCreateFolder: pathPickerAllowCreateFolder } = usePathPickerFlow({
    projectCwd,
    createProjectOnly,
    dispatch,
  });
  const {
    previewSnapshotId,
    previewLoading,
    loadingList: checkpointListLoading,
    loadingHealth: checkpointHealthLoading,
    loadingJumps: checkpointJumpsLoading,
    pendingCapture: pendingCheckpointCapture,
    pendingRestoreSnapshotId,
    pendingGcMode,
    refreshAllCheckpointData,
    refreshCheckpointHealth,
    refreshCheckpointJumps,
    captureCheckpoint,
    openPreview: openCheckpointPreview,
    closePreview: closeCheckpointPreview,
    restoreCheckpoint,
    runCheckpointGc,
    handleCheckpointServerEvent,
  } = useCheckpointControls({
    open: settingsOpen,
    selectedProject,
    send,
  });
  const { extensionUiDialog, handleExtensionUiServerEvent, sendExtensionUiResponse } = useExtensionUiRequests({
    send,
    setPrompt,
    uiPreferences,
    projects,
    runtimes,
    conversationSummaries,
    activeProjectId: selectedProject?.id,
    activeRuntimeId: activeRuntime?.id,
    onOpenNotificationTarget: openNotificationTarget,
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
    openSessionTreeForkControls,
    openProviderAuthPanel: setProviderAuthAction,
    openScopedModelsPanel: () => setScopedModelsOpen(true),
    markRuntimeLocalUserActivity,
    startRuntimeForSidebarProject,
  });
  useRuntimeCommandRefresh({ connection, activeRuntime, send });

  const previousActiveRuntimeRef = useRef(activeRuntime);
  const autoArchiveRequestedRuntimeIdsRef = useRef(new Set<string>());

  useEffect(() => {
    const previousRuntime = previousActiveRuntimeRef.current;
    if (previousRuntime && previousRuntime.id !== activeRuntime?.id) {
      const latestPreviousRuntime = runtimes.find((runtime) => runtime.id === previousRuntime.id) ?? previousRuntime;
      const shouldArchive = shouldAutoArchiveBlankRuntime({
        runtime: latestPreviousRuntime,
        messageCount: messagesByRuntime[latestPreviousRuntime.id]?.length ?? 0,
        isBusy: Boolean(busyByRuntime[latestPreviousRuntime.id]),
        hasLocalUserActivity: runtimeHasLocalUserActivity(latestPreviousRuntime.id),
        draftPrompt: prompt,
      });
      if (shouldArchive && !autoArchiveRequestedRuntimeIdsRef.current.has(latestPreviousRuntime.id)) {
        if (send({ type: "runtime.archiveBlank", runtimeId: latestPreviousRuntime.id }, { notifyOnDisconnected: false })) {
          autoArchiveRequestedRuntimeIdsRef.current.add(latestPreviousRuntime.id);
        }
      }
    }
    previousActiveRuntimeRef.current = activeRuntime;
  }, [activeRuntime, busyByRuntime, messagesByRuntime, prompt, runtimeHasLocalUserActivity, runtimes, send]);

  const activeRuntimeSubagentRuns = useMemo(
    () => Object.values(subagentRuns).filter((run) => run.parentRuntimeId === activeRuntime?.id),
    [activeRuntime?.id, subagentRuns],
  );
  const activeRuntimeExtensionUi = activeRuntime ? extensionUiByRuntime[activeRuntime.id] : undefined;
  const modalExtensionUiRequest = isExtensionUiDialogRequest(extensionUiDialog?.request) ? extensionUiDialog.request : undefined;
  const {
    selectedSubagentRun,
    selectedSubagentChildRunId,
    selectedSubagentDetail,
    openSubagentRun,
    closeSubagentDrawer,
    selectSubagentChildRun,
    copySubagentOutput,
  } = useSubagentDrawer({ subagentRuns, subagentDetails, send, dispatch });
  const backgroundPetActivity = useMemo(
    () => countBackgroundPiPetActivity(runtimes, busyByRuntime, activeRuntime?.id),
    [activeRuntime?.id, busyByRuntime, runtimes],
  );
  const activeRuntimeRecoverableInterruption = useMemo(
    () => isRecoverableRuntimeInterruption(activeRuntime, guiEvents),
    [activeRuntime, guiEvents],
  );
  const piPetDisplay = useMemo(
    () => derivePiPetDisplay({
      activeRuntime,
      activeRuntimeIsBusy,
      messages: conversationMessages,
      contextUsage: activeRuntimeContextUsage,
      queue: activeRuntimeQueue,
      waitingForInput: Boolean(activeRuntime && extensionUiDialog?.runtimeId === activeRuntime.id),
      recoverableRuntimeInterruption: activeRuntimeRecoverableInterruption,
      subagentRuns: activeRuntimeSubagentRuns,
      backgroundBusyCount: backgroundPetActivity.busy,
      backgroundAttentionCount: backgroundPetActivity.attention,
    }),
    [activeRuntime, activeRuntimeContextUsage, activeRuntimeIsBusy, activeRuntimeQueue, activeRuntimeRecoverableInterruption, activeRuntimeSubagentRuns, backgroundPetActivity.attention, backgroundPetActivity.busy, conversationMessages, extensionUiDialog],
  );
  useEffect(() => {
    if (!desktopPetAvailable || !desktopShell?.setDesktopPetVisible || !desktopShell.updateDesktopPet) return;
    if (!uiPreferences.desktopPetEnabled) {
      void desktopShell.setDesktopPetVisible(false);
      return;
    }
    void desktopShell.updateDesktopPet({
      mood: piPetDisplay.mood,
      tone: piPetDisplay.tone,
      status: desktopPetStatusFromMood(piPetDisplay.mood),
      animation: codexPetAnimationFromMood(piPetDisplay.mood),
      title: piPetDisplay.title,
      detail: piPetDisplay.detail,
      badges: piPetDisplay.badges,
      satelliteCount: piPetDisplay.satelliteCount,
    });
    void desktopShell.setDesktopPetVisible(true);
  }, [desktopPetAvailable, desktopShell, piPetDisplay, uiPreferences.desktopPetEnabled]);
  useEffect(() => {
    if (!desktopShell?.onDesktopPetClosed) return undefined;
    return desktopShell.onDesktopPetClosed(() => setUiPreferences((current) => ({ ...current, desktopPetEnabled: false })));
  }, [desktopShell, setUiPreferences]);
  const openCommandMenuShortcut = useCallback(() => {
    closeSurfaces({ closeSettings, closeSessionHistory, closeRuntimeLogs, closeSubagentDrawer });
    closeModelPicker();
    closeSessionTreeForkControls();
    setProviderAuthAction(undefined);
    setScopedModelsOpen(false);
    setRewindOpen(false);
    pathPicker.closePicker();
    if (extensionUiDialog) sendExtensionUiResponse({ cancelled: true });
  }, [closeModelPicker, closeRuntimeLogs, closeSessionHistory, closeSettings, closeSessionTreeForkControls, closeSubagentDrawer, closeSurfaces, extensionUiDialog, pathPicker, sendExtensionUiResponse]);
  const openSettingsShortcut = useCallback(() => {
    setSettingsFocusTab("ui");
    setSettingsFocusCapabilityId(undefined);
    setSettingsOpen(true);
  }, [setSettingsOpen]);
  const openRuntimeProfileSettings = useCallback(() => {
    setSettingsFocusTab("extension");
    setSettingsFocusCapabilityId(undefined);
    setSettingsOpen(true);
  }, [setSettingsOpen]);
  const commandMenuOpenSignal = useCommandMenuHotkey({ onOpenCommandMenu: openCommandMenuShortcut, onOpenSettings: openSettingsShortcut, keybindings: uiPreferences.keybindings });

  const composerSurfaceVisible = !settingsOpen && !sessionHistoryProjectId && !usageOverviewOpen && !sessionTreeForkState.open && !providerAuthAction && !scopedModelsOpen && !rewindOpen && Boolean(activeRuntime);

  const closeEscapeSurface = useCallback((): boolean => {
    if (compactSidebarExpanded) {
      closeCompactSidebarDrawer();
      return true;
    }
    if (pathPicker.open) {
      pathPicker.closePicker();
      return true;
    }
    if (extensionUiDialog) {
      sendExtensionUiResponse({ cancelled: true });
      return true;
    }
    if (runtimeLogDrawerId) {
      closeRuntimeLogs();
      return true;
    }
    if (selectedSubagentRun) {
      closeSubagentDrawer();
      return true;
    }
    if (settingsOpen) {
      closeSettings();
      return true;
    }
    if (sessionHistoryProjectId) {
      closeSessionHistory();
      return true;
    }
    if (sessionTreeForkState.open) {
      closeSessionTreeForkControls();
      return true;
    }
    if (providerAuthAction) {
      setProviderAuthAction(undefined);
      return true;
    }
    if (scopedModelsOpen) {
      setScopedModelsOpen(false);
      return true;
    }
    if (rewindOpen) {
      setRewindOpen(false);
      return true;
    }
    if (usageOverviewOpen) {
      closeUsageOverview();
      return true;
    }
    if (composerSurfaceVisible && modelPickerOpen) {
      closeModelPicker();
      return true;
    }
    return false;
  }, [
    closeCompactSidebarDrawer,
    closeModelPicker,
    closeRuntimeLogs,
    closeSessionHistory,
    closeSettings,
    closeSubagentDrawer,
    closeSessionTreeForkControls,
    closeUsageOverview,
    compactSidebarExpanded,
    composerSurfaceVisible,
    extensionUiDialog,
    modelPickerOpen,
    pathPicker.closePicker,
    pathPicker.open,
    providerAuthAction,
    runtimeLogDrawerId,
    rewindOpen,
    scopedModelsOpen,
    selectedSubagentRun,
    sendExtensionUiResponse,
    sessionHistoryProjectId,
    sessionTreeForkState.open,
    settingsOpen,
    usageOverviewOpen,
  ]);

  const escapeAbortRuntimeId = activeRuntime && (activeRuntime.status === "running" || activeRuntime.status === "starting") && !activeRuntime.archivedAt ? activeRuntime.id : undefined;

  useEffect(() => {
    function handleGlobalEscapeKey(event: KeyboardEvent) {
      if (event.key !== "Escape" || event.repeat || event.defaultPrevented) return;
      if (closeEscapeSurface()) {
        event.preventDefault();
        return;
      }

      // Do not gate on frontend busy state here: busy can lag prompt start,
      // retry, or tool transitions, while Pi treats idle abort as a no-op.
      if (connection !== "open" || !escapeAbortRuntimeId) return;
      event.preventDefault();
      send({ type: "runtime.abort", runtimeId: escapeAbortRuntimeId });
    }

    window.addEventListener("keydown", handleGlobalEscapeKey);
    return () => window.removeEventListener("keydown", handleGlobalEscapeKey);
  }, [closeEscapeSurface, connection, escapeAbortRuntimeId, send]);

  useAppServerEventSideEffects({
    setServerEventSideEffectHandlers,
    handleRuntimeLogsServerEvent,
    handleProjectRuntimeServerEvent,
    handleSessionRestoreServerEvent,
    handleSessionTreeForkServerEvent,
    handleExtensionUiServerEvent,
    handleComposerCommandServerEvent,
    handleCheckpointServerEvent,
  });

  useComposerBottomClearance({
    containerRef: mainChatRef,
    composerRef,
    enabled: composerSurfaceVisible,
    onClearanceChange: requestComposerClearanceFollow,
  });

  const firstActiveConversationMessageId = conversationMessages[0]?.id;
  const loadOlderActiveConversationMessages = useCallback(() => {
    const runtimeId = activeRuntime?.id;
    if (!runtimeId || !firstActiveConversationMessageId) return;
    send({ type: "conversation.page", runtimeId, beforeMessageId: firstActiveConversationMessageId, limit: 200 }, { notifyOnDisconnected: false });
  }, [activeRuntime?.id, firstActiveConversationMessageId, send]);

  const dismissOperationError = useCallback((expectedError?: string) => dispatch({ type: "clear.operationError", error: expectedError }), []);
  const dismissNotice = useCallback((expectedNotice?: string) => dispatch({ type: "clear.notice", notice: expectedNotice }), []);
  const submitPromptAndFollowConversation = useCallback((streamingBehavior?: "steer" | "followUp") => {
    if (prompt.trim()) requestConversationScrollToBottom();
    submitPrompt(streamingBehavior);
  }, [prompt, requestConversationScrollToBottom, submitPrompt]);

  function openUsageOverview() {
    openMainUsageOverview({ closeSettings, closeSessionHistory });
  }

  function startNewRuntimeForProject(projectId: string) {
    updateLastUserMessageScrollRequest({ type: "clear" });
    closeSurfaces({ closeSettings, closeSessionHistory });
    startRuntimeForSidebarProject(projectId);
    requestComposerFocus();
  }

  function selectRuntimeFromSessionClick(projectId: string, runtimeId: string) {
    closeSurfaces({ closeSettings, closeSessionHistory });
    updateLastUserMessageScrollRequest({ type: "request", runtimeId });
    dispatch({ type: "select.runtime", projectId, runtimeId });
  }

  function openNotificationTarget(projectId: string, runtimeId: string) {
    updateLastUserMessageScrollRequest({ type: "clear" });
    closeSurfaces({ closeSettings, closeSessionHistory, closeRuntimeLogs, closeSubagentDrawer });
    closeModelPicker();
    pathPicker.closePicker();
    if (extensionUiDialog) sendExtensionUiResponse({ cancelled: true });
    dispatch({ type: "select.runtime", projectId, runtimeId });
  }

  return (
    <main className={`app-shell ${settingsOpen ? "settings-open" : ""} ${compactSidebarExpanded ? "sidebar-compact-expanded" : ""} ${desktopShell ? "desktop-shell" : ""}`}>
      {desktopShell ? <DesktopWindowChrome bridge={desktopShell} /> : null}

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
        onToggleCompact={toggleCompactSidebar}
        onAddProject={() => {
          updateLastUserMessageScrollRequest({ type: "clear" });
          closeSurfaces({ closeSessionHistory });
          void openPathPicker("addProject");
        }}
        onStartRuntimeForProject={startNewRuntimeForProject}
        onOpenSessionHistory={(projectId) => {
          closeSurfaces({ closeSettings });
          openSessionHistory(projectId);
        }}
        onSelectProject={(projectId) => {
          updateLastUserMessageScrollRequest({ type: "clear" });
          closeSurfaces({ closeSessionHistory });
          dispatch({ type: "select.project", projectId });
        }}
        onSelectRuntime={selectRuntimeFromSessionClick}
        onArchiveRuntime={archiveRuntime}
        onOpenRuntimeLogs={openRuntimeLogs}
        onOpenSettings={() => {
          closeSurfaces({ closeSessionHistory });
          setSettingsFocusTab("ui");
          setSettingsFocusCapabilityId(undefined);
          setSettingsOpen(true);
        }}
        conversationSummaries={conversationSummaries}
        guiEvents={guiEvents}
      />

      {compactSidebarExpanded ? (
        <button className="sidebar-compact-backdrop" type="button" aria-label="关闭侧边栏" onClick={closeCompactSidebarDrawer} />
      ) : null}

      <section ref={mainChatRef} className={`main-chat ${settingsOpen ? "settings-mode" : ""}`}>
        {settingsOpen ? (
          <Suspense fallback={<MainSurfaceFallback />}>
            <SettingsPanel
              open={settingsOpen}
              preferences={uiPreferences}
              settings={settings}
              connection={connection}
              selectedProject={selectedProject}
              activeRuntime={activeRuntime}
              checkpoints={selectedProject ? state.checkpointsByProject[selectedProject.id] ?? [] : []}
              checkpointOperations={selectedProject ? state.checkpointOperations.filter((operation) => operation.projectId === selectedProject.id) : []}
              checkpointJumps={selectedProject ? state.checkpointJumpsByProject[selectedProject.id] ?? [] : []}
              checkpointHealth={selectedProject ? state.checkpointHealthByProject[selectedProject.id] : undefined}
              checkpointGcResult={selectedProject ? state.checkpointGcResultsByProject[selectedProject.id] : undefined}
              checkpointPreview={previewSnapshotId ? state.checkpointPreviewsBySnapshot[previewSnapshotId] : undefined}
              checkpointRestoreResult={previewSnapshotId ? state.checkpointRestoreResultsBySnapshot[previewSnapshotId] : undefined}
              checkpointPreviewSnapshotId={previewSnapshotId}
              checkpointPreviewLoading={previewLoading}
              checkpointListLoading={checkpointListLoading}
              checkpointHealthLoading={checkpointHealthLoading}
              checkpointJumpsLoading={checkpointJumpsLoading}
              pendingCheckpointCapture={pendingCheckpointCapture}
              pendingCheckpointRestoreSnapshotId={pendingRestoreSnapshotId}
              pendingCheckpointGcMode={pendingGcMode}
              onRefreshCheckpoints={refreshAllCheckpointData}
              onRefreshCheckpointHealth={refreshCheckpointHealth}
              onRefreshCheckpointJumps={refreshCheckpointJumps}
              onCaptureCheckpoint={captureCheckpoint}
              onOpenCheckpointPreview={openCheckpointPreview}
              onCloseCheckpointPreview={closeCheckpointPreview}
              onRestoreCheckpoint={restoreCheckpoint}
              onRunCheckpointGc={runCheckpointGc}
              onClose={closeSettings}
              onChangePreferences={setUiPreferences}
              onChangeSettings={updateAppSettings}
              onChangeProjectRuntimeProfile={updateProjectRuntimeProfile}
              onOpenUsageOverview={openUsageOverview}
              focusTab={settingsFocusTab}
              focusCapabilityId={settingsFocusCapabilityId}
              desktopPetAvailable={desktopPetAvailable}
              desktopShell={desktopShell}
            />
          </Suspense>
        ) : sessionHistoryProject ? (
          <Suspense fallback={<MainSurfaceFallback />}>
            <SessionHistoryPanel
              project={sessionHistoryProject}
              sessions={sessions}
              runtimes={runtimes}
              connection={connection}
              currentHost={executionHost}
              pendingRestoreId={pendingHistoryRestoreId}
              onClose={closeSessionHistory}
              onResumeSession={(sessionId: string) => {
                resumeSessionFromHistory(sessionId);
              }}
              onSelectRuntime={selectRuntimeFromSessionClick}
            />
          </Suspense>
        ) : sessionTreeForkState.open ? (
          <SessionTreeForkPanel
            mode={sessionTreeForkState.mode}
            runtime={activeRuntime}
            messages={sessionTreeForkState.messages}
            loading={sessionTreeForkState.loading}
            error={sessionTreeForkState.error}
            notice={sessionTreeForkState.notice}
            onClose={closeSessionTreeForkControls}
            onRefresh={() => openSessionTreeForkControls(sessionTreeForkState.mode)}
            onFork={forkFromMessage}
          />
        ) : providerAuthAction ? (
          <ProviderAuthPanel action={providerAuthAction} onClose={() => setProviderAuthAction(undefined)} />
        ) : scopedModelsOpen ? (
          <ScopedModelsPanel
            models={models}
            preference={uiPreferences.guiScopedModels}
            onChange={(guiScopedModels) => setUiPreferences({ ...uiPreferences, guiScopedModels })}
            onClose={() => setScopedModelsOpen(false)}
          />
        ) : rewindOpen && selectedProject ? (
          <RewindPanel
            projectId={selectedProject.id}
            runtime={activeRuntime}
            checkpoints={checkpointsByProject[selectedProject.id] ?? []}
            jumps={checkpointJumpsByProject[selectedProject.id] ?? []}
            previewBySnapshot={checkpointPreviewsBySnapshot}
            restoreResultsBySnapshot={checkpointRestoreResultsBySnapshot}
            health={checkpointHealthByProject[selectedProject.id]}
            gcResult={checkpointGcResultsByProject[selectedProject.id]}
            send={send}
            onClose={() => setRewindOpen(false)}
          />
        ) : usageOverviewOpen || !activeRuntime ? (
          <Suspense fallback={<MainSurfaceFallback />}>
            <TokenUsageOverview projects={projects} />
          </Suspense>
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
              hasMoreBefore={activeRuntime ? hasMoreBeforeByRuntime[activeRuntime.id] === true && conversationMessages.length > 0 : false}
              subagentRuns={activeRuntimeSubagentRuns}
              extensionUi={activeRuntimeExtensionUi}
              displayMode={uiPreferences.thinkingToolDisplayMode}
              scrollToBottomSignal={scrollToBottomSignal}
              scrollToLastUserMessageRequest={
                lastUserMessageScrollRequest.runtimeId
                  ? { runtimeId: lastUserMessageScrollRequest.runtimeId, sequence: lastUserMessageScrollRequest.sequence }
                  : undefined
              }
              onScrollToLastUserMessageRequestHandled={(sequence) => updateLastUserMessageScrollRequest({ type: "handled", sequence })}
              bottomClearanceSignal={composerClearanceSignal}
              onLoadOlderMessages={activeRuntime ? loadOlderActiveConversationMessages : undefined}
              onOpenSubagentRun={openSubagentRun}
              onCopySubagentOutput={copySubagentOutput}
              onOpenRuntimeProfileSettings={openRuntimeProfileSettings}
              onOpenRewind={() => setRewindOpen(true)}
              onDismissOperationError={dismissOperationError}
              onDismissNotice={dismissNotice}
            />

            <Composer
              ref={composerRef}
              prompt={prompt}
              projectCwd={projectCwd}
              selectedProject={selectedProject}
              models={scopedModels}
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
              focusRequestSignal={composerFocusSignal}
              connection={connection}
              activeRuntime={activeRuntime}
              activeRuntimeIsBusy={activeRuntimeIsBusy}
              onSubmit={submitPromptAndFollowConversation}
              onPromptChange={setPrompt}
              onExecuteCommandInput={executeCommandInput}
              onOpenPathPicker={() => void openPathPicker("composer")}
              onAbortRuntime={(runtimeId) => send({ type: "runtime.abort", runtimeId })}
              onDequeueRuntimeQueue={dequeueRuntimeQueue}
              onReorderRuntimeQueue={reorderRuntimeQueue}
              onToggleModelPicker={toggleModelPicker}
              onCloseModelPicker={closeModelPicker}
              onChooseModel={chooseModel}
              onChooseThinkingLevel={chooseThinkingLevel}
              onChooseResponseMode={chooseResponseMode}
            />
          </>
        )}

      </section>

      {runtimeLogDrawerRuntime ? (
        <Suspense fallback={null}>
          <RuntimeLogDrawer
            runtime={runtimeLogDrawerRuntime}
            events={runtimeLogDrawerState?.events ?? []}
            loading={runtimeLogDrawerState?.loading}
            hasMore={runtimeLogDrawerState?.hasMore}
            busy={runtimeLogDrawerBusy}
            onClose={closeRuntimeLogs}
            onRefresh={() => runtimeLogDrawerId && requestRuntimeLogs(runtimeLogDrawerId)}
            onCopyLogs={copyRuntimeLogs}
            onResume={(runtimeId) => { resumeRuntime(runtimeId); requestRuntimeLogs(runtimeId); }}
            onRestart={(runtimeId) => { restartRuntime(runtimeId); requestRuntimeLogs(runtimeId); }}
            onStop={(runtimeId) => { send({ type: "runtime.stop", runtimeId }); requestRuntimeLogs(runtimeId); }}
            onArchive={(runtimeId) => { archiveRuntime(runtimeId); requestRuntimeLogs(runtimeId); }}
          />
        </Suspense>
      ) : null}

      {selectedSubagentRun ? (
        <Suspense fallback={null}>
          <SubagentDetailDrawer
            run={selectedSubagentRun}
            selectedChildRunId={selectedSubagentChildRunId}
            detail={selectedSubagentDetail}
            onClose={closeSubagentDrawer}
            onSelectChildRun={selectSubagentChildRun}
          />
        </Suspense>
      ) : null}

      <AppModals
        extensionUiRequest={modalExtensionUiRequest}
        onRespondExtensionUi={sendExtensionUiResponse}
        pathPicker={pathPicker}
        onChoosePickerCwd={choosePickerCwd}
        pathPickerTitle={pathPickerTitle}
        pathPickerConfirmLabel={pathPickerConfirmLabel}
        pathPickerAllowCreateFolder={pathPickerAllowCreateFolder}
      />
    </main>
  );
}
