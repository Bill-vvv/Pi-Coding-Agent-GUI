import { useMemo, useState } from "react";
import type { ExecutionHostRef, GuiSession, Project, Runtime } from "@pi-gui/shared";
import { executionHostLabel } from "../domain/executionHost";
import type { ConnectionState } from "../types";
import { IconButton } from "./ui";

const INITIAL_VISIBLE_COUNT = 24;
const LOAD_MORE_COUNT = 24;

type SessionHistoryPanelProps = {
  project: Project;
  sessions: GuiSession[];
  runtimes: Runtime[];
  connection: ConnectionState;
  currentHost?: ExecutionHostRef;
  pendingRestoreId?: string;
  onClose: () => void;
  onResumeSession: (sessionId: string) => void;
  onSelectRuntime: (projectId: string, runtimeId: string) => void;
};

export function SessionHistoryPanel({ project, sessions, runtimes, connection, currentHost, pendingRestoreId, onClose, onResumeSession, onSelectRuntime }: SessionHistoryPanelProps) {
  const [query, setQuery] = useState("");
  const [visibleCount, setVisibleCount] = useState(INITIAL_VISIBLE_COUNT);
  const runtimeById = useMemo(() => new Map(runtimes.map((runtime) => [runtime.id, runtime])), [runtimes]);
  const visibleSessions = useMemo(() => {
    const normalizedQuery = query.trim().toLowerCase();
    return sessions
      .filter((session) => session.projectId === project.id)
      .filter((session) => !normalizedQuery || [session.title, session.id, session.piSessionFile].some((value) => value?.toLowerCase().includes(normalizedQuery)))
      .sort((left, right) => right.updatedAt - left.updatedAt);
  }, [project.id, query, sessions]);

  function activateSession(session: GuiSession) {
    const runtime = session.runtimeId ? runtimeById.get(session.runtimeId) : undefined;
    if (runtime && !runtime.archivedAt) {
      onSelectRuntime(runtime.projectId, runtime.id);
      onClose();
      return;
    }
    onResumeSession(session.id);
  }

  return (
    <section className="session-history-panel" aria-label={`${project.name} 的归档对话`}>
      <header className="session-history-header">
        <div>
          <h2>{project.name} 的归档对话</h2>
          <p>{project.cwd}</p>
        </div>
        <IconButton icon="x" label="返回当前对话" onClick={onClose} />
      </header>

      <label className="session-history-search">
        <span>搜索归档对话</span>
        <input value={query} onChange={(event) => setQuery(event.target.value)} placeholder="按标题、session id 或文件路径搜索" autoFocus />
      </label>

      <div className="session-history-list">
        {visibleSessions.length === 0 ? <p className="muted">暂无可恢复的归档对话。</p> : null}
        {visibleSessions.slice(0, visibleCount).map((session) => {
          const runtime = session.runtimeId ? runtimeById.get(session.runtimeId) : undefined;
          const pending = pendingRestoreId === session.id;
          const actionLabel = runtime && !runtime.archivedAt ? "打开" : pending ? "正在恢复…" : "恢复";
          const host = session.host ?? runtime?.host;
          const hostLabel = executionHostLabel(host);
          const hostMismatch = Boolean(host && currentHost && !sameExecutionHost(host, currentHost));
          const disabled = connection !== "open" || pending || hostMismatch;
          return (
            <button
              className="session-history-item"
              type="button"
              key={session.id}
              onClick={() => activateSession(session)}
              disabled={disabled}
              title={hostMismatch ? `此会话属于 ${hostLabel}，请切换 Host 后恢复。` : session.piSessionFile}
            >
              <span className="session-history-text">
                <strong>{session.title || `归档对话 ${session.id.slice(0, 8)}`}</strong>
                <small>{formatSessionDate(session.updatedAt)} · {session.id.slice(0, 12)}{hostLabel ? ` · ${hostLabel}` : ""}</small>
              </span>
              <span className="session-history-status">{hostMismatch ? "需切换 Host" : actionLabel}</span>
            </button>
          );
        })}
      </div>

      {visibleSessions.length > visibleCount ? (
        <button className="session-history-load-more" type="button" onClick={() => setVisibleCount((count) => count + LOAD_MORE_COUNT)}>
          加载更多
        </button>
      ) : null}
    </section>
  );
}

function sameExecutionHost(left: ExecutionHostRef, right: ExecutionHostRef): boolean {
  return left.kind === right.kind && left.id === right.id;
}

function formatSessionDate(timestamp: number): string {
  try {
    return new Intl.DateTimeFormat("zh-CN", { month: "2-digit", day: "2-digit", hour: "2-digit", minute: "2-digit" }).format(new Date(timestamp));
  } catch {
    return "未知时间";
  }
}
