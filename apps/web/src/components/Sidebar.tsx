import type { DragEvent } from "react";
import { useEffect, useMemo, useState } from "react";
import type { Project, Runtime } from "@pi-gui/shared";
import type { ConnectionState } from "../types";
import { Icon } from "./Icon";

const PROJECT_ORDER_STORAGE_KEY = "pi-gui.projectOrder";
const COLLAPSED_PROJECTS_STORAGE_KEY = "pi-gui.collapsedProjects";

type SidebarProps = {
  connection: ConnectionState;
  projects: Project[];
  runtimes: Runtime[];
  selectedProject?: Project;
  activeRuntime?: Runtime;
  showArchived: boolean;
  activeRuntimeIsBusy: boolean;
  onStartRuntime: () => void;
  onStartRuntimeForProject: (projectId: string) => void;
  onSelectProject: (projectId: string) => void;
  onSelectRuntime: (projectId: string, runtimeId: string) => void;
  onArchiveRuntime: (runtimeId: string) => void;
};

export function Sidebar({
  connection,
  projects,
  runtimes,
  selectedProject,
  activeRuntime,
  showArchived,
  activeRuntimeIsBusy,
  onStartRuntime,
  onStartRuntimeForProject,
  onSelectProject,
  onSelectRuntime,
  onArchiveRuntime,
}: SidebarProps) {
  const [collapsedProjectIds, setCollapsedProjectIds] = useState<Set<string>>(() => new Set(readStringArray(COLLAPSED_PROJECTS_STORAGE_KEY)));
  const [projectOrder, setProjectOrder] = useState<string[]>(() => readStringArray(PROJECT_ORDER_STORAGE_KEY));
  const [draggingProjectId, setDraggingProjectId] = useState<string | undefined>();

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
    writeStringArray(COLLAPSED_PROJECTS_STORAGE_KEY, [...collapsedProjectIds]);
  }, [collapsedProjectIds]);

  const orderedProjects = useMemo(() => {
    const projectById = new Map(projects.map((project) => [project.id, project]));
    const ordered = projectOrder.flatMap((id) => {
      const project = projectById.get(id);
      return project ? [project] : [];
    });
    const orderedIds = new Set(ordered.map((project) => project.id));
    return [...ordered, ...projects.filter((project) => !orderedIds.has(project.id))];
  }, [projectOrder, projects]);

  function toggleProjectCollapsed(projectId: string) {
    setCollapsedProjectIds((current) => {
      const next = new Set(current);
      if (next.has(projectId)) next.delete(projectId);
      else next.add(projectId);
      return next;
    });
  }

  function handleProjectDragStart(event: DragEvent<HTMLElement>, projectId: string) {
    setDraggingProjectId(projectId);
    event.dataTransfer.effectAllowed = "move";
    event.dataTransfer.setData("text/plain", projectId);
  }

  function handleProjectDragOver(event: DragEvent<HTMLElement>, targetProjectId: string) {
    const draggedProjectId = draggingProjectId ?? event.dataTransfer.getData("text/plain");
    if (!draggedProjectId || draggedProjectId === targetProjectId) return;
    event.preventDefault();
    event.dataTransfer.dropEffect = "move";
  }

  function handleProjectDrop(event: DragEvent<HTMLElement>, targetProjectId: string) {
    const draggedProjectId = draggingProjectId ?? event.dataTransfer.getData("text/plain");
    if (!draggedProjectId || draggedProjectId === targetProjectId) return;

    event.preventDefault();
    const targetBounds = event.currentTarget.getBoundingClientRect();
    const placeAfterTarget = event.clientY > targetBounds.top + targetBounds.height / 2;

    setProjectOrder((current) => {
      const baseOrder = current.length ? current : projects.map((project) => project.id);
      if (!baseOrder.includes(draggedProjectId) || !baseOrder.includes(targetProjectId)) return current;

      const withoutDragged = baseOrder.filter((id) => id !== draggedProjectId);
      const targetIndex = withoutDragged.indexOf(targetProjectId);
      if (targetIndex === -1) return current;

      const next = [...withoutDragged];
      next.splice(targetIndex + (placeAfterTarget ? 1 : 0), 0, draggedProjectId);
      return next;
    });
    setDraggingProjectId(undefined);
  }

  return (
    <aside className="left-sidebar">
      <div className="sidebar-content">
        <div className="brand no-logo">
          <div className="brand-actions">
            <button
              className="global-new-chat icon-button"
              type="button"
              title="新建对话"
              aria-label="新建对话"
              onClick={onStartRuntime}
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
            const projectRuntimes = runtimes.filter((runtime) => runtime.projectId === project.id && (showArchived || !runtime.archivedAt));
            return (
              <article
                className={`project-session-group ${selected ? "selected" : ""} ${collapsed ? "collapsed" : ""} ${draggingProjectId === project.id ? "dragging" : ""}`}
                key={project.id}
                onDragOver={(event) => handleProjectDragOver(event, project.id)}
                onDrop={(event) => handleProjectDrop(event, project.id)}
              >
                <div
                  className="project-row"
                  draggable
                  onDragStart={(event) => handleProjectDragStart(event, project.id)}
                  onDragEnd={() => setDraggingProjectId(undefined)}
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
                    {projectRuntimes.map((runtime) => (
                      <div className={`session-row ${runtime.id === activeRuntime?.id ? "selected" : ""}`} key={runtime.id}>
                        <button
                          className="session-item"
                          type="button"
                          onClick={() => onSelectRuntime(project.id, runtime.id)}
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
                            onClick={() => onArchiveRuntime(runtime.id)}
                            disabled={runtime.id === activeRuntime?.id && activeRuntimeIsBusy}
                          >
                            <Icon name="archive" />
                          </button>
                        ) : null}
                      </div>
                    ))}
                  </div>
                ) : null}
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
  );
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

function writeStringArray(key: string, value: string[]) {
  try {
    window.localStorage.setItem(key, JSON.stringify(value));
  } catch {
    // Ignore unavailable localStorage; project ordering still works for the current page lifetime.
  }
}
