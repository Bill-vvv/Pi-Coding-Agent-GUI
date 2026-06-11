import type {
  Project,
  RewindCheckpointOperation,
  RewindCheckpointPreview,
  RewindCheckpointRestoreResult,
  RewindCheckpointSummary,
  RewindGarbageCollectResult,
  RewindJumpHistoryEntry,
  RewindStorageHealth,
  Runtime,
} from "@pi-gui/shared";
import { isConnectionReady } from "../../domain/connection";
import type { ConnectionState } from "../../types";
import { checkpointConversationRestoreTarget } from "../../hooks/useCheckpointControls";

type CheckpointPanelProps = {
  connection: ConnectionState;
  project?: Project;
  activeRuntime?: Runtime;
  checkpoints: RewindCheckpointSummary[];
  checkpointOperations: RewindCheckpointOperation[];
  checkpointJumps: RewindJumpHistoryEntry[];
  checkpointHealth?: RewindStorageHealth;
  checkpointGcResult?: RewindGarbageCollectResult;
  checkpointPreview?: RewindCheckpointPreview;
  checkpointRestoreResult?: RewindCheckpointRestoreResult;
  checkpointPreviewSnapshotId?: string;
  checkpointPreviewLoading?: boolean;
  checkpointListLoading?: boolean;
  checkpointHealthLoading?: boolean;
  checkpointJumpsLoading?: boolean;
  pendingCheckpointCapture?: boolean;
  pendingCheckpointRestoreSnapshotId?: string;
  pendingCheckpointGcMode?: "dry-run" | "run";
  onRefreshCheckpoints: () => void;
  onRefreshCheckpointHealth: () => void;
  onRefreshCheckpointJumps: () => void;
  onCaptureCheckpoint: () => void;
  onOpenCheckpointPreview: (snapshotId: string) => void;
  onCloseCheckpointPreview: () => void;
  onRestoreCheckpoint: (snapshotId: string, target?: { runtimeId: string; entryId: string }) => void;
  onRunCheckpointGc: (dryRun: boolean) => void;
};

const PREVIEW_ACTION_ORDER: Array<keyof RewindCheckpointPreview["summary"]> = ["modify", "add", "delete", "overwrite", "recreate", "conflict", "skip", "unchanged"];

