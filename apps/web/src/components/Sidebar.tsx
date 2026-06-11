import { useEffect, useMemo, useRef, useState } from "react";
import type { ConversationMessage, GuiEvent, GuiSession, Project, Runtime, RuntimeConversationSummary } from "@pi-gui/shared";
import { isConnectionReady } from "../domain/connection";
import type { ConnectionState } from "../types";
import { runtimeHasVisibleConversationContent } from "../domain/conversationVisibility";
import { mediaQueryMatches, subscribeMediaQuery } from "../domain/mediaQuery";
import { isRecoverableRuntimeInterruption } from "../domain/runtimeRecovery";
import { sidebarSessionDetail, sidebarSessionTitle } from "../domain/sidebarSessions";
import { IconButton } from "./ui";
import { completedAssistantReplyAt, sessionDotState, sessionDotTitle, useSidebarDragReorder, useSidebarOrdering } from "./sidebar";

const SESSION_DOT_BREATHE_DURATION_MS = 1350;
const SIDEBAR_SCROLLBAR_VISIBLE_MS = 850;

type SidebarProps = {
  connection: ConnectionState;
  projects: Project[];
  runtimes: Runtime[];
  sessions: GuiSession[];
  selectedProject?: Project;
  activeRuntime?: Runtime;
  activeRuntimeIsBusy: boolean;
  instanceTag?: string;
  busyByRuntime: Record<string, boolean>;
  messagesByRuntime: Record<string, ConversationMessage[]>;
  conversationSummaries: Record<string, RuntimeConversationSummary>;
  guiEvents: GuiEvent[];
  onAddProject: () => void;
  onStartRuntimeForProject: (projectId: string) => void;
  onOpenSessionHistory: (projectId: string) => void;
  onSelectProject: (projectId: string) => void;
  onSelectRuntime: (projectId: string, runtimeId: string) => void;
  compactExpanded: boolean;
  onToggleCompact: () => void;
  onArchiveRuntime: (runtimeId: string) => void;
  onOpenRuntimeLogs?: (runtimeId: string) => void;
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
  instanceTag,
  busyByRuntime,
  messagesByRuntime,
  conversationSummaries,
  guiEvents,
  onAddProject,
  onStartRuntimeForProject,
  onOpenSessionHistory,
  compactExpanded,
  onToggleCompact,
  onSelectProject,
  onSelectRuntime,
  onArchiveRuntime,
  onOpenRuntimeLogs,
  onOpenSettings,
}: SidebarProps) {
  const [sidebarScrolling, setSidebarScrolling] = useState(false);
  const isCompactViewport = useCompactSidebarViewport();
  const isCoarsePointer = useCoarsePointerViewport();
  const mobileSidebarInteractions = isCompactViewport || isCoarsePointer;
  const sidebarScrollHideTimerRef = useRef<number | undefined>(undefined);
  const sessionById = useMemo(() => new Map(sessions.map((session) => [session.id, session])), [sessions]);
  const visibleRuntimesByProject = useMemo(
    () => groupVisibleRuntimesByProject(runtimes, sessionById, conversationSummaries, messagesByRuntime),
    [conversationSummaries, messagesByRuntime, runtimes, sessionById],
  );
  const recoverableInterruptionByRuntimeId = useMemo(
    () => new Map(runtimes.map((runtime) => [runtime.id, isRecoverableRuntimeInterruption(runtime, guiEvents)])),
    [guiEvents, runtimes],
  );
  const {
    collapsedProjectIds,
    orderedProjects,
    readTimestampsByRuntime,
    setProjectOrder,
    setSessionOrderByProject,
    toggleProjectCollapsed,
    markRuntimeConversationRead,
    orderedRuntimesForProject,
  } = useSidebarOrdering({ projects, runtimes, activeRuntime, messagesByRuntime, conversationSummaries });
  const {
    draggingProjectId,
    draggingSession,
    registerRowElement,
    handleProjectDragStart,
    handleProjectDragOver,
    handleProjectDrop,
    handleProjectPointerDown,
    handleSessionDragStart,
    handleSessionDragOver,
    handleSessionDrop,
    handleSessionPointerDown,
    consumePointerDragClick,
    clearDragState,
    projectDropClass,
    sessionDropClass,
  } = useSidebarDragReorder({ projects, runtimes, setProjectOrder, setSessionOrderByProject });

  useEffect(() => {
    return () => {
      if (sidebarScrollHideTimerRef.current !== undefined) window.clearTimeout(sidebarScrollHideTimerRef.current);
    };
  }, []);

  useEffect(() => {
    const root = document.documentElement;
    const reduceMotion = mediaQueryMatches("(prefers-reduced-motion: reduce)");

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

  function handleSidebarScroll() {
    setSidebarScrolling(true);
    if (sidebarScrollHideTimerRef.current !== undefined) window.clearTimeout(sidebarScrollHideTimerRef.current);
    sidebarScrollHideTimerRef.current = window.setTimeout(() => {
      sidebarScrollHideTimerRef.current = undefined;
      setSidebarScrolling(false);
    }, SIDEBAR_SCROLLBAR_VISIBLE_MS);
  }

  const sidebarClassName = `left-sidebar ${projects.length === 0 ? "empty-projects" : ""} ${draggingProjectId ? "dragging-project" : ""} ${draggingSession ? "dragging-session" : ""} ${isCompactViewport ? "is-compact-viewport" : ""} ${compactExpanded ? "is-compact-expanded" : ""}`;
  const connectionReady = isConnectionReady(connection);

  return (
    <aside className={sidebarClassName}>
      <div className={`sidebar-content ${sidebarScrolling ? "is-scrolling" : ""}`} onScroll={handleSidebarScroll}>
        <section className="sidebar-section project-list-section" aria-label="项目">
          {projects.length === 0 ? (
            <div className="empty-project-actions">
              <p className="muted">暂无项目。</p>
              <IconButton className="empty-project-add" icon="plus" label="添加项目" title="添加项目" onClick={onAddProject} disabled={!connectionReady} />
            </div>
          ) : null}
          {orderedProjects.map((project) => {
            const collapsed = collapsedProjectIds.has(project.id);
            const selected = project.id === selectedProject?.id;
            const projectRuntimes = orderedRuntimesForProject(project.id, visibleRuntimesByProject.get(project.id) ?? EMPTY_RUNTIMES);
            const canExpandProject = projectRuntimes.length > 0;
            const projectExpanded = canExpandProject && !collapsed;
            const projectSelectTitle = mobileSidebarInteractions
              ? canExpandProject
                ? "点击选择项目"
                : "点击选择项目，暂无对话可展开"
              : canExpandProject
                ? collapsed
                  ? "点击选择并展开对话，拖动排序"
                  : "点击选择并收起对话，拖动排序"
                : "点击选择项目，暂无对话可展开，拖动排序";
            return (
              <article
                className={`project-session-group ${selected ? "selected" : ""} ${projectExpanded ? "" : "collapsed"} ${draggingProjectId === project.id ? "dragging" : ""} ${projectDropClass(project.id)}`}
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
                    title={projectSelectTitle}
                    aria-expanded={mobileSidebarInteractions || !canExpandProject ? undefined : projectExpanded}
                    onClick={(event) => {
                      if (consumePointerDragClick()) return;
                      if (event.detail > 1) return;
                      onSelectProject(project.id);
                      if (isCompactViewport && !compactExpanded) {
                        onToggleCompact();
                        return;
                      }
                      if (!mobileSidebarInteractions && canExpandProject) toggleProjectCollapsed(project.id);
                    }}
                    onPointerDown={mobileSidebarInteractions ? (event) => handleProjectPointerDown(event, project.id) : undefined}
                  >
                    <strong>{project.name}</strong>
                    <small>{project.cwd}</small>
                  </button>
                  {canExpandProject ? (
                    <IconButton
                      className="project-collapse-toggle"
                      icon="arrow-right"
                      label={collapsed ? `展开 ${project.name} 的对话` : `收起 ${project.name} 的对话`}
                      title={collapsed ? "展开对话" : "收起对话"}
                      aria-expanded={projectExpanded}
                      onClick={() => toggleProjectCollapsed(project.id)}
                    />
                  ) : null}
                  <IconButton
                    className="project-new-chat"
                    icon="plus"
                    label="在此项目中新建对话"
                    onClick={() => onStartRuntimeForProject(project.id)}
                    disabled={!connectionReady}
                  />
                </div>
                {projectExpanded ? (
                  <div className="session-list">
                    {projectRuntimes.map((runtime) => {
                      const summary = conversationSummaries[runtime.id];
                      const linkedSession = runtime.sessionId ? sessionById.get(runtime.sessionId) : undefined;
                      const title = sidebarSessionTitle(runtime, summary, linkedSession);
                      const detail = sidebarSessionDetail(runtime, summary, linkedSession);
                      const completedAt = completedAssistantReplyAt(summary, messagesByRuntime[runtime.id]);
                      const hasUnreadReply = Boolean(completedAt && completedAt > (readTimestampsByRuntime[runtime.id] ?? 0));
                      const recoverableInterruption = recoverableInterruptionByRuntimeId.get(runtime.id) ?? false;
                      const dotState = sessionDotState(runtime, busyByRuntime[runtime.id] ?? false, hasUnreadReply, recoverableInterruption);
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
                              if (consumePointerDragClick()) return;
                              markRuntimeConversationRead(runtime.id, completedAt);
                              onSelectRuntime(project.id, runtime.id);
                            }}
                            onPointerDown={mobileSidebarInteractions ? (event) => handleSessionPointerDown(event, project.id, runtime.id) : undefined}
                            onDragStart={(event) => handleSessionDragStart(event, project.id, runtime.id)}
                            onDragEnd={clearDragState}
                          >
                            <span className={`status-dot ${dotState}`} title={sessionDotTitle(runtime.status, dotState)} aria-hidden="true" />
                            <span className="session-text">
                              <span className="session-title">{title}</span>
                              {detail ? <small className="session-detail">{detail}</small> : null}
                            </span>
                            {runtime.archivedAt ? <small className="session-badge">归档</small> : null}
                          </button>
                          {onOpenRuntimeLogs ? (
                            <IconButton
                              className={`session-logs ${runtime.status === "crashed" && !recoverableInterruption ? "warning" : ""}`}
                              icon="logs"
                              label={`查看 Runtime 日志 ${runtime.id.slice(0, 8)}`}
                              title={recoverableInterruption ? "查看可恢复会话日志" : runtime.status === "crashed" ? "查看崩溃日志" : "查看 Runtime 日志"}
                              onClick={() => onOpenRuntimeLogs(runtime.id)}
                            />
                          ) : null}
                          {!runtime.archivedAt ? (
                            <IconButton
                              className="session-archive"
                              icon="archive"
                              label={`归档对话 ${runtime.id.slice(0, 8)}`}
                              title="归档对话"
                              onClick={() => onArchiveRuntime(runtime.id)}
                              disabled={runtime.id === activeRuntime?.id && activeRuntimeIsBusy}
                            />
                          ) : null}
                        </div>
                      );
                    })}
                  </div>
                ) : null}
              </article>
            );
          })}
        </section>

      </div>
      <div className="sidebar-footer">
        <IconButton className="add-project-entry" icon="plus" label="添加项目" title="添加项目" onClick={onAddProject} disabled={!connectionReady} />
        <IconButton
          className="archive-entry"
          icon="archive"
          label={selectedProject ? `查看 ${selectedProject.name} 的归档对话` : "归档对话"}
          title={selectedProject ? `查看 ${selectedProject.name} 的归档对话` : "请选择项目后查看归档对话"}
          disabled={!selectedProject}
          onClick={() => {
            if (selectedProject) onOpenSessionHistory(selectedProject.id);
          }}
        />
        <IconButton className="settings-entry" icon="settings" label="设置" onClick={onOpenSettings} />
        {instanceTag ? <span className="sidebar-instance-tag" title={`Pi GUI ${instanceTag} instance`}>{instanceTag}</span> : null}
      </div>
    </aside>
  );
}

