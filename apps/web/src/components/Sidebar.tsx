import type { DragEvent } from "react";
import { useEffect, useLayoutEffect, useMemo, useRef, useState } from "react";
import type { ConversationMessage, GuiSession, Project, Runtime, RuntimeConversationSummary } from "@pi-gui/shared";
import type { ConnectionState } from "../types";
import { Icon } from "./Icon";
import { PiLogo } from "./PiLogo";

const PROJECT_ORDER_STORAGE_KEY = "pi-gui.projectOrder";
const SESSION_ORDER_STORAGE_KEY = "pi-gui.sessionOrder";
const COLLAPSED_PROJECTS_STORAGE_KEY = "pi-gui.collapsedProjects";
const RUNTIME_READ_TIMESTAMPS_STORAGE_KEY = "pi-gui.runtimeReadTimestamps";
const PROJECT_DRAG_MIME = "application/x-pi-gui-project";
const SESSION_DRAG_MIME = "application/x-pi-gui-session";
const SESSION_DOT_BREATHE_DURATION_MS = 1350;
const SIDEBAR_SCROLLBAR_VISIBLE_MS = 850;

type DraggingSession = { projectId: string; runtimeId: string };
type DropPosition = "before" | "after";
type DragTarget =
  | { kind: "project"; projectId: string; position: DropPosition }
  | { kind: "session"; projectId: string; runtimeId: string; position: DropPosition };

type SidebarProps = {
  connection: ConnectionState;
  projects: Project[];
  runtimes: Runtime[];
  sessions: GuiSession[];
  selectedProject?: Project;
  activeRuntime?: Runtime;
  activeRuntimeIsBusy: boolean;
  busyByRuntime: Record<string, boolean>;
  messagesByRuntime: Record<string, ConversationMessage[]>;
  conversationSummaries: Record<string, RuntimeConversationSummary>;
  onAddProject: () => void;
  onStartRuntimeForProject: (projectId: string) => void;
  onOpenSessionHistory: (projectId: string) => void;
  onOpenCheckpoints: (projectId: string, runtimeId?: string) => void;
  onSelectProject: (projectId: string) => void;
  onSelectRuntime: (projectId: string, runtimeId: string) => void;
  compactExpanded: boolean;
  onToggleCompact: () => void;
  onArchiveRuntime: (runtimeId: string) => void;
  onOpenSettings: () => void;
};

