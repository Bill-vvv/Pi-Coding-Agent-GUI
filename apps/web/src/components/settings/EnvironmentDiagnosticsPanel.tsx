import type { EnvironmentDiagnostics } from "@pi-gui/shared";

export function EnvironmentDiagnosticsPanel({ state }: { state: { diagnostics?: EnvironmentDiagnostics; loading: boolean; error?: string; refresh: () => Promise<void> } }) {
  const diagnostics = state.diagnostics;
  const readiness = diagnostics?.readiness;
  const status = readiness?.status ?? (state.error ? "error" : state.loading ? "warning" : "warning");

  return (
    <details className="settings-diagnostics-dropdown">
      <summary>
        <span className="settings-diagnostics-summary-main">
          <span>环境诊断</span>
          <small>{state.loading ? "正在检测…" : state.error ? "读取失败" : diagnostics ? environmentStatusLabel(status) : "尚未检测"}</small>
        </span>
        <span className={`settings-diagnostics-pill ${status}`}>{environmentStatusShortLabel(status)}</span>
      </summary>

      <div className="settings-diagnostics-body">
        {state.error ? <p className="settings-diagnostics-error">{state.error}</p> : null}
        {diagnostics ? <EnvironmentDiagnosticsDetails diagnostics={diagnostics} /> : !state.error ? <p className="muted">打开设置后会自动读取本地 backend 诊断。</p> : null}
        <button className="settings-secondary-button" type="button" onClick={() => void state.refresh()} disabled={state.loading}>
          {state.loading ? "检测中…" : "刷新诊断"}
        </button>
      </div>
    </details>
  );
}

function EnvironmentDiagnosticsDetails({ diagnostics }: { diagnostics: EnvironmentDiagnostics }) {
  const rows = [
    ["Backend", `${diagnostics.backend?.host ?? "?"}:${diagnostics.backend?.port ?? "?"} · ${diagnostics.platform}/${diagnostics.arch} · Node ${diagnostics.nodeVersion}`],
    ["npm", diagnostics.npmVersion ?? "未检测到"],
    ["WSL", diagnostics.wsl.isWsl ? `${diagnostics.wsl.distroName ?? "WSL"}${diagnostics.wsl.interop ? " · interop" : ""}` : "未检测到"],
    ["Pi", diagnostics.pi.installed ? `${diagnostics.pi.version ?? "已安装"}${diagnostics.pi.path ? ` · ${diagnostics.pi.path}` : ""}` : diagnostics.pi.error ?? "未检测到"],
    ["Pi RPC", diagnostics.pi.rpcSmoke ? (diagnostics.pi.rpcSmoke.ok ? `可用 · ${diagnostics.pi.rpcSmoke.durationMs ?? 0}ms` : diagnostics.pi.rpcSmoke.error ?? "失败") : diagnostics.pi.installed ? "未检测" : "不可用"],
  ];

  return (
    <>
      <div className="settings-diagnostics-grid">
        {rows.map(([label, value]) => (
          <div className="settings-diagnostics-row" key={label}>
            <span>{label}</span>
            <strong title={value}>{value}</strong>
          </div>
        ))}
      </div>
      {diagnostics.readiness?.issues.length ? (
        <div className="settings-diagnostics-issues">
          {diagnostics.readiness.issues.map((issue) => (
            <div className={`settings-diagnostics-issue ${issue.severity}`} key={issue.code}>
              <strong>{issue.message}</strong>
              {issue.detail ? <small>{issue.detail}</small> : null}
              {issue.remediation ? <small>{issue.remediation}</small> : null}
            </div>
          ))}
        </div>
      ) : (
        <p className="settings-diagnostics-ok">环境看起来已准备好。</p>
      )}
    </>
  );
}

function environmentStatusLabel(status: NonNullable<EnvironmentDiagnostics["readiness"]>["status"]): string {
  switch (status) {
    case "ready":
      return "已就绪";
    case "warning":
      return "需要注意";
    case "error":
      return "需要修复";
  }
}

function environmentStatusShortLabel(status: NonNullable<EnvironmentDiagnostics["readiness"]>["status"]): string {
  switch (status) {
    case "ready":
      return "Ready";
    case "warning":
      return "Warn";
    case "error":
      return "Error";
  }
}
