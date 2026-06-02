import type { Project, Runtime } from "@pi-gui/shared";
import type { ConnectionState } from "../types";
import { Icon } from "./Icon";

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
                  <button className="project-select" type="button" onClick={() => onSelectProject(project.id)}>
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