export function Sidebar({
  connection,
  projects,
  runtimes,
  sessions,
  selectedProject,
  activeRuntime,
  activeRuntimeIsBusy,
  busyByRuntime,
  messagesByRuntime,
  conversationSummaries,
  onAddProject,
  onStartRuntimeForProject,
  onOpenSessionHistory,
  onOpenCheckpoints,
  compactExpanded,
  onToggleCompact,
  onSelectProject,
  onSelectRuntime,
  onArchiveRuntime,
  onOpenSettings,
}: SidebarProps) {
  const [collapsedProjectIds, setCollapsedProjectIds] = useState<Set<string>>(() => new Set(readStringArray(COLLAPSED_PROJECTS_STORAGE_KEY)));
  const [projectOrder, setProjectOrder] = useState<string[]>(() => readStringArray(PROJECT_ORDER_STORAGE_KEY));
  const [sessionOrderByProject, setSessionOrderByProject] = useState<Record<string, string[]>>(() => readStringArrayRecord(SESSION_ORDER_STORAGE_KEY));
  const [readTimestampsByRuntime, setReadTimestampsByRuntime] = useState<Record<string, number>>(() => readNumberRecord(RUNTIME_READ_TIMESTAMPS_STORAGE_KEY));
  const [draggingProjectId, setDraggingProjectId] = useState<string | undefined>();
  const [draggingSession, setDraggingSession] = useState<DraggingSession | undefined>();
  const [dragTarget, setDragTarget] = useState<DragTarget | undefined>();
  const [sidebarScrolling, setSidebarScrolling] = useState(false);
  const isCompactViewport = useCompactSidebarViewport();
  const rowElementsRef = useRef<Map<string, HTMLElement>>(new Map());
  const previousRowRectsRef = useRef<Map<string, DOMRect>>(new Map());
  const startupReadBaselineAppliedRef = useRef(false);
  const sidebarScrollHideTimerRef = useRef<number | undefined>(undefined);

  useEffect(() => {
    setProjectOrder((current) => {
      const ids = projects.map((project) => project.id);
      const existing = current.filter((id) => ids.includes(id));
      const next = [...existing, ...ids.filter((id) => !existing.includes(id))];
      if (next.length === current.length && next.every((id, index) => id === current[index])) return current;
      return next;
    });
  }, [projects]);

  useEffect(() => {
    writeStringArray(PROJECT_ORDER_STORAGE_KEY, projectOrder);
  }, [projectOrder]);

  useEffect(() => {
    setSessionOrderByProject((current) => {
      const projectIds = new Set(projects.map((project) => project.id));
      const currentKeys = Object.keys(current);
      const runtimeIdsByProject = new Map<string, string[]>();

      for (const runtime of runtimes) {
        const ids = runtimeIdsByProject.get(runtime.projectId) ?? [];
        ids.push(runtime.id);
        runtimeIdsByProject.set(runtime.projectId, ids);
      }

      const next: Record<string, string[]> = {};
      let changed = currentKeys.length !== projects.length || currentKeys.some((projectId) => !projectIds.has(projectId));

      for (const project of projects) {
        const ids = runtimeIdsByProject.get(project.id) ?? [];
        const idSet = new Set(ids);
        const currentOrder = current[project.id] ?? [];
        const existing = currentOrder.filter((id) => idSet.has(id));
        const existingSet = new Set(existing);
        const normalized = [...existing, ...ids.filter((id) => !existingSet.has(id))];
        next[project.id] = normalized;
        if (!arraysEqual(normalized, currentOrder)) changed = true;
      }

      return changed ? next : current;
    });
  }, [projects, runtimes]);

  useEffect(() => {
    writeStringArrayRecord(SESSION_ORDER_STORAGE_KEY, sessionOrderByProject);
  }, [sessionOrderByProject]);

  useEffect(() => {
    writeNumberRecord(RUNTIME_READ_TIMESTAMPS_STORAGE_KEY, readTimestampsByRuntime);
  }, [readTimestampsByRuntime]);

  useEffect(() => {
    const runtimeIds = new Set(runtimes.map((runtime) => runtime.id));
    setReadTimestampsByRuntime((current) => {
      const entries = Object.entries(current).filter(([runtimeId]) => runtimeIds.has(runtimeId));
      return entries.length === Object.keys(current).length ? current : Object.fromEntries(entries);
    });
  }, [runtimes]);

  useEffect(() => {
    writeStringArray(COLLAPSED_PROJECTS_STORAGE_KEY, [...collapsedProjectIds]);
  }, [collapsedProjectIds]);

  useEffect(() => {
    return () => {
      if (sidebarScrollHideTimerRef.current !== undefined) window.clearTimeout(sidebarScrollHideTimerRef.current);
    };
  }, []);

  useLayoutEffect(() => {
    const previousRects = previousRowRectsRef.current;
    if (previousRects.size === 0) return;
    previousRowRectsRef.current = new Map();
    if (window.matchMedia("(prefers-reduced-motion: reduce)").matches) return;

    for (const [key, element] of rowElementsRef.current) {
      const previousRect = previousRects.get(key);
      if (!previousRect) continue;

      const nextRect = element.getBoundingClientRect();
      const deltaX = previousRect.left - nextRect.left;
      const deltaY = previousRect.top - nextRect.top;
      if (Math.abs(deltaX) < 1 && Math.abs(deltaY) < 1) continue;

      element.getAnimations().forEach((animation) => animation.cancel());
      element.animate(
        [
          { transform: `translate(${deltaX}px, ${deltaY}px)` },
          { transform: "translate(0, 0)" },
        ],
        { duration: 190, easing: "cubic-bezier(0.2, 0.9, 0.2, 1)" },
      );
    }
  });

  useEffect(() => {
    const root = document.documentElement;
    const reduceMotion = window.matchMedia("(prefers-reduced-motion: reduce)").matches;

    if (reduceMotion) {
      root.style.setProperty("--session-dot-breathe-opacity", "1");
      root.style.setProperty("--session-dot-breathe-scale", "1");
      return () => clearSessionDotBreatheVars(root);
    }

    let frameId = 0;
    const updateBreathePhase = () => {
      const phase = (Date.now() % SESSION_DOT_BREATHE_DURATION_MS) / SESSION_DOT_BREATHE_DURATION_MS;
      const eased = (1 - Math.cos(phase * 2 * Math.PI)) / 2;
      root.style.setProperty("--session-dot-breathe-opacity", (0.46 + eased * 0.54).toFixed(3));
      root.style.setProperty("--session-dot-breathe-scale", (0.82 + eased * 0.18).toFixed(3));
      frameId = window.requestAnimationFrame(updateBreathePhase);
    };

    updateBreathePhase();
    return () => {
      window.cancelAnimationFrame(frameId);
      clearSessionDotBreatheVars(root);
    };
  }, []);

  const orderedProjects = useMemo(() => {
    const projectById = new Map(projects.map((project) => [project.id, project]));
    const ordered = projectOrder.flatMap((id) => {
      const project = projectById.get(id);
      return project ? [project] : [];
    });
    const orderedIds = new Set(ordered.map((project) => project.id));
    return [...ordered, ...projects.filter((project) => !orderedIds.has(project.id))];
  }, [projectOrder, projects]);
  const sessionById = useMemo(() => new Map(sessions.map((session) => [session.id, session])), [sessions]);
  const activeRuntimeCompletedAt = activeRuntime ? completedAssistantReplyAt(conversationSummaries[activeRuntime.id], messagesByRuntime[activeRuntime.id]) : undefined;

  useEffect(() => {
    if (startupReadBaselineAppliedRef.current) return;
    if (runtimes.length === 0 && Object.keys(conversationSummaries).length === 0) return;

    const baselineReadTimestamps = new Map<string, number>();
    for (const runtime of runtimes) {
      if (runtime.archivedAt) continue;
      const completedAt = completedAssistantReplyAt(conversationSummaries[runtime.id], messagesByRuntime[runtime.id]);
      if (completedAt) baselineReadTimestamps.set(runtime.id, completedAt);
    }

    startupReadBaselineAppliedRef.current = true;
    if (baselineReadTimestamps.size === 0) return;

    setReadTimestampsByRuntime((current) => {
      let changed = false;
      const next = { ...current };
      for (const [runtimeId, completedAt] of baselineReadTimestamps) {
        if ((next[runtimeId] ?? 0) >= completedAt) continue;
        next[runtimeId] = completedAt;
        changed = true;
      }
      return changed ? next : current;
    });
  }, [runtimes, conversationSummaries, messagesByRuntime]);

  useEffect(() => {
    if (!activeRuntime || !activeRuntimeCompletedAt) return;
    markRuntimeConversationRead(activeRuntime.id, activeRuntimeCompletedAt);
  }, [activeRuntime?.id, activeRuntimeCompletedAt]);

  function toggleProjectCollapsed(projectId: string) {
    setCollapsedProjectIds((current) => {
      const next = new Set(current);
      if (next.has(projectId)) next.delete(projectId);
      else next.add(projectId);
      return next;
    });
  }

  function markRuntimeConversationRead(runtimeId: string, completedAt: number | undefined) {
    if (!completedAt) return;
    setReadTimestampsByRuntime((current) => {
      if ((current[runtimeId] ?? 0) >= completedAt) return current;
      return { ...current, [runtimeId]: Math.max(Date.now(), completedAt) };
    });
  }

  function orderedRuntimesForProject(projectId: string, projectRuntimes: Runtime[]): Runtime[] {
    const order = sessionOrderByProject[projectId] ?? [];
    if (order.length === 0) return projectRuntimes;

    const runtimeById = new Map(projectRuntimes.map((runtime) => [runtime.id, runtime]));
    const ordered = order.flatMap((id) => {
      const runtime = runtimeById.get(id);
      return runtime ? [runtime] : [];
    });
    const orderedIds = new Set(ordered.map((runtime) => runtime.id));
    return [...ordered, ...projectRuntimes.filter((runtime) => !orderedIds.has(runtime.id))];
  }

  function captureRowRects() {
    previousRowRectsRef.current = new Map(
      [...rowElementsRef.current].map(([key, element]) => [key, element.getBoundingClientRect()]),
    );
  }

  function registerRowElement(key: string, element: HTMLElement | null) {
    if (element) rowElementsRef.current.set(key, element);
    else rowElementsRef.current.delete(key);
  }

  function handleProjectDragStart(event: DragEvent<HTMLElement>, projectId: string) {
    setDraggingProjectId(projectId);
    setDragTarget(undefined);
    event.dataTransfer.effectAllowed = "move";
    event.dataTransfer.setData(PROJECT_DRAG_MIME, projectId);
    event.dataTransfer.setData("text/plain", projectId);
    setSidebarDragImage(event);
  }

  function handleProjectDragOver(event: DragEvent<HTMLElement>, targetProjectId: string) {
    if (draggingSession) return;
    const draggedProjectId = draggingProjectId ?? event.dataTransfer.getData(PROJECT_DRAG_MIME);
    if (!draggedProjectId || draggedProjectId === targetProjectId) return;

    event.preventDefault();
    event.dataTransfer.dropEffect = "move";
    const position = dropPositionForPointer(event);
    setDragTarget({ kind: "project", projectId: targetProjectId, position });
    captureRowRects();
    setProjectOrder((current) => moveOrderedId(current, projects.map((project) => project.id), draggedProjectId, targetProjectId, position));
  }

  function handleProjectDrop(event: DragEvent<HTMLElement>) {
    if (!draggingProjectId) return;
    event.preventDefault();
    clearDragState();
  }

  function handleSessionDragStart(event: DragEvent<HTMLElement>, projectId: string, runtimeId: string) {
    const payload = { projectId, runtimeId };
    setDraggingSession(payload);
    setDragTarget(undefined);
    event.stopPropagation();
    event.dataTransfer.effectAllowed = "move";
    event.dataTransfer.setData(SESSION_DRAG_MIME, JSON.stringify(payload));
    event.dataTransfer.setData("text/plain", runtimeId);
    setSidebarDragImage(event);
  }

  function handleSessionDragOver(event: DragEvent<HTMLElement>, targetProjectId: string, targetRuntimeId: string) {
    const dragged = readSessionDragData(event, draggingSession);
    if (!dragged || dragged.projectId !== targetProjectId || dragged.runtimeId === targetRuntimeId) return;

    event.preventDefault();
    event.stopPropagation();
    event.dataTransfer.dropEffect = "move";
    const position = dropPositionForPointer(event);
    setDragTarget({ kind: "session", projectId: targetProjectId, runtimeId: targetRuntimeId, position });
    captureRowRects();
    setSessionOrderByProject((current) => {
      const runtimeIds = runtimes.filter((runtime) => runtime.projectId === targetProjectId).map((runtime) => runtime.id);
      const currentOrder = current[targetProjectId] ?? [];
      const nextOrder = moveOrderedId(currentOrder, runtimeIds, dragged.runtimeId, targetRuntimeId, position);
      return nextOrder === currentOrder ? current : { ...current, [targetProjectId]: nextOrder };
    });
  }

  function handleSessionDrop(event: DragEvent<HTMLElement>) {
    if (!draggingSession) return;
    event.preventDefault();
    event.stopPropagation();
    clearDragState();
  }

  function clearDragState() {
    setDraggingProjectId(undefined);
    setDraggingSession(undefined);
    setDragTarget(undefined);
  }

  function handleSidebarScroll() {
    setSidebarScrolling(true);
    if (sidebarScrollHideTimerRef.current !== undefined) window.clearTimeout(sidebarScrollHideTimerRef.current);
    sidebarScrollHideTimerRef.current = window.setTimeout(() => {
      sidebarScrollHideTimerRef.current = undefined;
      setSidebarScrolling(false);
    }, SIDEBAR_SCROLLBAR_VISIBLE_MS);
  }

  function projectDropClass(projectId: string): string {
    if (dragTarget?.kind !== "project" || dragTarget.projectId !== projectId || draggingProjectId === projectId) return "";
    return dragTarget.position === "before" ? "drop-before" : "drop-after";
  }

  function sessionDropClass(projectId: string, runtimeId: string): string {
    if (dragTarget?.kind !== "session" || dragTarget.projectId !== projectId || dragTarget.runtimeId !== runtimeId || draggingSession?.runtimeId === runtimeId) {
      return "";
    }
    return dragTarget.position === "before" ? "drop-before" : "drop-after";
  }

  const sidebarClassName = `left-sidebar ${projects.length === 0 ? "empty-projects" : ""} ${draggingProjectId ? "dragging-project" : ""} ${draggingSession ? "dragging-session" : ""} ${isCompactViewport ? "is-compact-viewport" : ""} ${compactExpanded ? "is-compact-expanded" : ""}`;

  return (
    <aside className={sidebarClassName}>
      <div className={`sidebar-content ${sidebarScrolling ? "is-scrolling" : ""}`} onScroll={handleSidebarScroll}>
        <div className="brand sidebar-brand">
          <PiLogo compactMode={isCompactViewport} compactExpanded={compactExpanded} onToggleCompact={onToggleCompact} />
          <div className="brand-actions">
            <button
              className="global-new-chat icon-button"
              type="button"
              title="添加项目"
              aria-label="添加项目"
              onClick={onAddProject}
              disabled={connection !== "open"}
            >
              <Icon name="plus" />
            </button>
          </div>
        </div>

        <section className="sidebar-section project-list-section" aria-label="项目">
          {projects.length === 0 ? <p className="muted">暂无项目。</p> : null}
          {orderedProjects.map((project) => {
            const collapsed = collapsedProjectIds.has(project.id);
            const selected = project.id === selectedProject?.id;
            const projectRuntimes = orderedRuntimesForProject(
              project.id,
              runtimes.filter((runtime) => runtime.projectId === project.id && !runtime.archivedAt),
            );
            const projectSessions = sessions.filter((session) => session.projectId === project.id);
            return (
              <article
                className={`project-session-group ${selected ? "selected" : ""} ${collapsed ? "collapsed" : ""} ${draggingProjectId === project.id ? "dragging" : ""} ${projectDropClass(project.id)}`}
                key={project.id}
                ref={(element) => registerRowElement(`project:${project.id}`, element)}
                onDragOver={(event) => handleProjectDragOver(event, project.id)}
                onDrop={handleProjectDrop}
              >
                <div
                  className="project-row"
                  draggable
                  onDragStart={(event) => handleProjectDragStart(event, project.id)}
                  onDragEnd={clearDragState}
                >
                  <button
                    className="project-select"
                    type="button"
                    title={collapsed ? "点击选择，双击展开，拖动排序" : "点击选择，双击折叠，拖动排序"}
                    aria-expanded={!collapsed}
                    onClick={() => onSelectProject(project.id)}
                    onDoubleClick={(event) => {
                      event.preventDefault();
                      toggleProjectCollapsed(project.id);
                    }}
                  >
                    <strong>{project.name}</strong>
                    <small>{project.cwd}</small>
                  </button>
                  <button
                    className="project-checkpoints icon-button"
                    type="button"
                    title="查看检查点"
                    aria-label={`查看 ${project.name} 的检查点`}
                    onClick={() => onOpenCheckpoints(project.id, activeRuntime?.projectId === project.id ? activeRuntime.id : undefined)}
                    disabled={connection !== "open"}
                  >
                    <Icon name="checkpoint" />
                  </button>
                  <button
                    className="project-new-chat icon-button"
                    type="button"
                    title="在此项目中新建对话"
                    aria-label="在此项目中新建对话"
                    onClick={() => onStartRuntimeForProject(project.id)}
                    disabled={connection !== "open"}
                  >
                    <Icon name="plus" />
                  </button>
                </div>
                {!collapsed ? (
                  <div className="session-list">
                    {projectRuntimes.map((runtime) => {
                      const summary = conversationSummaries[runtime.id];
                      const linkedSession = runtime.sessionId ? sessionById.get(runtime.sessionId) : undefined;
                      const title = sessionTitle(runtime, summary, linkedSession);
                      const detail = sessionDetail(runtime, summary, linkedSession);
                      const completedAt = completedAssistantReplyAt(summary, messagesByRuntime[runtime.id]);
                      const hasUnreadReply = Boolean(completedAt && completedAt > (readTimestampsByRuntime[runtime.id] ?? 0));
                      const dotState = sessionDotState(busyByRuntime[runtime.id] ?? false, hasUnreadReply);
                      return (
                        <div
                          className={`session-row ${runtime.id === activeRuntime?.id ? "selected" : ""} ${draggingSession?.runtimeId === runtime.id ? "dragging" : ""} ${sessionDropClass(project.id, runtime.id)}`}
                          key={runtime.id}
                          ref={(element) => registerRowElement(`session:${runtime.id}`, element)}
                          onDragOver={(event) => handleSessionDragOver(event, project.id, runtime.id)}
                          onDrop={handleSessionDrop}
                        >
                          <button
                            className="session-item"
                            type="button"
                            draggable
                            title={detail ? `${title}\n${detail}\n拖动排序` : `${title}\n拖动排序`}
                            onClick={() => {
                              markRuntimeConversationRead(runtime.id, completedAt);
                              onSelectRuntime(project.id, runtime.id);
                            }}
                            onDragStart={(event) => handleSessionDragStart(event, project.id, runtime.id)}
                            onDragEnd={clearDragState}
                          >
                            <span className={`status-dot ${dotState}`} title={sessionDotTitle(dotState)} aria-hidden="true" />
                            <span className="session-text">
                              <span className="session-title">{title}</span>
                              {detail ? <small className="session-detail">{detail}</small> : null}
                            </span>
                            {runtime.archivedAt ? <small className="session-badge">归档</small> : null}
                          </button>
                          {!runtime.archivedAt ? (
                            <button
                              className="session-archive icon-button"
                              type="button"
                              title="归档对话"
                              aria-label={`归档对话 ${runtime.id.slice(0, 8)}`}
                              onClick={() => onArchiveRuntime(runtime.id)}
                              disabled={runtime.id === activeRuntime?.id && activeRuntimeIsBusy}
                            >
                              <Icon name="archive" />
                            </button>
                          ) : null}
                        </div>
                      );
                    })}
                    {projectSessions.length > 0 ? (
                      <button
                        className="session-history-link"
                        type="button"
                        title={`查看 ${project.name} 的历史对话`}
                        aria-label={`查看 ${project.name} 的历史对话`}
                        onClick={() => onOpenSessionHistory(project.id)}
                      >
                        <span>查看历史对话…</span>
                        <small>{projectSessions.length}</small>
                      </button>
                    ) : null}
                  </div>
                ) : null}
              </article>
            );
          })}
        </section>

        <div className="sidebar-footer">
          <button className="settings-entry icon-button" type="button" title="设置" aria-label="设置" onClick={onOpenSettings}>
            <Icon name="settings" />
          </button>
        </div>
      </div>
    </aside>
  );
}

