import type React from "react";
import type { ExecutionHostRef, GuiSession, Project, Runtime } from "@pi-gui/shared";
import { executionHostLabel } from "../domain/executionHost";
import type { ConnectionState } from "../types";

type WorkbenchHomeProps = {
  connection: ConnectionState;
  executionHost?: ExecutionHostRef;
  projects: Project[];
  runtimes: Runtime[];
  sessions: GuiSession[];
  selectedProject?: Project;
  busyByRuntime: Record<string, boolean>;
  onAddProject: () => void;
  onSelectProject: (projectId: string) => void;
  onStartRuntimeForProject: (projectId: string) => void;
  onResumeSession: (sessionId: string) => void;
  onOpenSessionHistory: (projectId: string) => void;
  onOpenEnvironmentDiagnostics: () => void;
  onOpenRuntimeLogs: (runtimeId: string) => void;
};

export function WorkbenchHome({
  connection,
  executionHost,
  projects,
  runtimes,
  sessions,
  selectedProject,
  busyByRuntime,
  onAddProject,
  onSelectProject,
  onStartRuntimeForProject,
  onResumeSession,
  onOpenSessionHistory,
  onOpenEnvironmentDiagnostics,
  onOpenRuntimeLogs,
}: WorkbenchHomeProps) {
  const recentProjects = [...projects].sort((a, b) => b.lastOpenedAt - a.lastOpenedAt).slice(0, 5);
  const recentSessions = [...sessions].sort((a, b) => b.updatedAt - a.updatedAt).slice(0, 5);
  const recoverableRuntimes = runtimes.filter((runtime) => !runtime.archivedAt && (runtime.status === "crashed" || runtime.status === "stopped")).slice(0, 4);
  const host = executionHostLabel(executionHost) ?? "未知执行主机";
  const primaryProject = selectedProject ?? recentProjects[0];

  return (
    <div className="workbench-home" aria-label="Workbench Home">
      <section className="workbench-home-hero">
        <div>
          <p className="workbench-home-kicker">Pi Coding Agent Desktop Workbench</p>
          <h1>开始或恢复一个 Pi 运行时</h1>
          <p className="workbench-home-subtitle">选择项目、恢复最近会话，或查看运行时恢复线索。</p>
        </div>
        <div className="workbench-home-actions">
          <button type="button" className="primary" disabled={!primaryProject} onClick={() => primaryProject && onStartRuntimeForProject(primaryProject.id)}>
            {primaryProject ? `启动 ${primaryProject.name}` : "先添加项目"}
          </button>
          <button type="button" onClick={onAddProject}>添加项目</button>
        </div>
      </section>

      <section className="workbench-home-context" aria-label="当前上下文">
        <ContextItem label="执行主机" value={host} />
        <ContextItem label="连接" value={connectionLabel(connection)} tone={connection === "ready" ? "good" : connection === "degraded" ? "warn" : undefined} />
        <ContextItem label="当前项目" value={selectedProject?.cwd ?? "未选择项目"} />
      </section>

      <div className="workbench-home-grid">
        <Panel title="最近项目" action={<button type="button" onClick={onAddProject}>添加</button>}>
          {recentProjects.length ? recentProjects.map((project) => (
            <div className="workbench-home-row" key={project.id}>
              <button type="button" className="workbench-home-row-main" onClick={() => onSelectProject(project.id)}>
                <span>{project.name}</span>
                <small>{project.cwd}</small>
              </button>
              <button type="button" onClick={() => onStartRuntimeForProject(project.id)}>启动</button>
            </div>
          )) : <EmptyLine text="还没有项目" />}
        </Panel>

        <Panel title="最近会话">
          {recentSessions.length ? recentSessions.map((session) => (
            <div className="workbench-home-row" key={session.id}>
              <button type="button" className="workbench-home-row-main" onClick={() => onResumeSession(session.id)}>
                <span>{session.title || "未命名会话"}</span>
                <small>{sessionDetail(session, projects)}</small>
              </button>
              <button type="button" onClick={() => onOpenSessionHistory(session.projectId)}>历史</button>
            </div>
          )) : <EmptyLine text="还没有可恢复会话" />}
        </Panel>

        <Panel title="恢复与日志">
          {recoverableRuntimes.length ? recoverableRuntimes.map((runtime) => (
            <div className="workbench-home-row" key={runtime.id}>
              <div className="workbench-home-row-main static">
                <span>{runtimeProjectName(runtime, projects)}</span>
                <small>{runtime.status === "crashed" ? "运行时已崩溃" : "运行时已停止"}{busyByRuntime[runtime.id] ? " · 最近仍有活动" : ""}</small>
              </div>
              <button type="button" onClick={() => onOpenRuntimeLogs(runtime.id)}>日志</button>
            </div>
          )) : <EmptyLine text="没有最近的停止或崩溃运行时" />}
        </Panel>

        <Panel title="诊断">
          <div className="workbench-home-diagnostics">
            <span>环境、能力与界面设置</span>
            <button type="button" onClick={onOpenEnvironmentDiagnostics}>打开设置</button>
          </div>
        </Panel>
      </div>
    </div>
  );
}

function ContextItem({ label, value, tone }: { label: string; value: string; tone?: "good" | "warn" }) {
  return <div className={`workbench-home-context-item ${tone ? `tone-${tone}` : ""}`}><span>{label}</span><strong>{value}</strong></div>;
}

function Panel({ title, action, children }: { title: string; action?: React.ReactNode; children: React.ReactNode }) {
  return <section className="workbench-home-panel"><header><h2>{title}</h2>{action}</header><div className="workbench-home-list">{children}</div></section>;
}

function EmptyLine({ text }: { text: string }) {
  return <p className="workbench-home-empty">{text}</p>;
}

function connectionLabel(connection: ConnectionState): string {
  if (connection === "ready") return "已连接";
  if (connection === "degraded") return "重新同步中";
  if (connection === "replaying") return "回放事件中";
  if (connection === "bootstrapping" || connection === "connected_waiting_hello") return "初始化中";
  if (connection === "reconnecting") return "重连中";
  if (connection === "unauthorized") return "认证失败";
  return "未连接";
}

function sessionDetail(session: GuiSession, projects: Project[]): string {
  const project = projects.find((item) => item.id === session.projectId);
  return [project?.name, new Date(session.updatedAt).toLocaleString()].filter(Boolean).join(" · ");
}

function runtimeProjectName(runtime: Runtime, projects: Project[]): string {
  return projects.find((project) => project.id === runtime.projectId)?.name ?? runtime.cwd;
}
