import type { GuiEvent, Runtime } from "@pi-gui/shared";
import { isRecoverableRuntimeInterruption } from "../domain/runtimeRecovery";
import { deriveRuntimeCrashSummary, formatRuntimeLogTimestamp, runtimeLogActionState, runtimeLogEventText, runtimeLogsCopyText, runtimeStatusLabel } from "../domain/runtimeLogs";
import { Icon, type IconName } from "./Icon";
import { IconButton } from "./ui";

type RuntimeLogDrawerProps = {
  runtime?: Runtime;
  events: GuiEvent[];
  loading?: boolean;
  hasMore?: boolean;
  busy?: boolean;
  onClose: () => void;
  onRefresh: () => void;
  onCopyLogs: (text: string) => void;
  onResume: (runtimeId: string) => void;
  onRestart: (runtimeId: string) => void;
  onStop: (runtimeId: string) => void;
  onArchive: (runtimeId: string) => void;
};

export function RuntimeLogDrawer({
  runtime,
  events,
  loading = false,
  hasMore = false,
  busy = false,
  onClose,
  onRefresh,
  onCopyLogs,
  onResume,
  onRestart,
  onStop,
  onArchive,
}: RuntimeLogDrawerProps) {
  if (!runtime) return null;
  const actionState = runtimeLogActionState(runtime, busy);
  const recoverableInterruption = isRecoverableRuntimeInterruption(runtime, events);
  const crashSummary = runtime.status === "crashed" && !recoverableInterruption ? deriveRuntimeCrashSummary(events) : undefined;
  const copyText = runtimeLogsCopyText(runtime, events);

  return (
    <aside className="runtime-log-drawer" aria-label="Runtime 日志与恢复">
      <header className="runtime-log-header">
        <div className="runtime-log-title">
          <Icon name="logs" />
          <div>
            <h2>日志</h2>
            <p>{runtime.id.slice(0, 12)}</p>
          </div>
        </div>
        <div className="runtime-log-toolbar" aria-label="日志操作">
          <RuntimeLogIconButton icon="refresh" title="刷新日志" onClick={onRefresh} disabled={loading} />
          <RuntimeLogIconButton icon="copy" title="复制日志" onClick={() => onCopyLogs(copyText)} disabled={events.length === 0} />
          <RuntimeLogIconButton icon="x" title="关闭" onClick={onClose} />
        </div>
      </header>

      <section className="runtime-log-metadata" aria-label="Runtime 元数据">
        <span className={`runtime-log-chip status-${recoverableInterruption ? "recoverable" : runtime.status}`}>{recoverableInterruption ? "可恢复" : runtimeStatusLabel(runtime.status)}</span>
        {runtime.pid ? <span className="runtime-log-chip">PID {runtime.pid}</span> : null}
        {runtime.sessionId ? <span className="runtime-log-chip">S {runtime.sessionId.slice(0, 8)}</span> : null}
        {runtime.model ? <span className="runtime-log-chip" title={runtime.model}>{runtime.model}</span> : null}
        {runtime.thinkingLevel ? <span className="runtime-log-chip">{runtime.thinkingLevel}</span> : null}
        {runtime.responseMode ? <span className="runtime-log-chip">{runtime.responseMode}</span> : null}
        <code className="runtime-log-cwd" title={runtime.cwd}>{runtime.cwd}</code>
      </section>

      {crashSummary?.reason ? (
        <section className="runtime-log-crash" aria-label="崩溃摘要">
          <span>Crash</span>
          <strong>{crashSummary.reason}</strong>
          {crashSummary.timestamp ? <time>{formatRuntimeLogTimestamp(crashSummary.timestamp)}</time> : null}
        </section>
      ) : null}

      <section className="runtime-log-recovery-bar" aria-label="恢复操作">
        <RuntimeLogIconButton icon="play" title={recoverableInterruption ? "恢复会话" : "恢复 Runtime"} onClick={() => onResume(runtime.id)} disabled={!actionState.canResume} />
        <RuntimeLogIconButton icon="refresh" title="重启 Runtime" onClick={() => onRestart(runtime.id)} disabled={!actionState.canRestart} />
        <RuntimeLogIconButton icon="stop" title="停止 Runtime" onClick={() => onStop(runtime.id)} disabled={!actionState.canStop} />
        <RuntimeLogIconButton icon="archive" title="归档 Runtime" onClick={() => onArchive(runtime.id)} disabled={!actionState.canArchive} />
        <span className="runtime-log-count">{loading ? "读取中…" : hasMore ? `${events.length}+` : `${events.length}`}</span>
      </section>

      <section className="runtime-log-events" aria-label="最近 Runtime 日志">
        {events.length === 0 && !loading ? <p className="runtime-log-empty">暂无 stderr / error / status 日志。</p> : null}
        <div className="runtime-log-event-list">
          {events.map((event) => (
            <article className={`runtime-log-event kind-${event.kind}`} key={event.id}>
              <header>
                <span>{event.kind}</span>
                <time>{formatRuntimeLogTimestamp(event.timestamp)}</time>
              </header>
              <pre>{runtimeLogEventText(event)}</pre>
            </article>
          ))}
        </div>
      </section>
    </aside>
  );
}

type RuntimeLogIconButtonProps = {
  icon: IconName;
  title: string;
  onClick: () => void;
  disabled?: boolean;
};

function RuntimeLogIconButton({ icon, title, onClick, disabled = false }: RuntimeLogIconButtonProps) {
  return <IconButton className="runtime-log-icon-button" icon={icon} label={title} onClick={onClick} disabled={disabled} />;
}