function useCompactSidebarViewport(): boolean {
  const [matches, setMatches] = useState(false);

  useEffect(() => {
    const media = window.matchMedia("(max-width: 700px)");
    const update = () => setMatches(media.matches);
    update();
    media.addEventListener("change", update);
    return () => media.removeEventListener("change", update);
  }, []);

  return matches;
}

type SessionDotState = "task-idle" | "task-busy" | "task-unread";

function sessionDotState(busy: boolean, hasUnreadReply: boolean): SessionDotState {
  if (busy) return "task-busy";
  if (hasUnreadReply) return "task-unread";
  return "task-idle";
}

function completedAssistantReplyAt(summary: RuntimeConversationSummary | undefined, messages: ConversationMessage[] | undefined): number | undefined {
  if (summary?.latestAssistantCompletedAt) return summary.latestAssistantCompletedAt;
  const assistantMessage = latestCompletedAssistantMessage(messages);
  const assistantUpdatedAt = assistantMessage?.updatedAt ?? assistantMessage?.timestamp;
  if (assistantUpdatedAt) return assistantUpdatedAt;
  if (!assistantMessage && (summary?.messageCount ?? 0) < 2) return undefined;
  return summary?.updatedAt;
}

function latestCompletedAssistantMessage(messages: ConversationMessage[] | undefined): ConversationMessage | undefined {
  if (!messages) return undefined;
  for (let index = messages.length - 1; index >= 0; index -= 1) {
    const message = messages[index];
    if (message.role === "assistant" && !message.isStreaming && Boolean(message.text.trim() || message.thinking?.trim())) return message;
  }
  return undefined;
}

