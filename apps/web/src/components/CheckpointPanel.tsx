import { useMemo, useState } from "react";
import type { Project, RewindCheckpoint, Runtime } from "@pi-gui/shared";
import type { ConnectionState } from "../types";
import { Icon } from "./Icon";

const INITIAL_VISIBLE_COUNT = 32;

type CheckpointPanelProps = {
  open: boolean;
  project?: Project;
  runtime?: Runtime;
  checkpoints: RewindCheckpoint[];
  connection: ConnectionState;
  pendingActionId?: string;
  onClose: () => void;
  onRefresh: () => void;
  onRestore: (checkpointId: string, restoreFiles: boolean) => void;
  onFastForward: (restoreFiles: boolean) => void;
};

export function CheckpointPanel({
  open,
  project,
  runtime,
  checkpoints,
  connection,
  pendingActionId,
  onClose,
  onRefresh,
  onRestore,
  onFastForward,
}: CheckpointPanelProps) {
  const [query, setQuery] = useState("");
  const [selectedId, setSelectedId] = useState<string | undefined>();
  const [visibleCount, setVisibleCount] = useState(INITIAL_VISIBLE_COUNT);
  const visibleCheckpoints = useMemo(() => {
    const normalized = query.trim().toLowerCase();
    return checkpoints.filter((checkpoint) => {
      if (!normalized) return true;
      return [checkpoint.id, checkpoint.sessionEntryId, checkpoint.prompt, checkpoint.git.backend, checkpoint.git.statusPreview, checkpoint.git.error]
        .some((value) => value?.toLowerCase().includes(normalized));
    });
  }, [checkpoints, query]);
  const selectedCheckpoint = visibleCheckpoints.find((checkpoint) => checkpoint.id === selectedId) ?? visibleCheckpoints[0];
  const canUseRuntime = connection === "open" && runtime?.status === "running" && !runtime.archivedAt;

  if (!open || !project) return null;

  function restore(checkpoint: RewindCheckpoint, restoreFiles: boolean) {
    const action = restoreFiles ? "恢复会话和文件" : "仅恢复会话";
    const warning = restoreFiles ? "\n\n文件恢复会先由 Pi extension 保存当前工作区，再应用 checkpoint。" : "";
    if (!window.confirm(`${action}到此 checkpoint？\n\n${checkpoint.prompt.slice(0, 240)}${warning}`)) return;
    onRestore(checkpoint.id, restoreFiles);
  }

  function fastForward(restoreFiles: boolean) {
    const action = restoreFiles ? "快进并恢复文件" : "仅快进会话";
    if (!window.confirm(`${action}？`)) return;
    onFastForward(restoreFiles);
  }

  return (
    <div className="modal-backdrop" onMouseDown={onClose}>
      <section className="checkpoint-panel-modal" role="dialog" aria-modal="true" aria-label={`${project.name} 的检查点`} onMouseDown={(event) => event.stopPropagation()}>
        <header className="checkpoint-panel-header">
          <div>
            <h2>{project.name} 的检查点</h2>
            <p>{project.cwd}</p>
          </div>
          <div className="checkpoint-panel-header-actions">
            <button className="checkpoint-secondary-button" type="button" onClick={onRefresh} disabled={connection !== "open"}>刷新</button>
            <button className="icon-button" type="button" title="关闭" aria-label="关闭" onClick={onClose}>
              <Icon name="x" />
            </button>
          </div>
        </header>

        <label className="checkpoint-search">
          <span>搜索检查点</span>
          <input value={query} onChange={(event) => setQuery(event.target.value)} placeholder="按 prompt、id 或 git 状态搜索" autoFocus />
        </label>

        <div className="checkpoint-panel-body">
          <div className="checkpoint-list" role="listbox" aria-label="检查点列表">
            {visibleCheckpoints.length === 0 ? <p className="muted">暂无检查点。运行一次带 prompt 的 Pi 会话后会自动创建。</p> : null}
            {visibleCheckpoints.slice(0, visibleCount).map((checkpoint) => {
              const selected = checkpoint.id === selectedCheckpoint?.id;
              return (
                <button
                  className={`checkpoint-item ${selected ? "selected" : ""}`}
                  type="button"
                  key={checkpoint.id}
                  onClick={() => setSelectedId(checkpoint.id)}
                  title={checkpoint.prompt}
                >
                  <span className="checkpoint-item-main">
                    <strong>{preview(checkpoint.prompt, 72)}</strong>
                    <small>{formatDate(checkpoint.createdAt)} · {checkpoint.id.slice(0, 8)}</small>
                  </span>
                  <span className={`checkpoint-pill ${checkpoint.git.error ? "error" : checkpoint.git.dirty ? "dirty" : "clean"}`}>{gitLabel(checkpoint)}</span>
                </button>
              );
            })}
            {visibleCheckpoints.length > visibleCount ? (
              <button className="checkpoint-load-more" type="button" onClick={() => setVisibleCount((count) => count + INITIAL_VISIBLE_COUNT)}>加载更多</button>
            ) : null}
          </div>

          <aside className="checkpoint-detail" aria-label="检查点详情">
            {selectedCheckpoint ? (
              <>
                <div className="checkpoint-detail-section">
                  <span className="checkpoint-detail-label">Prompt</span>
                  <p>{selectedCheckpoint.prompt}</p>
                </div>
                <div className="checkpoint-detail-grid">
                  <span>ID</span><code>{selectedCheckpoint.id}</code>
                  <span>时间</span><strong>{formatDate(selectedCheckpoint.createdAt)}</strong>
                  <span>Git</span><strong>{gitLabel(selectedCheckpoint)}</strong>
                  <span>Session Entry</span><code>{selectedCheckpoint.sessionEntryId}</code>
                </div>
                {selectedCheckpoint.git.statusPreview ? (
                  <div className="checkpoint-detail-section">
                    <span className="checkpoint-detail-label">Git status</span>
                    <pre>{selectedCheckpoint.git.statusPreview}</pre>
                  </div>
                ) : null}
                {selectedCheckpoint.git.error ? <p className="checkpoint-error">{selectedCheckpoint.git.error}</p> : null}
                <div className="checkpoint-actions">
                  <button type="button" onClick={() => restore(selectedCheckpoint, true)} disabled={!canUseRuntime || Boolean(pendingActionId)}>恢复会话 + 文件</button>
                  <button type="button" onClick={() => restore(selectedCheckpoint, false)} disabled={!canUseRuntime || Boolean(pendingActionId)}>仅恢复会话</button>
                  <button type="button" onClick={() => void navigator.clipboard.writeText(selectedCheckpoint.id)}>复制 ID</button>
                </div>
                <div className="checkpoint-actions secondary">
                  <button type="button" onClick={() => fastForward(true)} disabled={!canUseRuntime || Boolean(pendingActionId)}>快进 + 文件</button>
                  <button type="button" onClick={() => fastForward(false)} disabled={!canUseRuntime || Boolean(pendingActionId)}>仅快进会话</button>
                </div>
                {!canUseRuntime ? <p className="checkpoint-hint">需要选择一个正在运行的 runtime 才能恢复或快进。</p> : null}
                {pendingActionId ? <p className="checkpoint-hint">正在执行 checkpoint 操作…</p> : null}
              </>
            ) : <p className="muted">选择一个 checkpoint 查看详情。</p>}
          </aside>
        </div>
      </section>
    </div>
  );
}

function gitLabel(checkpoint: RewindCheckpoint): string {
  if (checkpoint.git.error) return "git error";
  if (!checkpoint.git.available) return "conversation only";
  if (!checkpoint.git.dirty) return "clean";
  return `${checkpoint.git.backend ?? "snapshot"} · dirty`;
}

function preview(text: string, max: number): string {
  const normalized = text.replace(/\s+/g, " ").trim();
  return normalized.length > max ? `${normalized.slice(0, max - 1)}…` : normalized;
}

function formatDate(timestamp: number): string {
  try {
    return new Intl.DateTimeFormat("zh-CN", { month: "2-digit", day: "2-digit", hour: "2-digit", minute: "2-digit" }).format(new Date(timestamp));
  } catch {
    return "未知时间";
  }
}
