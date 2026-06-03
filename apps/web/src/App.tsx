import type { FormEvent } from "react";
import { useEffect, useMemo, useReducer, useRef, useState } from "react";
import type { AppSettings, ModelSummary, ResponseMode, ServerEvent, ThinkingLevel } from "@pi-gui/shared";
import { isRecord } from "@pi-gui/shared";
import { ChatView } from "./components/ChatView";
import { Composer } from "./components/Composer";
import { PathPickerModal } from "./components/PathPickerModal";
import { Sidebar } from "./components/Sidebar";
import { mergeConversationSummaries } from "./domain/conversationSummary";
import { modelKey, selectedModelKeyFor, THINKING_LEVELS } from "./domain/models";
import { useGuiSocket } from "./hooks/useGuiSocket";
import { useModelCatalog } from "./hooks/useModelCatalog";
import { usePathPicker } from "./hooks/usePathPicker";
import { appReducer, initialAppState } from "./state/appReducer";
import type { PendingProjectStart, PendingPrompt } from "./types";

export function App() {
  const openedRuntimeIdsRef = useRef<Set<string>>(new Set());
  const pendingPromptRef = useRef<PendingPrompt | undefined>(undefined);
  const pendingProjectStartRef = useRef<PendingProjectStart | undefined>(undefined);
  const [state, dispatch] = useReducer(appReducer, initialAppState);
  const models = useModelCatalog();
  const [modelPickerOpen, setModelPickerOpen] = useState(false);
  const [prompt, setPrompt] = useState("");
  const pathPicker = usePathPicker();

  const {
    projects,
    runtimes,
    messagesByRuntime,
    persistedConversationSummaries,
    contextUsageByRuntime,
    busyByRuntime,
    selectedProjectId,
    selectedRuntimeId,
    projectCwd,
    settings,
    selectedModelKey,
    selectedThinkingLevel,
    responseMode,
    lastError,
    showArchived,
  } = state;

  const { connection, send } = useGuiSocket({
    onEvent: handleServerEvent,
    onError: (message) => dispatch({ type: "set.lastError", error: message }),
    onOpen: () => dispatch({ type: "set.lastError", error: undefined }),
    onClose: () => openedRuntimeIdsRef.current.clear(),
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
  const selectedModel = models.find((model) => modelKey(model) === selectedModelKey) ?? models[0];
  const availableThinkingLevels = selectedModel?.supportedThinkingLevels ?? THINKING_LEVELS.map((level) => level.value);
  const conversationMessages = activeRuntime ? messagesByRuntime[activeRuntime.id] ?? [] : [];
  const conversationSummaries = useMemo(
    () => mergeConversationSummaries(persistedConversationSummaries, messagesByRuntime),
    [persistedConversationSummaries, messagesByRuntime],
  );
  const activeRuntimeConversationSummary = activeRuntime ? conversationSummaries[activeRuntime.id] : undefined;
  const activeRuntimeContextUsage = activeRuntime ? contextUsageByRuntime[activeRuntime.id] : undefined;
  const activeRuntimeIsBusy = activeRuntime ? busyByRuntime[activeRuntime.id] ?? false : false;

  useEffect(() => {
    if (connection !== "open" || !activeRuntime) return;
    if (openedRuntimeIdsRef.current.has(activeRuntime.id)) return;
    openedRuntimeIdsRef.current.add(activeRuntime.id);
    send({ type: "conversation.open", runtimeId: activeRuntime.id, limit: 120 });
  }, [connection, activeRuntime?.id, send]);

  function handleServerEvent(event: ServerEvent) {
    dispatch({ type: "server.event", event, fallbackModelKey: selectedModelKeyFor(models[0]) });
    handleServerSideEffects(event);
  }

  function handleServerSideEffects(event: ServerEvent) {
    if (event.type === "project.created" && pendingProjectStartRef.current) {
      const pending = pendingProjectStartRef.current;
      pendingProjectStartRef.current = undefined;
      dispatch({ type: "set.projectCwd", cwd: "" });
      startRuntimeForProject(event.project.id, pending.message);
      return;
    }

    if (event.type !== "command.result" || !event.success) return;

    if ((event.command === "runtime.start" || event.command === "runtime.resume") && isRecord(event.data) && isRecord(event.data.runtime) && typeof event.data.runtime.id === "string") {
      const runtime = event.data.runtime as { id: string; projectId?: unknown };
      const runtimeId = runtime.id;
      const projectId = typeof runtime.projectId === "string" ? runtime.projectId : undefined;
      openedRuntimeIdsRef.current.delete(runtimeId);
      if (projectId && pendingPromptRef.current?.projectId === projectId) {
        const pending = pendingPromptRef.current;
        pendingPromptRef.current = undefined;
        send({ type: "runtime.prompt", runtimeId, message: pending.message });
      }
    }
  }

  function createProjectFromCwd(cwd: string, message?: string) {
    const existingProject = projects.find((project) => project.cwd === cwd);
    if (existingProject) {
      dispatch({ type: "select.project", projectId: existingProject.id });
      startRuntimeForProject(existingProject.id, message);
      return;
    }
    pendingProjectStartRef.current = { cwd, message };
    send({ type: "project.create", cwd });
  }

  async function openPathPicker() {
    await pathPicker.openPicker(projectCwd || undefined);
  }

  function choosePickerCwd() {
    dispatch({ type: "set.projectCwd", cwd: pathPicker.cwd });
    pathPicker.closePicker();
  }

  function startRuntimeForProject(projectId: string, message?: string) {
    if (message?.trim()) pendingPromptRef.current = { projectId, message };
    send({
      type: "runtime.start",
      projectId,
      model: selectedModel ? modelKey(selectedModel) : undefined,
      thinkingLevel: selectedThinkingLevel,
      responseMode,
    });
  }

  function startRuntimeForSidebarProject(projectId: string) {
    dispatch({ type: "select.project", projectId });
    startRuntimeForProject(projectId);
  }

  function resumeRuntime(runtimeId: string, message?: string) {
    const runtime = runtimes.find((item) => item.id === runtimeId);
    if (!runtime) return;
    if (message?.trim()) pendingPromptRef.current = { projectId: runtime.projectId, message };
    dispatch({ type: "select.project", projectId: runtime.projectId });
    send({
      type: "runtime.resume",
      runtimeId,
      model: selectedModel ? modelKey(selectedModel) : undefined,
      thinkingLevel: selectedThinkingLevel,
      responseMode,
    });
  }

  function startRuntime() {
    if (projectCwd.trim()) {
      createProjectFromCwd(projectCwd.trim());
      return;
    }
    if (selectedProject) {
      startRuntimeForProject(selectedProject.id);
      return;
    }
    void openPathPicker();
  }

  function stopRuntime() {
    if (!activeRuntime) return;
    send({ type: "runtime.stop", runtimeId: activeRuntime.id });
  }

  function archiveRuntime(runtimeId: string) {
    send({ type: "runtime.archive", runtimeId });
  }

  function updateModelSettings(next: Partial<AppSettings>) {
    const merged: AppSettings = {
      ...settings,
      defaultModel: selectedModel ? modelKey(selectedModel) : settings.defaultModel,
      defaultThinkingLevel: selectedThinkingLevel,
      responseMode,
      ...next,
    };
    send({ type: "settings.update", settings: merged });
  }

  function configureActiveRuntime(next: { model?: ModelSummary; thinkingLevel?: ThinkingLevel; responseMode?: ResponseMode }) {
    if (!activeRuntime || activeRuntime.status !== "running") return;
    send({
      type: "runtime.configure",
      runtimeId: activeRuntime.id,
      modelProvider: next.model?.provider,
      modelId: next.model?.id,
      thinkingLevel: next.thinkingLevel,
      responseMode: next.responseMode,
    });
  }

  function chooseModel(nextModel: ModelSummary) {
    const nextResponseMode = nextModel.supportsFast ? responseMode : "normal";
    dispatch({ type: "select.model", modelKey: modelKey(nextModel), responseMode: nextResponseMode });
    updateModelSettings({ defaultModel: modelKey(nextModel), responseMode: nextResponseMode });
    configureActiveRuntime({ model: nextModel, responseMode: nextResponseMode });
  }

  function chooseThinkingLevel(nextLevel: ThinkingLevel) {
    dispatch({ type: "select.thinkingLevel", thinkingLevel: nextLevel });
    updateModelSettings({ defaultThinkingLevel: nextLevel });
    configureActiveRuntime({ thinkingLevel: nextLevel });
  }

  function chooseResponseMode(nextMode: ResponseMode) {
    dispatch({ type: "select.responseMode", responseMode: nextMode });
    updateModelSettings({ responseMode: nextMode });
    configureActiveRuntime({ responseMode: nextMode });
  }

  function submitPrompt(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    const message = prompt.trim();
    if (!message) return;

    if (activeRuntime?.status === "running") {
      send({ type: "runtime.prompt", runtimeId: activeRuntime.id, message, streamingBehavior: activeRuntimeIsBusy ? "followUp" : undefined });
      setPrompt("");
      return;
    }

    if (projectCwd.trim()) {
      createProjectFromCwd(projectCwd.trim(), message);
      setPrompt("");
      return;
    }

    if (activeRuntime && (activeRuntime.status === "stopped" || activeRuntime.status === "crashed") && activeRuntime.sessionId) {
      resumeRuntime(activeRuntime.id, message);
      setPrompt("");
      return;
    }

    if (selectedProject) {
      startRuntimeForProject(selectedProject.id, message);
      setPrompt("");
      return;
    }

    dispatch({ type: "set.lastError", error: "请先在输入框下方选择项目文件夹" });
  }

  return (
    <main className="app-shell">
      <Sidebar
        connection={connection}
        projects={projects}
        runtimes={runtimes}
        selectedProject={selectedProject}
        activeRuntime={activeRuntime}
        showArchived={showArchived}
        activeRuntimeIsBusy={activeRuntimeIsBusy}
        onStartRuntime={startRuntime}
        onStartRuntimeForProject={startRuntimeForSidebarProject}
        onResumeRuntime={resumeRuntime}
        onSelectProject={(projectId) => dispatch({ type: "select.project", projectId })}
        onSelectRuntime={(projectId, runtimeId) => dispatch({ type: "select.runtime", projectId, runtimeId })}
        onArchiveRuntime={archiveRuntime}
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
          connection={connection}
          activeRuntime={activeRuntime}
          activeRuntimeIsBusy={activeRuntimeIsBusy}
          onSubmit={submitPrompt}
          onPromptChange={setPrompt}
          onOpenPathPicker={openPathPicker}
          onAbortRuntime={(runtimeId) => send({ type: "runtime.abort", runtimeId })}
          onToggleModelPicker={() => setModelPickerOpen((value) => !value)}
          onCloseModelPicker={() => setModelPickerOpen(false)}
          onChooseModel={chooseModel}
          onChooseThinkingLevel={chooseThinkingLevel}
          onChooseResponseMode={chooseResponseMode}
        />
      </section>

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
      />
    </main>
  );
}