function sessionDotTitle(state: SessionDotState): string {
  if (state === "task-busy") return "Agent 正在生成回复";
  if (state === "task-unread") return "有未读回复，点击查看";
  return "无未读回复";
}

function sessionTitle(runtime: Runtime, summary: RuntimeConversationSummary | undefined, session: GuiSession | undefined): string {
  if (summary?.title) return summary.title;
  if (session?.title) return session.title;
  if (runtime.sessionId) return "已保存对话";
  if (runtime.status === "running" || runtime.status === "starting") return "新对话";
  return `对话 ${runtime.id.slice(0, 8)}`;
}

function sessionDetail(runtime: Runtime, summary: RuntimeConversationSummary | undefined, session: GuiSession | undefined): string | undefined {
  if (summary?.detail) return summary.detail;
  if (summary?.messageCount) return `${summary.messageCount} 条消息`;
  if (runtime.sessionId) return `Session ${runtime.sessionId.slice(0, 8)}`;
  if (session) return formatSessionDate(session.updatedAt);
  return undefined;
}

function formatSessionDate(timestamp: number): string {
  try {
    return new Intl.DateTimeFormat("zh-CN", { month: "2-digit", day: "2-digit", hour: "2-digit", minute: "2-digit" }).format(new Date(timestamp));
  } catch {
    return "未知时间";
  }
}