export function CheckpointPanel(props: CheckpointPanelProps) {
  const connectionReady = isConnectionReady(props.connection);
  const disabled = !connectionReady || !props.project;
  const previewCheckpoint = props.checkpoints.find((checkpoint) => checkpoint.id === props.checkpointPreviewSnapshotId);
  const previewRestoreTarget = previewCheckpoint ? checkpointConversationRestoreTarget(previewCheckpoint, props.activeRuntime) : undefined;
  const previewResult =
    previewCheckpoint && props.checkpointRestoreResult?.snapshotId === previewCheckpoint.id ? props.checkpointRestoreResult : undefined;
  const previewConflictCount = props.checkpointPreview?.summary.conflict ?? 0;
  const previewVisibleChanges = props.checkpointPreview?.changes.filter((change) => change.action !== "unchanged").slice(0, 24) ?? [];

  return (
    <section className="checkpoint-panel" aria-label="Workspace rewind">
      <header className="checkpoint-panel-header">
        <span className="checkpoint-panel-title">
          <span>Workspace Rewind</span>
          <small>
            {props.project
              ? `${props.checkpoints.length} checkpoints · ${props.project.name}`
              : "选择项目后可查看 checkpoints 与恢复预览"}
          </small>
        </span>
        <span className="checkpoint-actions-inline">
          <button type="button" disabled={disabled || props.pendingCheckpointCapture} onClick={props.onCaptureCheckpoint}>
            {props.pendingCheckpointCapture ? "创建中…" : "创建 checkpoint"}
          </button>
          <button type="button" disabled={disabled || props.checkpointListLoading} onClick={props.onRefreshCheckpoints}>
            {props.checkpointListLoading ? "刷新中…" : "刷新"}
          </button>
        </span>
      </header>

      <div className="checkpoint-metrics-grid">
        <MetricCard
          label="Checkpoints"
          value={String(props.checkpointHealth?.snapshotCount ?? props.checkpoints.length)}
          detail={props.project ? "可恢复工作区快照" : "等待项目"}
        />
        <MetricCard
          label="Storage"
          value={props.checkpointHealth ? formatBytes(props.checkpointHealth.objectBytes) : "—"}
          detail={props.checkpointHealth ? `${props.checkpointHealth.objectCount} objects` : "存储状态未加载"}
        />
        <MetricCard
          label="Reclaimable"
          value={props.checkpointHealth ? String(props.checkpointHealth.unreferencedObjectCount) : "—"}
          detail={props.checkpointHealth ? formatBytes(props.checkpointHealth.unreferencedObjectBytes) : "等待健康扫描"}
          tone={(props.checkpointHealth?.unreferencedObjectCount ?? 0) > 0 ? "warning" : undefined}
        />
      </div>

      <div className="checkpoint-storage-row">
        <span className="checkpoint-muted">
          {connectionReady ? "Prompt 前会自动 capture；恢复前请先看 preview。" : "连接未就绪时无法创建或恢复 checkpoint。"}
        </span>
        <span className="checkpoint-actions-inline">
          <button type="button" disabled={disabled || props.checkpointHealthLoading} onClick={props.onRefreshCheckpointHealth}>健康</button>
          <button type="button" disabled={disabled || props.checkpointJumpsLoading} onClick={props.onRefreshCheckpointJumps}>分支记录</button>
          <button type="button" disabled={disabled || Boolean(props.pendingCheckpointGcMode)} onClick={() => props.onRunCheckpointGc(true)}>预览清理</button>
          <button type="button" className="danger" disabled={disabled || Boolean(props.pendingCheckpointGcMode)} onClick={() => props.onRunCheckpointGc(false)}>执行清理</button>
        </span>
      </div>

      {props.checkpointGcResult ? (
        <small className="checkpoint-muted checkpoint-gc-note">
          最近 GC：{props.checkpointGcResult.dryRun ? "预览" : "已执行"} · 删除 {props.checkpointGcResult.deletedObjectCount} objects / {formatBytes(props.checkpointGcResult.deletedObjectBytes)}
        </small>
      ) : null}

      <div className="checkpoint-body-grid">
        <div className="checkpoint-timeline">
          <div className="checkpoint-section-header">
            <strong>时间线</strong>
            <small>{props.checkpointJumps.filter((jump) => jump.ok).length} successful jumps · {props.checkpointOperations.length} recent ops</small>
          </div>

          <div className="checkpoint-list" role="list">
            {props.checkpoints.slice(0, 10).map((checkpoint) => {
              const selected = props.checkpointPreviewSnapshotId === checkpoint.id;
              const pendingRestore = props.pendingCheckpointRestoreSnapshotId === checkpoint.id;
              return (
                <button
                  className={`checkpoint-row ${selected ? "selected" : ""}`}
                  type="button"
                  key={checkpoint.id}
                  onClick={() => props.onOpenCheckpointPreview(checkpoint.id)}
                  disabled={disabled}
                  aria-pressed={selected}
                  aria-current={selected ? "true" : undefined}
                >
                  <span className="checkpoint-row-rail" aria-hidden="true" />
                  <span className="checkpoint-row-main">
                    <span className="checkpoint-row-topline">
                      <strong>{formatDate(checkpoint.createdAt)}</strong>
                      <span className="checkpoint-chip-row">
                        <span className="checkpoint-chip">{captureSourceLabel(checkpoint.captureSource)}</span>
                        {selected ? <span className="checkpoint-chip selected">当前预览</span> : null}
                        {checkpoint.targetEntryId ? <span className="checkpoint-chip accent">可切换分支</span> : null}
                        {pendingRestore ? <span className="checkpoint-chip warning">恢复中…</span> : null}
                      </span>
                    </span>
                    <small>
                      {checkpoint.capturedFiles} files · {formatBytes(checkpoint.capturedBytes)}
                      {checkpoint.skipped ? ` · skipped ${checkpoint.skipped}` : ""}
                      {checkpoint.deletedEntries ? ` · deleted ${checkpoint.deletedEntries}` : ""}
                    </small>
                    <small className="checkpoint-row-meta">
                      {checkpoint.sessionId ? `session ${checkpoint.sessionId.slice(0, 8)}` : "file restore only"}
                      {checkpoint.runtimeId ? ` · runtime ${checkpoint.runtimeId.slice(0, 8)}` : ""}
                    </small>
                  </span>
                </button>
              );
            })}
            {props.checkpoints.length === 0 ? <small className="checkpoint-muted">暂无 checkpoint。</small> : null}
          </div>
        </div>

        <div className="checkpoint-preview-box">
          <div className="checkpoint-section-header">
            <span className="checkpoint-preview-title">
              <strong>{previewCheckpoint ? "恢复预览" : "选择 checkpoint"}</strong>
              {previewCheckpoint ? <small>{formatDate(previewCheckpoint.createdAt)}</small> : null}
            </span>
            {previewCheckpoint ? <button type="button" onClick={props.onCloseCheckpointPreview}>关闭</button> : null}
          </div>

          {!previewCheckpoint ? <small className="checkpoint-muted">点击左侧时间线查看 preview，并决定是仅恢复文件还是同时切换 conversation branch。</small> : null}
          {previewCheckpoint && props.checkpointPreviewLoading ? <small className="checkpoint-muted">正在加载 preview…</small> : null}

          {previewCheckpoint && props.checkpointPreview ? (
            <>
              <PreviewSummary preview={props.checkpointPreview} />
              <PreviewWarnings checkpoint={previewCheckpoint} conflictCount={previewConflictCount} restoreTarget={previewRestoreTarget} />
              <div className="checkpoint-change-list">
                {previewVisibleChanges.map((change) => (
                  <div className={`checkpoint-change action-${change.action}`} key={`${change.action}:${change.relativePath}`}>
                    <span>{previewActionLabel(change.action)}</span>
                    <code>{change.relativePath}</code>
                    {change.reason ? <small>{change.reason}</small> : null}
                  </div>
                ))}
                {props.checkpointPreview.changes.filter((change) => change.action !== "unchanged").length > previewVisibleChanges.length ? (
                  <small className="checkpoint-muted">其余变化已折叠；当前只显示前 {previewVisibleChanges.length} 条。</small>
                ) : null}
              </div>
              <div className="checkpoint-restore-row">
                <button
                  type="button"
                  className="danger"
                  disabled={disabled || props.pendingCheckpointRestoreSnapshotId === previewCheckpoint.id || previewConflictCount > 0}
                  onClick={() => props.onRestoreCheckpoint(previewCheckpoint.id, previewRestoreTarget)}
                >
                  {props.pendingCheckpointRestoreSnapshotId === previewCheckpoint.id
                    ? "恢复中…"
                    : previewRestoreTarget
                      ? "恢复文件并切换分支"
                      : "仅恢复文件"}
                </button>
                {previewResult ? (
                  <small className={previewResult.ok ? "checkpoint-success" : "checkpoint-error"}>
                    {previewResult.ok ? "恢复成功" : `恢复失败：${previewResult.error ?? "unknown"}`}
                  </small>
                ) : null}
              </div>
            </>
          ) : null}
        </div>
      </div>
    </section>
  );
}

