import React, { FormEvent, useEffect, useMemo, useRef, useState } from "react";
import { createRoot } from "react-dom/client";
import type { AppSettings, ClientCommand, GuiEvent, ModelSummary, Project, ResponseMode, Runtime, ServerEvent, ThinkingLevel } from "@pi-gui/shared";
import { isRecord } from "@pi-gui/shared";
import "./styles.css";

type ConnectionState = "connecting" | "open" | "closed";

type DirectoryEntry = {
  name: string;
  path: string;
  type: "directory";
};

type PendingPrompt = { projectId: string; message: string };
type PendingProjectStart = { cwd: string; message?: string };
type ConversationMessage = { id: string; role: "user" | "assistant" | "error" | "log"; text: string; timestamp?: number };

const THINKING_LEVELS: Array<{ value: ThinkingLevel; label: string }> = [
  { value: "off", label: "关闭思考" },
  { value: "minimal", label: "极低" },
  { value: "low", label: "低" },
  { value: "medium", label: "中" },
  { value: "high", label: "高" },
  { value: "xhigh", label: "超高" },
];

const DEFAULT_REASONING_LEVELS: ThinkingLevel[] = ["off", "minimal", "low", "medium", "high"];

const FALLBACK_MODELS: ModelSummary[] = [
  { provider: "openai-codex", id: "gpt-5.2", label: "openai-codex/GPT-5.2", supportsThinking: true, supportedThinkingLevels: DEFAULT_REASONING_LEVELS, supportsImages: true, supportsFast: true },
  { provider: "openai-codex", id: "gpt-5.3-codex", label: "openai-codex/GPT-5.3 Codex", supportsThinking: true, supportedThinkingLevels: DEFAULT_REASONING_LEVELS, supportsImages: true, supportsFast: true },
  { provider: "openai-codex", id: "gpt-5.3-codex-spark", label: "openai-codex/GPT-5.3 Codex Spark", supportsThinking: true, supportedThinkingLevels: DEFAULT_REASONING_LEVELS, supportsImages: false, supportsFast: true },
  { provider: "openai-codex", id: "gpt-5.4", label: "openai-codex/GPT-5.4", supportsThinking: true, supportedThinkingLevels: DEFAULT_REASONING_LEVELS, supportsImages: true, supportsFast: true },
  { provider: "openai-codex", id: "gpt-5.4-mini", label: "openai-codex/GPT-5.4 mini", supportsThinking: true, supportedThinkingLevels: DEFAULT_REASONING_LEVELS, supportsImages: true, supportsFast: true },
  { provider: "openai-codex", id: "gpt-5.5", label: "openai-codex/GPT-5.5", supportsThinking: true, supportedThinkingLevels: DEFAULT_REASONING_LEVELS, supportsImages: true, supportsFast: true },
];