function clearSessionDotBreatheVars(root: HTMLElement): void {
  root.style.removeProperty("--session-dot-breathe-opacity");
  root.style.removeProperty("--session-dot-breathe-scale");
}

function readSessionDragData(event: DragEvent<HTMLElement>, fallback: DraggingSession | undefined): DraggingSession | undefined {
  if (fallback) return fallback;
  const raw = event.dataTransfer.getData(SESSION_DRAG_MIME);
  if (!raw) return undefined;

  try {
    const parsed = JSON.parse(raw) as Partial<DraggingSession>;
    if (typeof parsed.projectId === "string" && typeof parsed.runtimeId === "string") return parsed as DraggingSession;
  } catch {
    // Ignore invalid drag payloads from outside the app.
  }
  return undefined;
}

function readStringArray(key: string): string[] {
  try {
    const value = window.localStorage.getItem(key);
    if (!value) return [];
    const parsed = JSON.parse(value) as unknown;
    return Array.isArray(parsed) ? parsed.filter((item): item is string => typeof item === "string") : [];
  } catch {
    return [];
  }
}

function readStringArrayRecord(key: string): Record<string, string[]> {
  try {
    const value = window.localStorage.getItem(key);
    if (!value) return {};
    const parsed = JSON.parse(value) as unknown;
    if (!parsed || typeof parsed !== "object" || Array.isArray(parsed)) return {};

    return Object.fromEntries(
      Object.entries(parsed).flatMap(([recordKey, recordValue]) => {
        if (!Array.isArray(recordValue)) return [];
        return [[recordKey, recordValue.filter((item): item is string => typeof item === "string")]];
      }),
    );
  } catch {
    return {};
  }
}

