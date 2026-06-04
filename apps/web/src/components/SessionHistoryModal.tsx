import { useMemo, useState } from "react";
import type { GuiSession, Project, Runtime } from "@pi-gui/shared";
import type { ConnectionState } from "../types";
import { Icon } from "./Icon";

const INITIAL_VISIBLE_COUNT = 24;
const LOAD_MORE_COUNT = 24;

type SessionHistoryModalProps = {
  open: boolean;
  project?: Project;
  sessions: GuiSession[];
  runtimes: Runtime[];
  connection: ConnectionState;
  pendingRestoreId?: string;
  onClose: () => void;
  onResumeSession: (sessionId: string) => void;
  onSelectRuntime: (projectId: string, runtimeId: string) => void;
};

export function SessionHistoryModal({ open, project, sessions, runtimes, connection, pendingRestoreId, onClose, onResumeSession, onSelectRuntime }: SessionHistoryModalProps) {
  const [query, setQuery] = useState("");
  const [visibleCount, setVisibleCount] = useState(INITIAL_VISIBLE_COUNT);
  const runtimeById = useMemo(() => new Map(runtimes.map((runtime) => [runtime.id, runtime])), [runtimes]);
  const visibleSessions = useMemo(() => {
    if (!project) return [];
    const normalizedQuery = query.trim().toLowerCase();
    return sessions
      .filter((session) => session.projectId === project.id)
      .filter((session) => !normalizedQuery || [session.title, session.id, session.piSessionFile].some((value) => value?.toLowerCase().includes(normalizedQuery)))
      .sort((left, right) => right.updatedAt - left.updatedAt);
  }, [project, query, sessions]);

  if (!open || !project) return null;

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
    <div className="modal-backdrop" onMouseDown={onClose}>
      <section className="session-history-modal" role="dialog" aria-modal="true" aria-label={`${project.name} 的历史对话`} onMouseDown={(event) => event.stopPropagation()}>
        <header className="session-history-header">
          <div>
            <h2>{project.name} 的历史对话</h2>
            <p>{project.cwd}</p>
          </div>
          <button className="icon-button" type="button" title="关闭" aria-label="关闭" onClick={onClose}>
            <Icon name="x" />
          </button>
        </header>

        <label className="session-history-search">
          <span>搜索历史对话</span>
          <input value={query} onChange={(event) => setQuery(event.target.value)} placeholder="按标题、session id 或文件路径搜索" autoFocus />
        </label>

        <div className="session-history-list">
          {visibleSessions.length === 0 ? <p className="muted">暂无可恢复的历史对话。</p> : null}
          {visibleSessions.slice(0, visibleCount).map((session) => {
            const runtime = session.runtimeId ? runtimeById.get(session.runtimeId) : undefined;
            const pending = pendingRestoreId === session.id;
            const actionLabel = runtime && !runtime.archivedAt ? "打开" : pending ? "正在恢复…" : "恢复";
            return (
              <button className="session-history-item" type="button" key={session.id} onClick={() => activateSession(session)} disabled={connection !== "open" || pending} title={session.piSessionFile}>
                <span className="session-history-text">
                  <strong>{session.title || `历史对话 ${session.id.slice(0, 8)}`}</strong>
                  <small>{formatSessionDate(session.updatedAt)} · {session.id.slice(0, 12)}</small>
                </span>
                <span className="session-history-status">{actionLabel}</span>
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
    </div>
  );
}

function formatSessionDate(timestamp: number): string {
  try {
    return new Intl.DateTimeFormat("zh-CN", { month: "2-digit", day: "2-digit", hour: "2-digit", minute: "2-digit" }).format(new Date(timestamp));
  } catch {
    return "未知时间";
  }
}
