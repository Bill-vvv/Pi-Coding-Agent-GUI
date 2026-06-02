import type { FormEvent } from "react";
import { useEffect, useMemo, useRef, useState } from "react";
import type { AppSettings, ClientCommand, GuiEvent, ModelSummary, Project, ResponseMode, Runtime, ServerEvent, ThinkingLevel } from "@pi-gui/shared";
import { isRecord } from "@pi-gui/shared";
import { ChatView } from "./components/ChatView";
import { Composer } from "./components/Composer";
import { PathPickerModal } from "./components/PathPickerModal";
import { Sidebar } from "./components/Sidebar";
import { appendEvent, upsertById } from "./domain/collections";
import { buildConversationContextUsage, buildConversationMessages, isRuntimeBusy } from "./domain/conversation";
import { FALLBACK_MODELS, modelKey, selectedModelKeyFor, THINKING_LEVELS } from "./domain/models";
import { firstVisibleRuntime } from "./domain/runtime";
import { usePathPicker } from "./hooks/usePathPicker";
import type { ConnectionState, ConversationContextUsage, PendingProjectStart, PendingPrompt } from "./types";

export function App() {
  const wsRef = useRef<WebSocket | null>(null);
  const [connection, setConnection] = useState<ConnectionState>("connecting");
  const [projects, setProjects] = useState<Project[]>([]);
  const [runtimes, setRuntimes] = useState<Runtime[]>([]);
  const [events, setEvents] = useState<GuiEvent[]>([]);
  const [contextUsageByRuntime, setContextUsageByRuntime] = useState<Record<string, ConversationContextUsage>>({});
  const [selectedProjectId, setSelectedProjectId] = useState<string | undefined>();
  const [selectedRuntimeId, setSelectedRuntimeId] = useState<string | undefined>();
  const [projectCwd, setProjectCwd] = useState("");
  const [settings, setSettings] = useState<AppSettings>({});
  const [models, setModels] = useState<ModelSummary[]>(FALLBACK_MODELS);
  const [selectedModelKey, setSelectedModelKey] = useState("");
  const [selectedThinkingLevel, setSelectedThinkingLevel] = useState<ThinkingLevel>("medium");
  const [responseMode, setResponseMode] = useState<ResponseMode>("normal");
  const [modelPickerOpen, setModelPickerOpen] = useState(false);
  const [prompt, setPrompt] = useState("");
  const [lastError, setLastError] = useState<string | undefined>();
  const [showArchived] = useState(false);
  const pathPicker = usePathPicker();
  const pendingPromptRef = useRef<PendingPrompt | undefined>(undefined);
  const pendingProjectStartRef = useRef<PendingProjectStart | undefined>(undefined);

  useEffect(() => {
    let reconnectTimer: number | undefined;
    let closedByEffect = false;

    const connect = () => {
      setConnection("connecting");
      const ws = new WebSocket(wsUrl());
      wsRef.current = ws;

      ws.addEventListener("open", () => {
        setConnection("open");
        setLastError(undefined);
      });

      ws.addEventListener("message", (message) => {
        const event = JSON.parse(message.data as string) as ServerEvent;
        handleServerEvent(event);
      });

      ws.addEventListener("close", () => {
        if (wsRef.current === ws) wsRef.current = null;
        setConnection("closed");
        if (!closedByEffect) reconnectTimer = window.setTimeout(connect, 1500);
      });

      ws.addEventListener("error", () => {
        setLastError("WebSocket 连接错误");
      });
    };

    connect();

    return () => {
      closedByEffect = true;
      if (reconnectTimer) window.clearTimeout(reconnectTimer);
      wsRef.current?.close();
    };
  }, []);

  useEffect(() => {
    void fetch("/api/models")
      .then((response) => (response.ok ? response.json() : Promise.reject(new Error("读取模型失败"))))
      .then((data: { models?: ModelSummary[] }) => {
        if (data.models?.length) setModels(data.models);
      })
      .catch(() => {
        setModels(FALLBACK_MODELS);
      });
  }, []);

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
  const visibleEvents = useMemo(
    () => events.filter((event) => !activeRuntime || event.runtimeId === activeRuntime.id),
    [events, activeRuntime],
  );
  const conversationMessages = useMemo(() => buildConversationMessages(visibleEvents), [visibleEvents]);
  const conversationContextUsage = useMemo(() => buildConversationContextUsage(visibleEvents), [visibleEvents]);
  const activeRuntimeContextUsage = activeRuntime ? contextUsageByRuntime[activeRuntime.id] ?? conversationContextUsage : undefined;
  const activeRuntimeIsBusy = useMemo(() => isRuntimeBusy(visibleEvents), [visibleEvents]);

  function handleServerEvent(event: ServerEvent) {
    switch (event.type) {
      case "hello":
        setProjects(event.projects);
        setRuntimes(event.runtimes);
        setEvents(event.recentEvents);
        setContextUsageByRuntime(contextUsageMapFromEvents(event.recentEvents));
        applySettingsState(event.settings);
        setSelectedProjectId((current) => current ?? event.projects[0]?.id);
        setSelectedRuntimeId((current) => current ?? firstVisibleRuntime(event.runtimes)?.id);
        break;
      case "project.list":
        setProjects(event.projects);
        setSelectedProjectId((current) => current ?? event.projects[0]?.id);
        break;
      case "project.created":
        setProjects((current) => upsertById(current, event.project));
        setSelectedProjectId(event.project.id);
        if (pendingProjectStartRef.current) {
          const pending = pendingProjectStartRef.current;
          pendingProjectStartRef.current = undefined;
          setProjectCwd("");
          startRuntimeForProject(event.project.id, pending.message);
        }
        break;
      case "settings.updated":
        applySettingsState(event.settings);
        break;
      case "runtime.status":
        setRuntimes((current) => upsertById(current, event.runtime));
        if (event.runtime.status === "running" && pendingPromptRef.current?.projectId === event.runtime.projectId) {
          const pending = pendingPromptRef.current;
          pendingPromptRef.current = undefined;
          send({ type: "runtime.prompt", runtimeId: event.runtime.id, message: pending.message });
        }
        break;
      case "gui.event":
        setEvents((current) => appendEvent(current, event.event));
        setContextUsageByRuntime((current) => updateContextUsageMap(current, event.event));
        break;
      case "command.result":
        if (!event.success) {
          setLastError(event.error ?? "命令执行失败");
        } else if (event.command === "runtime.start" && isRecord(event.data) && isRecord(event.data.runtime) && typeof event.data.runtime.id === "string") {
          setSelectedRuntimeId(event.data.runtime.id);
          if (typeof event.data.runtime.projectId === "string") setSelectedProjectId(event.data.runtime.projectId);
        } else if (event.command === "runtime.archive") {
          setSelectedRuntimeId(undefined);
        }
        break;
    }
  }

  function applySettingsState(nextSettings: AppSettings) {
    setSettings(nextSettings);
    setSelectedModelKey(nextSettings.defaultModel ?? selectedModelKeyFor(models[0]) ?? "");
    setSelectedThinkingLevel(nextSettings.defaultThinkingLevel ?? "medium");
    setResponseMode(nextSettings.responseMode ?? "normal");
  }

  function send(command: ClientCommand) {
    if (wsRef.current?.readyState !== WebSocket.OPEN) {
      setLastError("WebSocket 未连接");
      return;
    }
    wsRef.current.send(JSON.stringify({ requestId: crypto.randomUUID(), ...command }));
  }

  function createProjectFromCwd(cwd: string, message?: string) {
    const existingProject = projects.find((project) => project.cwd === cwd);
    if (existingProject) {
      setSelectedProjectId(existingProject.id);
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
    setProjectCwd(pathPicker.cwd);
    pathPicker.closePicker();
  }

  function startRuntimeForProject(projectId: string, message?: string) {
    if (message?.trim()) pendingPromptRef.current = { projectId, message };
    send({
      type: "runtime.start",
      projectId,
      model: selectedModel ? modelKey(selectedModel) : undefined,
      thinkingLevel: selectedThinkingLevel,
    });
  }

  function startRuntimeForSidebarProject(projectId: string) {
    setSelectedProjectId(projectId);
    startRuntimeForProject(projectId);
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

  function configureActiveRuntime(next: { model?: ModelSummary; thinkingLevel?: ThinkingLevel }) {
    if (!activeRuntime || activeRuntime.status !== "running") return;
    send({
      type: "runtime.configure",
      runtimeId: activeRuntime.id,
      modelProvider: next.model?.provider,
      modelId: next.model?.id,
      thinkingLevel: next.thinkingLevel,
    });
  }

  function chooseModel(nextModel: ModelSummary) {
    const nextResponseMode = nextModel.supportsFast ? responseMode : "normal";
    setSelectedModelKey(modelKey(nextModel));
    if (nextResponseMode !== responseMode) setResponseMode(nextResponseMode);
    updateModelSettings({ defaultModel: modelKey(nextModel), responseMode: nextResponseMode });
    configureActiveRuntime({ model: nextModel });
  }

  function chooseThinkingLevel(nextLevel: ThinkingLevel) {
    setSelectedThinkingLevel(nextLevel);
    updateModelSettings({ defaultThinkingLevel: nextLevel });
    configureActiveRuntime({ thinkingLevel: nextLevel });
  }

  function chooseResponseMode(nextMode: ResponseMode) {
    setResponseMode(nextMode);
    updateModelSettings({ responseMode: nextMode });
  }

  function submitPrompt(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    const message = prompt.trim();
    if (!message) return;

    if (activeRuntime?.status === "running") {
      send({ type: "runtime.prompt", runtimeId: activeRuntime.id, message });
      setPrompt("");
      return;
    }

    if (projectCwd.trim()) {
      createProjectFromCwd(projectCwd.trim(), message);
      setPrompt("");
      return;
    }

    if (selectedProject) {
      startRuntimeForProject(selectedProject.id, message);
      setPrompt("");
      return;
    }

    setLastError("请先在输入框下方选择项目文件夹");
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
        onSelectProject={setSelectedProjectId}
        onSelectRuntime={(projectId, runtimeId) => {
          setSelectedProjectId(projectId);
          setSelectedRuntimeId(runtimeId);
        }}
        onArchiveRuntime={archiveRuntime}
      />

      <section className="main-chat">
        <ChatView lastError={lastError} activeRuntime={activeRuntime} messages={conversationMessages} />

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

function contextUsageMapFromEvents(events: GuiEvent[]): Record<string, ConversationContextUsage> {
  return events.reduce<Record<string, ConversationContextUsage>>((usageByRuntime, event) => updateContextUsageMap(usageByRuntime, event), {});
}

function updateContextUsageMap(current: Record<string, ConversationContextUsage>, event: GuiEvent): Record<string, ConversationContextUsage> {
  const nextUsage = buildConversationContextUsage([event], current[event.runtimeId]);
  if (!nextUsage || nextUsage === current[event.runtimeId]) return current;
  return { ...current, [event.runtimeId]: nextUsage };
}

function wsUrl(): string {
  if (import.meta.env.VITE_WS_URL) return import.meta.env.VITE_WS_URL;
  const protocol = window.location.protocol === "https:" ? "wss" : "ws";
  return `${protocol}://${window.location.host}/ws`;
}