function readNumberRecord(key: string): Record<string, number> {
  try {
    const value = window.localStorage.getItem(key);
    if (!value) return {};
    const parsed = JSON.parse(value) as unknown;
    if (!parsed || typeof parsed !== "object" || Array.isArray(parsed)) return {};

    return Object.fromEntries(
      Object.entries(parsed).flatMap(([recordKey, recordValue]) => {
        if (typeof recordValue !== "number" || !Number.isFinite(recordValue)) return [];
        return [[recordKey, recordValue]];
      }),
    );
  } catch {
    return {};
  }
}

function writeStringArray(key: string, value: string[]) {
  try {
    window.localStorage.setItem(key, JSON.stringify(value));
  } catch {
    // Ignore unavailable localStorage; project ordering still works for the current page lifetime.
  }
}

function writeStringArrayRecord(key: string, value: Record<string, string[]>) {
  try {
    window.localStorage.setItem(key, JSON.stringify(value));
  } catch {
    // Ignore unavailable localStorage; session ordering still works for the current page lifetime.
  }
}

function writeNumberRecord(key: string, value: Record<string, number>) {
  try {
    window.localStorage.setItem(key, JSON.stringify(value));
  } catch {
    // Ignore unavailable localStorage; unread state still works for the current page lifetime.
  }
}

