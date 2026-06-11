import { useEffect, useMemo, useState } from "react";
import type { RewindCheckpointPreview, RewindCheckpointRestoreResult, RewindCheckpointSummary, RewindGarbageCollectResult, RewindJumpHistoryEntry, RewindStorageHealth, Runtime } from "@pi-gui/shared";
import type { GuiSocketSend } from "../types";

type RewindPanelProps = {
  projectId: string;
  runtime?: Runtime;
  checkpoints: RewindCheckpointSummary[];
  jumps: RewindJumpHistoryEntry[];
  previewBySnapshot: Record<string, RewindCheckpointPreview>;
  restoreResultsBySnapshot: Record<string, RewindCheckpointRestoreResult>;
  health?: RewindStorageHealth;
  gcResult?: RewindGarbageCollectResult;
  send: GuiSocketSend;
  onClose: () => void;
};

export function RewindPanel({ projectId, runtime, checkpoints, jumps, previewBySnapshot, restoreResultsBySnapshot, health, gcResult, send, onClose }: RewindPanelProps) {
  const [selectedSnapshotId, setSelectedSnapshotId] = useState<string | undefined>(checkpoints[0]?.id);
  const selectedCheckpoint = checkpoints.find((checkpoint) => checkpoint.id === selectedSnapshotId) ?? checkpoints[0];
  const preview = selectedCheckpoint ? previewBySnapshot[selectedCheckpoint.id] : undefined;
  const restoreResult = selectedCheckpoint ? restoreResultsBySnapshot[selectedCheckpoint.id] : undefined;
  const selectedCanFork = Boolean(runtime && selectedCheckpoint?.targetEntryId);

  useEffect(() => {
    send({ type: "checkpoint.list", projectId }, { notifyOnDisconnected: false });
    send({ type: "checkpoint.jumps", projectId, limit: 50 }, { notifyOnDisconnected: false });
    send({ type: "checkpoint.health", projectId }, { notifyOnDisconnected: false });
  }, [projectId, send]);

  useEffect(() => {
    if (!selectedSnapshotId) return;
    send({ type: "checkpoint.preview", projectId, snapshotId: selectedSnapshotId }, { notifyOnDisconnected: false });
  }, [projectId, selectedSnapshotId, send]);

  const visibleChanges = useMemo(() => preview?.changes.filter((change) => change.action !== "unchanged").slice(0, 80) ?? [], [preview]);

  function restoreSelected() {
    if (!selectedCheckpoint) return;
    const command = selectedCanFork
      ? { type: "checkpoint.restore" as const, projectId, snapshotId: selectedCheckpoint.id, runtimeId: runtime!.id, entryId: selectedCheckpoint.targetEntryId }
      : { type: "checkpoint.restore" as const, projectId, snapshotId: selectedCheckpoint.id };
    send(command);
  }

  return (
    <section className="rewind-panel">
      <header className="rewind-panel-header">
        <div>
          <strong>Rewind</strong>
          <small>恢复 workspace，并在可用时回到绑定的 prompt 分支</small>
        </div>
        <button type="button" onClick={onClose}>关闭</button>
      </header>

      <div className="rewind-toolbar">
        <button type="button" onClick={() => send({ type: "checkpoint.capture", projectId })}>创建 checkpoint</button>
        <button type="button" onClick={() => send({ type: "checkpoint.list", projectId })}>刷新</button>
        <button type="button" onClick={() => send({ type: "checkpoint.health", projectId })}>存储状态</button>
        <button type="button" onClick={() => send({ type: "checkpoint.gc", projectId, dryRun: false })}>清理未引用对象</button>
      </div>

      <div className="rewind-grid">
        <div className="rewind-list stealth-scroll">
          {checkpoints.length === 0 ? <div className="rewind-empty">暂无 checkpoint</div> : null}
          {checkpoints.map((checkpoint) => (
            <button className={`rewind-row ${checkpoint.id === selectedCheckpoint?.id ? "selected" : ""}`} type="button" key={checkpoint.id} onClick={() => setSelectedSnapshotId(checkpoint.id)}>
              <span>{formatDate(checkpoint.createdAt)}</span>
              <small>{checkpoint.captureSource ?? "snapshot"}{checkpoint.targetEntryId ? " · prompt-bound" : ""}</small>
              <small>{checkpoint.capturedFiles} files · skipped {checkpoint.skipped}</small>
            </button>
          ))}
        </div>

        <div className="rewind-detail stealth-scroll">
          {selectedCheckpoint ? (
            <>
              <div className="rewind-card">
                <strong>{selectedCheckpoint.id}</strong>
                <small>{selectedCheckpoint.root}</small>
                <div className="rewind-chips">
                  <span>{selectedCheckpoint.capturedFiles} files</span>
                  <span>{formatBytes(selectedCheckpoint.newBytes)} new</span>
                  {selectedCheckpoint.skipped ? <span>{selectedCheckpoint.skipped} skipped</span> : null}
                  {selectedCheckpoint.targetEntryId ? <span>entry {selectedCheckpoint.targetEntryId.slice(0, 8)}</span> : null}
                </div>
              </div>

              <div className="rewind-card">
                <div className="rewind-card-title">
                  <strong>Preview</strong>
                  {preview ? <small>{preview.changes.length} paths</small> : <small>loading…</small>}
                </div>
                {preview ? <PreviewSummary preview={preview} /> : null}
                {visibleChanges.map((change) => (
                  <div className={`rewind-change action-${change.action}`} key={`${change.action}:${change.relativePath}`}>
                    <span>{change.action}</span>
                    <code>{change.relativePath}</code>
                    {change.reason ? <small>{change.reason}</small> : null}
                  </div>
                ))}
              </div>

              <div className="rewind-actions">
                <button type="button" className="danger" onClick={restoreSelected} disabled={preview?.summary.conflict ? preview.summary.conflict > 0 : false}>
                  {selectedCanFork ? "恢复并 fork 对话" : "仅恢复文件"}
                </button>
                {restoreResult ? <small className={restoreResult.ok ? "ok" : "bad"}>{restoreResult.ok ? "恢复成功" : `恢复失败：${restoreResult.error ?? "unknown"}`}</small> : null}
              </div>
            </>
          ) : null}
        </div>
      </div>

      <footer className="rewind-footer">
        {health ? <span>{health.snapshotCount} snapshots · {formatBytes(health.objectBytes)} objects · {health.unreferencedObjectCount} unreferenced</span> : <span>storage health loading…</span>}
        {gcResult ? <span>last GC: {gcResult.deletedObjectCount} objects / {formatBytes(gcResult.deletedObjectBytes)}</span> : null}
        {jumps.length ? <span>{jumps.filter((jump) => jump.ok).length} successful jumps</span> : null}
      </footer>
    </section>
  );
}

function PreviewSummary({ preview }: { preview: RewindCheckpointPreview }) {
  return (
    <div className="rewind-chips">
      {Object.entries(preview.summary).filter(([, count]) => count > 0).map(([action, count]) => <span key={action}>{action} {count}</span>)}
    </div>
  );
}

function formatDate(value: number): string {
  return new Date(value).toLocaleString();
}

function formatBytes(bytes: number): string {
  if (bytes < 1024) return `${bytes} B`;
  if (bytes < 1024 * 1024) return `${(bytes / 1024).toFixed(1)} KB`;
  return `${(bytes / 1024 / 1024).toFixed(1)} MB`;
}
