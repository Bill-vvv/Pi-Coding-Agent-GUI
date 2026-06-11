import type { GuiEvent, Runtime } from "@pi-gui/shared";
import { isRecoverableRuntimeInterruption } from "../domain/runtimeRecovery";
import { deriveRuntimeCrashSummary, formatRuntimeLogTimestamp, runtimeLogActionState, runtimeLogEventText, runtimeStatusLabel } from "../domain/runtimeLogs";
import type { ConnectionState } from "../types";

type RuntimeRecoveryPanelProps = {
  runtime: Runtime;
  connection: ConnectionState;
  events: GuiEvent[];
  busy?: boolean;
  onResume: (runtimeId: string) => void;
  onRestart: (runtimeId: string) => void;
  onStop: (runtimeId: string) => void;
  onArchive: (runtimeId: string) => void;
  onOpenLogs: (runtimeId: string) => void;
  onStartNewConversation?: () => void;
};

export function RuntimeRecoveryPanel({
  runtime,
  connection,
  events,
  busy = false,
  onResume,
  onRestart,
  onStop,
  onArchive,
  onOpenLogs,
  onStartNewConversation,
}: RuntimeRecoveryPanelProps) {
  const actionState = runtimeLogActionState(runtime, busy);
  const recoverableInterruption = isRecoverableRuntimeInterruption(runtime, events);
  const crashSummary = runtime.status === "crashed" && !recoverableInterruption ? deriveRuntimeCrashSummary(events) : undefined;
  const recentDiagnostics = events.filter((event) => event.kind === "error" || event.kind === "stderr" || event.kind === "runtime_status").slice(-3).reverse();
  const statusTone = recoverableInterruption ? "recoverable" : runtime.status;

  return (
    <div className="runtime-recovery-surface" aria-label="Runtime 恢复">
      <section className="runtime-recovery-card">
        <header className="runtime-recovery-header">
          <div>
            <p className="runtime-recovery-kicker">Runtime recovery</p>
            <h1>{recoverableInterruption ? "会话可恢复" : runtime.status === "crashed" ? "Runtime 已崩溃" : "Runtime 已停止"}</h1>
            <p className="runtime-recovery-subtitle">{runtimeSummary(runtime, connection, recoverableInterruption)}</p>
          </div>
          <span className={`runtime-recovery-status status-${statusTone}`}>{recoverableInterruption ? "可恢复" : runtimeStatusLabel(runtime.status)}</span>
        </header>

        <section className="runtime-recovery-metadata" aria-label="Runtime 元数据">
          <Metadata label="Runtime" value={runtime.id.slice(0, 12)} />
          <Metadata label="Session" value={runtime.sessionId ? runtime.sessionId.slice(0, 12) : "无"} />
          <Metadata label="Model" value={runtime.model ?? "默认"} />
          <Metadata label="CWD" value={runtime.cwd} wide />
        </section>

        {connection !== "ready" ? <p className="runtime-recovery-connection">连接状态：{connectionLabel(connection)}。这是 WebSocket / replay 状态，不一定表示 Pi runtime 崩溃。</p> : null}

        {crashSummary?.reason ? (
          <section className="runtime-recovery-crash" aria-label="崩溃摘要">
            <span>Likely cause</span>
            <strong>{crashSummary.reason}</strong>
            {crashSummary.timestamp ? <time>{formatRuntimeLogTimestamp(crashSummary.timestamp)}</time> : null}
          </section>
        ) : null}

        <section className="runtime-recovery-actions" aria-label="恢复操作">
          <button type="button" className="primary" onClick={() => onResume(runtime.id)} disabled={!actionState.canResume}>恢复</button>
          <button type="button" onClick={() => onRestart(runtime.id)} disabled={!actionState.canRestart}>重启</button>
          <button type="button" onClick={() => onOpenLogs(runtime.id)}>查看日志</button>
          <button type="button" onClick={() => onStop(runtime.id)} disabled={!actionState.canStop}>停止</button>
          <button type="button" onClick={() => onArchive(runtime.id)} disabled={!actionState.canArchive}>归档</button>
          {onStartNewConversation ? <button type="button" onClick={onStartNewConversation}>新对话</button> : null}
        </section>

        <section className="runtime-recovery-diagnostics" aria-label="最近诊断">
          <header>
            <h2>最近诊断</h2>
            <span>{events.length} 条事件</span>
          </header>
          {recentDiagnostics.length ? (
            <div className="runtime-recovery-event-list">
              {recentDiagnostics.map((event) => (
                <article className={`runtime-recovery-event kind-${event.kind}`} key={event.id}>
                  <header><span>{event.kind}</span><time>{formatRuntimeLogTimestamp(event.timestamp)}</time></header>
                  <pre>{runtimeLogEventText(event)}</pre>
                </article>
              ))}
            </div>
          ) : <p className="runtime-recovery-empty">暂无可显示的错误或 stderr 诊断。打开日志可刷新详细记录。</p>}
        </section>
      </section>
    </div>
  );
}

function Metadata({ label, value, wide = false }: { label: string; value: string; wide?: boolean }) {
  return <div className={`runtime-recovery-meta ${wide ? "wide" : ""}`}><span>{label}</span><strong title={value}>{value}</strong></div>;
}

function runtimeSummary(runtime: Runtime, connection: ConnectionState, recoverableInterruption: boolean): string {
  if (connection !== "ready") return "前端连接正在恢复；运行时状态来自最近一次服务器快照。";
  if (recoverableInterruption) return "检测到启动期 orphaned runtime，可尝试恢复已有 Pi session。";
  if (runtime.status === "crashed") return "Pi RPC 进程异常退出或启动失败。可以查看日志、恢复或归档。";
  return runtime.sessionId ? "该 runtime 已停止，但有关联 session，可继续恢复。" : "该 runtime 已停止；可重启或开始新的对话。";
}

function connectionLabel(connection: ConnectionState): string {
  if (connection === "degraded") return "已连接，正在重新同步";
  if (connection === "replaying") return "正在回放事件";
  if (connection === "bootstrapping" || connection === "connected_waiting_hello") return "正在初始化";
  if (connection === "reconnecting") return "正在重连";
  if (connection === "unauthorized") return "认证失败";
  if (connection === "connecting") return "连接中";
  if (connection === "closed") return "已断开";
  return "已连接";
}