function dropPositionForPointer(event: DragEvent<HTMLElement>): DropPosition {
  const bounds = event.currentTarget.getBoundingClientRect();
  return event.clientY > bounds.top + bounds.height / 2 ? "after" : "before";
}

function moveOrderedId(currentOrder: string[], allIds: string[], draggedId: string, targetId: string, position: DropPosition): string[] {
  const allIdSet = new Set(allIds);
  const existing = currentOrder.filter((id) => allIdSet.has(id));
  const existingSet = new Set(existing);
  const baseOrder = [...existing, ...allIds.filter((id) => !existingSet.has(id))];
  if (!baseOrder.includes(draggedId) || !baseOrder.includes(targetId) || draggedId === targetId) return currentOrder;

  const withoutDragged = baseOrder.filter((id) => id !== draggedId);
  const targetIndex = withoutDragged.indexOf(targetId);
  if (targetIndex === -1) return currentOrder;

  const nextOrder = [...withoutDragged];
  nextOrder.splice(targetIndex + (position === "after" ? 1 : 0), 0, draggedId);
  return arraysEqual(nextOrder, currentOrder) ? currentOrder : nextOrder;
}

function setSidebarDragImage(event: DragEvent<HTMLElement>) {
  const source = event.currentTarget.closest<HTMLElement>(".project-row, .session-row") ?? event.currentTarget;
  const bounds = source.getBoundingClientRect();
  const preview = source.cloneNode(true) as HTMLElement;
  preview.classList.add("sidebar-drag-preview");
  preview.style.position = "fixed";
  preview.style.top = "-1000px";
  preview.style.left = "-1000px";
  preview.style.width = `${bounds.width}px`;
  preview.style.pointerEvents = "none";
  document.body.appendChild(preview);
  event.dataTransfer.setDragImage(preview, 18, Math.min(28, bounds.height / 2));
  window.setTimeout(() => preview.remove(), 0);
}

function arraysEqual(left: string[], right: string[]): boolean {
  return left.length === right.length && left.every((value, index) => value === right[index]);
}