const EMPTY_RUNTIMES: Runtime[] = [];

function groupVisibleRuntimesByProject(
  runtimes: Runtime[],
  sessionById: Map<string, GuiSession>,
  conversationSummaries: Record<string, RuntimeConversationSummary>,
  messagesByRuntime: Record<string, ConversationMessage[]>,
): Map<string, Runtime[]> {
  const grouped = new Map<string, Runtime[]>();
  for (const runtime of runtimes) {
    if (runtime.archivedAt) continue;
    const visible = runtime.status === "running" || runtime.status === "starting" || runtime.status === "crashed" || runtimeHasVisibleConversationContent({
      runtime,
      session: runtime.sessionId ? sessionById.get(runtime.sessionId) : undefined,
      summary: conversationSummaries[runtime.id],
      messages: messagesByRuntime[runtime.id],
    });
    if (!visible) continue;
    const items = grouped.get(runtime.projectId) ?? [];
    items.push(runtime);
    grouped.set(runtime.projectId, items);
  }
  return grouped;
}

function useCompactSidebarViewport(): boolean {
  const [matches, setMatches] = useState(() => mediaQueryMatches("(max-width: 700px)"));

  useEffect(() => subscribeMediaQuery("(max-width: 700px)", setMatches), []);

  return matches;
}

function useCoarsePointerViewport(): boolean {
  const [matches, setMatches] = useState(() => mediaQueryMatches("(pointer: coarse)"));

  useEffect(() => subscribeMediaQuery("(pointer: coarse)", setMatches), []);

  return matches;
}

function clearSessionDotBreatheVars(root: HTMLElement): void {
  root.style.removeProperty("--session-dot-breathe-opacity");
  root.style.removeProperty("--session-dot-breathe-scale");
}