function App() {
  const wsRef = useRef<WebSocket | null>(null);
  const [connection, setConnection] = useState<ConnectionState>("connecting");
  const [projects, setProjects] = useState<Project[]>([]);
  const [runtimes, setRuntimes] = useState<Runtime[]>([]);
  const [events, setEvents] = useState<GuiEvent[]>([]);
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
  const [pathPickerOpen, setPathPickerOpen] = useState(false);
  const [pickerCwd, setPickerCwd] = useState("");
  const [pickerParent, setPickerParent] = useState<string | undefined>();
  const [pickerEntries, setPickerEntries] = useState<DirectoryEntry[]>([]);
  const [pickerLoading, setPickerLoading] = useState(false);
  const [pickerError, setPickerError] = useState<string | undefined>();
  const [showArchived, setShowArchived] = useState(false);
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
  const activeRuntimeIsBusy = useMemo(() => isRuntimeBusy(visibleEvents), [visibleEvents]);

  function handleServerEvent(event: ServerEvent) {
    switch (event.type) {
      case "hello":
        setProjects(event.projects);
        setRuntimes(event.runtimes);
        setEvents(event.recentEvents);
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
        break;
      case "command.result":
        if (!event.success) {
          setLastError(event.error ?? "命令执行失败");
        } else if (event.command === "runtime.start" && isRecord(event.data) && isRecord(event.data.runtime) && typeof event.data.runtime.id === "string") {
          setSelectedRuntimeId(event.data.runtime.id);
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
    setPathPickerOpen(true);
    await loadDirectory(projectCwd || undefined);
  }

  async function loadDirectory(path?: string) {
    setPickerLoading(true);
    setPickerError(undefined);
    try {
      const query = path ? `?path=${encodeURIComponent(path)}` : "";
      const response = await fetch(`/api/fs/list${query}`);
      if (!response.ok) throw new Error(await response.text());
      const data = (await response.json()) as { cwd: string; parent?: string; entries: DirectoryEntry[] };
      setPickerCwd(data.cwd);
      setPickerParent(data.parent);
      setPickerEntries(data.entries);
    } catch (error) {
      setPickerError((error as Error).message || "读取目录失败");
    } finally {
      setPickerLoading(false);
    }
  }

  function choosePickerCwd() {
    setProjectCwd(pickerCwd);
    setPathPickerOpen(false);
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

  function submitPrompt(event: FormEvent) {
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
      <aside className="left-sidebar">
        <div className="sidebar-content">
            <div className="brand no-logo">
              <div className="brand-actions">
                <button
                  className="global-new-chat icon-button"
                  type="button"
                  title="新建对话"
                  aria-label="新建对话"
                  onClick={startRuntime}
                  disabled={connection !== "open"}
                >
                  <Icon name="plus" />
                </button>
              </div>
            </div>

            <section className="sidebar-section">
              <div className="section-title">
                <h2>项目</h2>
              </div>
              {projects.length === 0 ? <p className="muted">暂无项目。</p> : null}
              {projects.map((project) => {
                const projectRuntimes = runtimes.filter((runtime) => runtime.projectId === project.id && (showArchived || !runtime.archivedAt));
                return (
                  <article className={`project-session-group ${project.id === selectedProject?.id ? "selected" : ""}`} key={project.id}>
                    <div className="project-row">
                      <button className="project-select" type="button" onClick={() => setSelectedProjectId(project.id)}>
                        <strong>{project.name}</strong>
                        <small>{project.cwd}</small>
                      </button>
                      <button
                        className="project-new-chat icon-button"
                        type="button"
                        title="在此项目中新建对话"
                        aria-label="在此项目中新建对话"
                        onClick={() => {
                          setSelectedProjectId(project.id);
                          startRuntimeForProject(project.id);
                        }}
                        disabled={connection !== "open"}
                      >
                        <Icon name="plus" />
                      </button>
                    </div>
                    <div className="session-list">
                      {projectRuntimes.map((runtime) => (
                        <div className={`session-row ${runtime.id === activeRuntime?.id ? "selected" : ""}`} key={runtime.id}>
                          <button
                            className="session-item"
                            type="button"
                            onClick={() => {
                              setSelectedProjectId(project.id);
                              setSelectedRuntimeId(runtime.id);
                            }}
                          >
                            <span className={`status-dot ${runtime.status}`} />
                            <span>对话 {runtime.id.slice(0, 8)}</span>
                            {runtime.archivedAt ? <small>归档</small> : null}
                          </button>
                          {!runtime.archivedAt ? (
                            <button
                              className="session-archive icon-button"
                              type="button"
                              title="归档对话"
                              aria-label={`归档对话 ${runtime.id.slice(0, 8)}`}
                              onClick={() => archiveRuntime(runtime.id)}
                              disabled={runtime.id === activeRuntime?.id && activeRuntimeIsBusy}
                            >
                              <Icon name="archive" />
                            </button>
                          ) : null}
                        </div>
                      ))}
                    </div>
                  </article>
                );
              })}
            </section>

            <div className="sidebar-footer">
              <button className="settings-entry icon-button" type="button" title="设置" aria-label="设置">
                <Icon name="settings" />
              </button>
            </div>

          </div>
      </aside>

      <section className="main-chat">
        {lastError ? <div className="error-banner floating-error">{lastError}</div> : null}

        <div className="conversation-surface">
          {activeRuntime ? (
            <div className="conversation-header">
              <strong>对话 {activeRuntime.id.slice(0, 8)}</strong>
              {activeRuntime.sessionId ? <small>Session {activeRuntime.sessionId.slice(0, 8)}</small> : null}
              {activeRuntime.archivedAt ? <small>已归档</small> : null}
            </div>
          ) : null}

          {conversationMessages.length > 0 ? (
            <div className="message-list">
              {conversationMessages.map((message) => (
                <article className={`chat-message ${message.role}`} key={message.id}>
                  <div className="message-role">{messageRoleLabel(message.role)}</div>
                  <pre>{message.text}</pre>
                </article>
              ))}
            </div>
          ) : null}
        </div>

        <form className="composer" onSubmit={submitPrompt}>
          <div className="composer-input-row">
            <textarea
              value={prompt}
              onChange={(event) => setPrompt(event.target.value)}
              onKeyDown={(event) => {
                if (event.key === "Enter" && !event.shiftKey && !event.nativeEvent.isComposing) {
                  event.preventDefault();
                  event.currentTarget.form?.requestSubmit();
                }
              }}
              placeholder="向当前对话发送提示词，Shift+Enter 换行"
            />
            <button
              className="composer-action send-action"
              type="submit"
              title="发送"
              aria-label="发送"
              disabled={!prompt.trim() || connection !== "open"}
            >
              <Icon name="send" />
            </button>
            {activeRuntime?.status === "running" && activeRuntimeIsBusy ? (
              <button
                className="composer-action abort-action"
                type="button"
                title="中止本轮输出"
                aria-label="中止本轮输出"
                onClick={() => send({ type: "runtime.abort", runtimeId: activeRuntime.id })}
              >
                <Icon name="stop" />
              </button>
            ) : null}
          </div>

          <div className="composer-meta-row">
            <button className={`path-picker-trigger composer-project-trigger ${projectCwd || selectedProject ? "has-value" : ""}`} type="button" onClick={openPathPicker}>
              <Icon name="folder" />
              <span>{projectCwd || selectedProject?.cwd || "选择项目文件夹"}</span>
            </button>

            <div className="composer-model-controls">
              <button
                className="model-picker-button"
                type="button"
                onClick={() => setModelPickerOpen((value) => !value)}
                aria-expanded={modelPickerOpen}
              >
                <span className="model-summary-label">{selectedModel ? compactModelLabel(selectedModel) : "选择模型"}</span>
                {selectedModel?.supportsThinking ? <span className="model-summary-meta">{thinkingLabel(selectedThinkingLevel)}</span> : null}
                {selectedModel?.supportsFast && responseMode === "fast" ? <span className="model-summary-meta">快速</span> : null}
              </button>

              {modelPickerOpen ? (
                <section className="model-picker-popover" aria-label="模型与思考设置">
                  {selectedModel?.supportsThinking ? (
                    <div className="model-picker-section">
                      <header>思考强度</header>
                      <div className="thinking-grid">
                        {THINKING_LEVELS.filter((level) => availableThinkingLevels.includes(level.value)).map((level) => (
                          <button
                            className={`picker-option ${selectedThinkingLevel === level.value ? "selected" : ""}`}
                            type="button"
                            key={level.value}
                            onClick={() => chooseThinkingLevel(level.value)}
                          >
                            {level.label}
                          </button>
                        ))}
                      </div>
                    </div>
                  ) : null}

                  <div className="model-picker-section">
                    <header>模型</header>
                    <div className="model-option-list">
                      {models.map((model) => (
                        <button
                          className={`model-option ${selectedModel && modelKey(selectedModel) === modelKey(model) ? "selected" : ""}`}
                          type="button"
                          key={modelKey(model)}
                          onClick={() => chooseModel(model)}
                        >
                          <span>{compactModelLabel(model)}</span>
                          <small>{model.provider}</small>
                        </button>
                      ))}
                    </div>
                  </div>

                  {selectedModel?.supportsFast ? (
                    <div className="model-picker-section speed-section">
                      <header>速度</header>
                      <div className="speed-segmented">
                        <button className={responseMode === "normal" ? "selected" : ""} type="button" onClick={() => chooseResponseMode("normal")}>普通</button>
                        <button className={responseMode === "fast" ? "selected" : ""} type="button" onClick={() => chooseResponseMode("fast")}>快速</button>
                      </div>
                    </div>
                  ) : null}
                </section>
              ) : null}
            </div>
          </div>
        </form>
      </section>

      {pathPickerOpen ? (
        <div className="modal-backdrop" role="presentation" onMouseDown={() => setPathPickerOpen(false)}>
          <section className="path-picker" role="dialog" aria-modal="true" aria-label="选择项目路径" onMouseDown={(event) => event.stopPropagation()}>
            <header>
              <div>
                <h2>选择项目路径</h2>
                <p>{pickerCwd || "正在读取目录..."}</p>
              </div>
              <button className="icon-button" type="button" title="关闭" aria-label="关闭" onClick={() => setPathPickerOpen(false)}>
                <Icon name="x" />
              </button>
            </header>

            {pickerError ? <div className="error-banner">{pickerError}</div> : null}

            <div className="path-picker-actions">
              <button type="button" onClick={() => pickerParent && loadDirectory(pickerParent)} disabled={!pickerParent || pickerLoading}>上一级</button>
              <button type="button" onClick={() => loadDirectory(pickerCwd)} disabled={!pickerCwd || pickerLoading}>刷新</button>
              <button type="button" onClick={choosePickerCwd} disabled={!pickerCwd}>使用当前目录</button>
            </div>

            <div className="directory-list">
              {pickerLoading ? <p className="muted">正在读取...</p> : null}
              {!pickerLoading && pickerEntries.length === 0 ? <p className="muted">当前目录没有子目录。</p> : null}
              {pickerEntries.map((entry) => (
                <button className="directory-item" type="button" key={entry.path} onClick={() => loadDirectory(entry.path)}>
                  <span>📁 {entry.name}</span>
                  <small>{entry.path}</small>
                </button>
              ))}
            </div>
          </section>
        </div>
      ) : null}
    </main>
  );
}

function Icon({ name }: { name: "archive" | "folder" | "plus" | "send" | "settings" | "stop" | "x" }) {
  const common = { width: 18, height: 18, viewBox: "0 0 24 24", fill: "none", xmlns: "http://www.w3.org/2000/svg", "aria-hidden": true };

  switch (name) {
    case "archive":
      return (
        <svg {...common}>
          <path d="M5.25 8.5h13.5v9.25A2.25 2.25 0 0 1 16.5 20h-9a2.25 2.25 0 0 1-2.25-2.25V8.5Z" stroke="currentColor" strokeWidth="1.8" strokeLinejoin="round" />
          <path d="M4.75 4h14.5a1 1 0 0 1 1 1v2.5h-16.5V5a1 1 0 0 1 1-1Z" stroke="currentColor" strokeWidth="1.8" strokeLinejoin="round" />
          <path d="M9.25 12h5.5" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" />
        </svg>
      );
    case "folder":
      return (
        <svg {...common}>
          <path d="M3.75 7.75A2.75 2.75 0 0 1 6.5 5h3.2c.72 0 1.39.34 1.82.92l.78 1.05c.24.32.61.51 1.01.51h5.19A2.75 2.75 0 0 1 21.25 10.23v5.52A3.25 3.25 0 0 1 18 19H6a3.25 3.25 0 0 1-3.25-3.25v-8Z" stroke="currentColor" strokeWidth="1.8" strokeLinejoin="round" />
        </svg>
      );
    case "plus":
      return (
        <svg {...common}>
          <path d="M12 5v14M5 12h14" stroke="currentColor" strokeWidth="2" strokeLinecap="round" />
        </svg>
      );
    case "send":
      return (
        <svg {...common}>
          <path d="m4.5 11.5 15-7-4.9 15-3.2-6.4-6.9-1.6Z" stroke="currentColor" strokeWidth="1.8" strokeLinejoin="round" />
          <path d="m11.4 13.1 8.1-8.6" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" />
        </svg>
      );
    case "settings":
      return (
        <svg {...common}>
          <path d="M4.5 7h5.25M13.75 7H19.5" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" />
          <path d="M4.5 12h8.25M16.75 12h2.75" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" />
          <path d="M4.5 17h2.75M11.25 17h8.25" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" />
          <circle cx="11.75" cy="7" r="2" stroke="currentColor" strokeWidth="1.8" />
          <circle cx="14.75" cy="12" r="2" stroke="currentColor" strokeWidth="1.8" />
          <circle cx="9.25" cy="17" r="2" stroke="currentColor" strokeWidth="1.8" />
        </svg>
      );
    case "stop":
      return (
        <svg {...common}>
          <rect x="6" y="6" width="12" height="12" rx="2" stroke="currentColor" strokeWidth="1.9" />
        </svg>
      );
    case "x":
      return (
        <svg {...common}>
          <path d="m7 7 10 10M17 7 7 17" stroke="currentColor" strokeWidth="2" strokeLinecap="round" />
        </svg>
      );
  }
}

function EventRow({ event }: { event: GuiEvent }) {
  return (
    <article className={`event-row ${event.kind}`}>
      <header>
        <span>#{event.id}</span>
        <strong>{event.kind}</strong>
        <time>{new Date(event.timestamp).toLocaleTimeString()}</time>
      </header>
      <pre>{formatPayload(event.payload)}</pre>
    </article>
  );
}

function modelKey(model: ModelSummary): string {
  return `${model.provider}/${model.id}`;
}

function selectedModelKeyFor(model: ModelSummary | undefined): string | undefined {
  return model ? modelKey(model) : undefined;
}

function compactModelLabel(model: ModelSummary): string {
  return model.id
    .replace(/^gpt-/, "GPT-")
    .replace(/codex/gi, "Codex")
    .replace(/claude/gi, "Claude");
}

function thinkingLabel(level: ThinkingLevel): string {
  return THINKING_LEVELS.find((item) => item.value === level)?.label ?? level;
}

function wsUrl(): string {
  if (import.meta.env.VITE_WS_URL) return import.meta.env.VITE_WS_URL;
  const protocol = window.location.protocol === "https:" ? "wss" : "ws";
  return `${protocol}://${window.location.host}/ws`;
}

function upsertById<T extends { id: string }>(items: T[], item: T): T[] {
  const index = items.findIndex((candidate) => candidate.id === item.id);
  if (index === -1) return [item, ...items];
  const next = [...items];
  next[index] = item;
  return next;
}

function appendEvent(events: GuiEvent[], event: GuiEvent): GuiEvent[] {
  if (events.some((existing) => existing.id === event.id)) return events;
  return [...events, event].slice(-1000);
}

function firstVisibleRuntime(runtimes: Runtime[]): Runtime | undefined {
  const visible = runtimes.filter((runtime) => !runtime.archivedAt);
  return visible.find((runtime) => runtime.status === "running") ?? visible[0];
}

function isRuntimeBusy(events: GuiEvent[]): boolean {
  let busy = false;
  for (const event of events) {
    if (event.kind !== "pi_event" || !isRecord(event.payload)) continue;
    if (event.payload.type === "agent_start") busy = true;
    if (event.payload.type === "agent_end") busy = false;
  }
  return busy;
}

function buildConversationMessages(events: GuiEvent[]): ConversationMessage[] {
  const messages: ConversationMessage[] = [];
  let currentAssistantIndex: number | undefined;

  for (const event of events) {
    if (event.kind === "error") {
      messages.push({ id: `error-${event.id}`, role: "error", text: formatPayload(event.payload), timestamp: event.timestamp });
      currentAssistantIndex = undefined;
      continue;
    }

    if (event.kind === "stderr") {
      messages.push({ id: `stderr-${event.id}`, role: "log", text: formatPayload(event.payload), timestamp: event.timestamp });
      continue;
    }

    if (event.kind !== "pi_event" || !isRecord(event.payload)) continue;

    const payload = event.payload;
    const assistantMessageEvent = isRecord(payload.assistantMessageEvent) ? payload.assistantMessageEvent : undefined;
    if (assistantMessageEvent?.type === "text_delta" && typeof assistantMessageEvent.delta === "string") {
      if (currentAssistantIndex === undefined) {
        currentAssistantIndex = messages.length;
        messages.push({ id: `assistant-stream-${event.id}`, role: "assistant", text: "", timestamp: event.timestamp });
      }
      messages[currentAssistantIndex] = {
        ...messages[currentAssistantIndex],
        text: messages[currentAssistantIndex].text + assistantMessageEvent.delta,
      };
      continue;
    }

    if (payload.type === "message_end" && isRecord(payload.message)) {
      const message = payload.message;
      const role = message.role === "user" ? "user" : message.role === "assistant" ? "assistant" : undefined;
      const text = textFromMessage(message);
      const errorMessage = typeof message.errorMessage === "string" ? message.errorMessage : undefined;
      const timestamp = typeof message.timestamp === "number" ? message.timestamp : event.timestamp;

      if (role === "user" && text) {
        messages.push({ id: `user-${event.id}`, role, text, timestamp });
        currentAssistantIndex = undefined;
      } else if (role === "assistant") {
        if (currentAssistantIndex !== undefined) {
          messages[currentAssistantIndex] = {
            ...messages[currentAssistantIndex],
            text: text || messages[currentAssistantIndex].text || errorMessage || "（空响应）",
            timestamp,
          };
          if (errorMessage) messages[currentAssistantIndex].role = "error";
          currentAssistantIndex = undefined;
        } else if (text || errorMessage) {
          messages.push({ id: `assistant-${event.id}`, role: errorMessage ? "error" : "assistant", text: text || errorMessage || "", timestamp });
        }
      }
      continue;
    }

    if (payload.type === "response" && payload.success === false) {
      messages.push({ id: `response-error-${event.id}`, role: "error", text: typeof payload.error === "string" ? payload.error : formatPayload(payload), timestamp: event.timestamp });
    }
  }

  return messages.filter((message) => message.text.trim().length > 0);
}

function textFromMessage(message: Record<string, unknown>): string {
  const content = message.content;
  if (typeof content === "string") return content;
  if (!Array.isArray(content)) return "";

  return content
    .map((part) => {
      if (typeof part === "string") return part;
      if (!isRecord(part)) return "";
      if (typeof part.text === "string") return part.text;
      if (typeof part.content === "string") return part.content;
      return "";
    })
    .filter(Boolean)
    .join("\n");
}

function messageRoleLabel(role: ConversationMessage["role"]): string {
  if (role === "user") return "你";
  if (role === "assistant") return "Pi";
  if (role === "log") return "日志";
  return "错误";
}

function formatPayload(payload: unknown): string {
  if (typeof payload === "string") return payload;
  return JSON.stringify(payload, null, 2);
}

createRoot(document.getElementById("root")!).render(<App />);
