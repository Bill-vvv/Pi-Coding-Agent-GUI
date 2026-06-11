import type { PendingCommandSummary } from "../../domain/pendingCommands";
import type { ReplayRecoveryState } from "../../state/appReducer";
import type { ConnectionState, WebSocketDiagnostics } from "../../types";
import { webSocketCloseClue } from "../../domain/webSocketDiagnostics";

export function WebSocketDiagnosticsPanel({
  connection,
  diagnostics,
  replayRecovery,
  pendingCommandSummary,
}: {
  connection: ConnectionState;
  diagnostics: WebSocketDiagnostics;
  replayRecovery?: ReplayRecoveryState;
  pendingCommandSummary?: PendingCommandSummary;
}) {
  const status = diagnosticStatus(connection, replayRecovery);
  const gap = replayRecovery?.gap ?? diagnostics.lastReplayGap;
  const closeClue = webSocketCloseClue(diagnostics.lastClose);
  const rows = [
    ["状态", connectionLabel(connection)],
    ["Endpoint", diagnostics.endpoint || "未检测"],
    ["Auth", diagnostics.authPresent ? "present" : "absent"],
    ["Connection", diagnostics.lastConnectionId ?? "未收到"],
    ["Server", formatDiagnosticTime(diagnostics.lastServerTime)],
    ["Hello", formatDiagnosticTime(diagnostics.lastHelloAt)],
    ["Ready", formatDiagnosticTime(diagnostics.lastReadyAt)],
    ["Cursor", String(diagnostics.lastGuiEventId)],
    ["Reconnect", String(diagnostics.reconnectAttempt)],
    ...lastCloseRows(diagnostics),
    ["Pending", pendingCommandSummaryLabel(pendingCommandSummary)],
    ["Latest cmd", pendingCommandLatestLabel(pendingCommandSummary)],
  ];

  return (
    <details className="settings-diagnostics-dropdown">
      <summary>
        <span className="settings-diagnostics-summary-main">
          <span>WebSocket 诊断</span>
          <small>{diagnosticSummary(connection, replayRecovery, diagnostics)}</small>
        </span>
        <span className={`settings-diagnostics-pill ${status}`}>{diagnosticStatusShortLabel(status)}</span>
      </summary>

      <div className="settings-diagnostics-body">
        <div className="settings-diagnostics-grid">
          {rows.map(([label, value]) => (
            <div className="settings-diagnostics-row" key={label}>
              <span>{label}</span>
              <strong title={value}>{value}</strong>
            </div>
          ))}
          <div className="settings-diagnostics-row">
            <span>Replay</span>
            <strong title={gap ? replayGapTitle(gap) : "No replay gap recorded"}>{gap ? replayGapLabel(gap, replayRecovery) : "no gap recorded"}</strong>
          </div>
        </div>

        {closeClue ? (
          <div className="settings-diagnostics-issues">
            <div className={`settings-diagnostics-issue ${closeClue.severity}`}>
              <strong>{closeClue.label}</strong>
              <small>{closeClue.detail}</small>
            </div>
          </div>
        ) : null}

        <p className="muted">此面板只显示脱敏连接状态；不会展示 token 或 provider 凭据。</p>
      </div>
    </details>
  );
}

function diagnosticStatus(connection: ConnectionState, replayRecovery?: ReplayRecoveryState): "ready" | "warning" | "error" {
  if (connection === "unauthorized" || connection === "closed") return "error";
  if (connection === "ready" && !replayRecovery) return "ready";
  return "warning";
}

function diagnosticStatusShortLabel(status: "ready" | "warning" | "error"): string {
  if (status === "ready") return "Ready";
  if (status === "error") return "Error";
  return "Warn";
}

function diagnosticSummary(connection: ConnectionState, replayRecovery: ReplayRecoveryState | undefined, diagnostics: WebSocketDiagnostics): string {
  if (connection === "unauthorized") return "认证失败，已停止自动重连";
  if (replayRecovery) return replayRecovery.status === "resyncing" ? "回放缺口，正在重新同步快照" : "回放缺口，状态部分可信";
  if (connection === "ready") return `ready · cursor ${diagnostics.lastGuiEventId}`;
  if (connection === "replaying") return "正在回放离线事件";
  if (connection === "bootstrapping" || connection === "connected_waiting_hello") return "已连接，等待 bootstrap/hello";
  if (connection === "reconnecting") return "正在重连";
  if (connection === "closed") return "连接已关闭";
  return "正在连接";
}

function connectionLabel(connection: ConnectionState): string {
  return connection.replaceAll("_", " ");
}

function formatDiagnosticTime(value?: number): string {
  if (!value) return "未收到";
  const date = new Date(value);
  return Number.isNaN(date.getTime()) ? String(value) : date.toLocaleString();
}

function lastCloseRows(diagnostics: WebSocketDiagnostics): string[][] {
  const close = diagnostics.lastClose;
  if (!close) return [["Close", "no close recorded"]];
  return [
    ["Close code", String(close.code)],
    ["Close reason", close.reason || "no reason"],
    ["Close clean", close.wasClean ? "true" : "false"],
    ["Close at", formatDiagnosticTime(close.at)],
    ["Close retry", String(close.reconnectAttempt)],
  ];
}

function pendingCommandSummaryLabel(summary?: PendingCommandSummary): string {
  if (!summary) return "registry not enabled";
  return `${summary.sent} pending · ${summary.timeout} timeout · ${summary.unknownAfterDisconnect} unknown · ${summary.failed} failed`;
}

function pendingCommandLatestLabel(summary?: PendingCommandSummary): string {
  const latest = summary?.latest;
  if (!latest) return "none";
  return `${latest.command} · ${latest.status}`;
}

function replayGapLabel(gap: NonNullable<WebSocketDiagnostics["lastReplayGap"]>, replayRecovery?: ReplayRecoveryState): string {
  const status = replayRecovery ? `${replayRecovery.status} · ` : "";
  return `${status}${gap.reason} · ${gap.requestedSinceEventId} → ${gap.lastEventId}`;
}

function replayGapTitle(gap: NonNullable<WebSocketDiagnostics["lastReplayGap"]>): string {
  return `reason=${gap.reason}; requestedSinceEventId=${gap.requestedSinceEventId}; firstAvailableEventId=${gap.firstAvailableEventId ?? "n/a"}; lastEventId=${gap.lastEventId}; replayedEvents=${gap.replayedEvents}`;
}