function MetricCard({ label, value, detail, tone }: { label: string; value: string; detail: string; tone?: "warning" }) {
  return (
    <div className={`checkpoint-metric-card ${tone ?? ""}`.trim()}>
      <span>{label}</span>
      <strong>{value}</strong>
      <small>{detail}</small>
    </div>
  );
}

function PreviewSummary({ preview }: { preview: RewindCheckpointPreview }) {
  return (
    <div className="checkpoint-summary">
      {PREVIEW_ACTION_ORDER.map((action) => {
        const count = preview.summary[action] ?? 0;
        if (count <= 0) return null;
        return <span key={action}>{previewActionLabel(action)} {count}</span>;
      })}
    </div>
  );
}

function PreviewWarnings({
  checkpoint,
  conflictCount,
  restoreTarget,
}: {
  checkpoint: RewindCheckpointSummary;
  conflictCount: number;
  restoreTarget?: { runtimeId: string; entryId: string };
}) {
  const warnings: string[] = [];
  if (checkpoint.skipped > 0) warnings.push(`该 checkpoint 捕获时跳过了 ${checkpoint.skipped} 个路径，恢复覆盖范围不是完整工作区。`);
  if (conflictCount > 0) warnings.push(`当前工作区存在 ${conflictCount} 个冲突项，建议先手动处理后再恢复。`);
  if (checkpoint.targetEntryId && !restoreTarget) warnings.push("当前活动 runtime 与此 checkpoint 的 conversation branch 不匹配，因此这次只能恢复文件。");
  if (warnings.length === 0) return null;
  return (
    <div className="checkpoint-warning-list">
      {warnings.map((warning) => <small className="checkpoint-warning" key={warning}>{warning}</small>)}
    </div>
  );
}

function captureSourceLabel(source: RewindCheckpointSummary["captureSource"]) {
  if (source === "prompt") return "自动";
  if (source === "manual") return "手动";
  if (source === "rollback") return "回滚";
  return "快照";
}

function previewActionLabel(action: keyof RewindCheckpointPreview["summary"]) {
  if (action === "modify") return "修改";
  if (action === "add") return "新增";
  if (action === "delete") return "删除";
  if (action === "overwrite") return "覆盖";
  if (action === "recreate") return "重建";
  if (action === "conflict") return "冲突";
  if (action === "skip") return "跳过";
  return "无变化";
}

function formatDate(value: number): string {
  try {
    return new Intl.DateTimeFormat("zh-CN", {
      month: "2-digit",
      day: "2-digit",
      hour: "2-digit",
      minute: "2-digit",
      second: "2-digit",
    }).format(new Date(value));
  } catch {
    return new Date(value).toLocaleString();
  }
}

function formatBytes(bytes: number): string {
  if (bytes < 1024) return `${bytes} B`;
  if (bytes < 1024 * 1024) return `${(bytes / 1024).toFixed(1)} KB`;
  return `${(bytes / 1024 / 1024).toFixed(1)} MB`;
}
