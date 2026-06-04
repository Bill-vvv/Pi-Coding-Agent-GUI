import { useEffect, useMemo, useState } from "react";
import type { AppSettings, ResponseMode, RuntimeStatus, ThinkingLevel } from "@pi-gui/shared";

type ModelEvidenceSource = "provider_request" | "session_assistant_message" | "pi_state" | "runtime_config" | "session_model_change" | "settings_default" | "unknown";

type ModelDebugEvidence = {
  source: string;
  model?: string;
  thinkingLevel?: ThinkingLevel;
  timestamp?: number;
  eventId?: number;
  note?: string;
};

type ProviderRequestDebug = {
  model?: string;
  payloadModel?: string;
  contextModel?: string;
  provider?: string;
  modelId?: string;
  api?: string;
  serviceTier?: string;
  timestamp?: number;
  eventId?: number;
};

type SessionFileModelDebug = {
  model?: string;
  thinkingLevel?: ThinkingLevel;
  lastModelChangeModel?: string;
  lastModelChangeAt?: number;
  lastThinkingLevelChangeAt?: number;
  lastAssistantMessageModel?: string;
  lastAssistantMessageAt?: number;
  assistantModelCounts: Record<string, number>;
  entriesRead: number;
  error?: string;
};

type SessionModelDebugRow = {
  key: string;
  projectId: string;
  projectName?: string;
  cwd?: string;
  runtimeId?: string;
  runtimeStatus?: RuntimeStatus;
  runtimeArchivedAt?: number;
  sessionId?: string;
  sessionTitle?: string;
  sessionFile?: string;
  sessionUpdatedAt?: number;
  guiConfiguredModel?: string;
  guiConfiguredThinkingLevel?: ThinkingLevel;
  guiConfiguredResponseMode?: ResponseMode;
  piReportedModel?: string;
  piReportedThinkingLevel?: ThinkingLevel;
  piReportedAt?: number;
  sessionFileModel?: string;
  sessionFileThinkingLevel?: ThinkingLevel;
  lastAssistantMessageModel?: string;
  lastAssistantMessageAt?: number;
  lastProviderRequestModel?: string;
  lastProviderRequestPayloadModel?: string;
  lastProviderRequestAt?: number;
  effectiveModel?: string;
  effectiveModelSource: ModelEvidenceSource;
  evidence: ModelDebugEvidence[];
  providerRequest?: ProviderRequestDebug;
  sessionFileScan?: SessionFileModelDebug;
  recentModelEvents: ModelDebugEvidence[];
};

type SessionModelDebugSnapshot = {
  generatedAt: number;
  settings: AppSettings;
  rows: SessionModelDebugRow[];
  notes: string[];
};

const AUTO_REFRESH_MS = 3000;

export function ModelDebugPage() {
  const [snapshot, setSnapshot] = useState<SessionModelDebugSnapshot | undefined>();
  const [error, setError] = useState<string | undefined>();
  const [loading, setLoading] = useState(false);
  const [autoRefresh, setAutoRefresh] = useState(true);
  const [filter, setFilter] = useState("");

  async function load() {
    setLoading(true);
    try {
      const response = await fetch("/api/debug/session-models", { cache: "no-store" });
      if (!response.ok) throw new Error(`HTTP ${response.status}`);
      const data = (await response.json()) as SessionModelDebugSnapshot;
      setSnapshot(data);
      setError(undefined);
    } catch (loadError) {
      setError((loadError as Error).message);
    } finally {
      setLoading(false);
    }
  }

  useEffect(() => {
    void load();
  }, []);

  useEffect(() => {
    if (!autoRefresh) return;
    const timer = window.setInterval(() => void load(), AUTO_REFRESH_MS);
    return () => window.clearInterval(timer);
  }, [autoRefresh]);

  const rows = useMemo(() => {
    const query = filter.trim().toLowerCase();
    if (!query) return snapshot?.rows ?? [];
    return (snapshot?.rows ?? []).filter((row) => JSON.stringify(row).toLowerCase().includes(query));
  }, [filter, snapshot]);

  return (
    <main className="model-debug-page">
      <header className="model-debug-header">
        <div>
          <p className="model-debug-kicker">Pi GUI Debug</p>
          <h1>Session 模型使用情况</h1>
          <p>用于判断右下角显示、GUI runtime 配置、Pi get_state、session 文件和实际 provider request 是否一致。</p>
        </div>
        <div className="model-debug-actions">
          <a className="debug-link" href="/">返回 GUI</a>
          <button type="button" onClick={() => void load()} disabled={loading}>{loading ? "刷新中…" : "立即刷新"}</button>
          <label className="debug-toggle">
            <input type="checkbox" checked={autoRefresh} onChange={(event) => setAutoRefresh(event.target.checked)} />
            自动刷新
          </label>
        </div>
      </header>

      <section className="model-debug-summary">
        <div><span>生成时间</span><strong>{formatTime(snapshot?.generatedAt)}</strong></div>
        <div><span>默认模型</span><strong>{snapshot?.settings.defaultModel ?? "未设置"}</strong></div>
        <div><span>默认思考</span><strong>{snapshot?.settings.defaultThinkingLevel ?? "未设置"}</strong></div>
        <div><span>默认速度</span><strong>{snapshot?.settings.responseMode ?? "未设置"}</strong></div>
      </section>

      {error ? <div className="model-debug-error">读取调试信息失败：{error}</div> : null}

      <section className="model-debug-controls">
        <input value={filter} onChange={(event) => setFilter(event.target.value)} placeholder="过滤 project / runtime / session / model…" />
        <span>{rows.length} / {snapshot?.rows.length ?? 0} 条</span>
      </section>

      <section className="model-debug-notes">
        {(snapshot?.notes ?? []).map((note) => <p key={note}>{note}</p>)}
      </section>

      <section className="model-debug-table-wrap">
        <table className="model-debug-table">
          <thead>
            <tr>
              <th>Project / Session</th>
              <th>最终判断</th>
              <th>实际调用证据</th>
              <th>Pi 当前状态</th>
              <th>GUI 配置</th>
              <th>Session 文件</th>
              <th>详情</th>
            </tr>
          </thead>
          <tbody>
            {rows.map((row) => <ModelDebugRowView row={row} key={row.key} />)}
          </tbody>
        </table>
      </section>
    </main>
  );
}

function ModelDebugRowView({ row }: { row: SessionModelDebugRow }) {
  return (
    <tr className={row.effectiveModelSource === "settings_default" || row.effectiveModelSource === "unknown" ? "weak-evidence" : ""}>
      <td>
        <div className="debug-primary">{row.projectName ?? row.projectId}</div>
        <div className="debug-muted">runtime: {shortId(row.runtimeId)} · {row.runtimeStatus ?? "无 runtime"}</div>
        <div className="debug-muted">session: {shortId(row.sessionId)} {row.sessionTitle ? `· ${row.sessionTitle}` : ""}</div>
      </td>
      <td>
        <ModelBadge model={row.effectiveModel} />
        <div className="debug-source">source: {sourceLabel(row.effectiveModelSource)}</div>
      </td>
      <td>
        <ModelBadge model={row.lastProviderRequestModel ?? row.lastAssistantMessageModel} />
        <div className="debug-muted">provider request: {formatTime(row.lastProviderRequestAt)}</div>
        {row.lastProviderRequestPayloadModel ? <div className="debug-muted">payload.model: {row.lastProviderRequestPayloadModel}</div> : null}
      </td>
      <td>
        <ModelBadge model={row.piReportedModel} />
        <div className="debug-muted">thinking: {row.piReportedThinkingLevel ?? "—"}</div>
        <div className="debug-muted">{formatTime(row.piReportedAt)}</div>
      </td>
      <td>
        <ModelBadge model={row.guiConfiguredModel} />
        <div className="debug-muted">thinking: {row.guiConfiguredThinkingLevel ?? "—"}</div>
        <div className="debug-muted">speed: {row.guiConfiguredResponseMode ?? "—"}</div>
      </td>
      <td>
        <ModelBadge model={row.sessionFileModel} />
        <div className="debug-muted">last assistant: {formatTime(row.lastAssistantMessageAt)}</div>
        {row.sessionFileScan?.error ? <div className="debug-error-text">{row.sessionFileScan.error}</div> : null}
      </td>
      <td>
        <details>
          <summary>证据</summary>
          <pre>{JSON.stringify({
            runtimeId: row.runtimeId,
            sessionId: row.sessionId,
            sessionFile: row.sessionFile,
            providerRequest: row.providerRequest,
            evidence: row.evidence,
            recentModelEvents: row.recentModelEvents,
            assistantModelCounts: row.sessionFileScan?.assistantModelCounts,
          }, null, 2)}</pre>
        </details>
      </td>
    </tr>
  );
}

function ModelBadge({ model }: { model?: string }) {
  return <span className={model ? "model-debug-badge" : "model-debug-badge empty"}>{model ?? "未知"}</span>;
}

function sourceLabel(source: ModelEvidenceSource): string {
  switch (source) {
    case "provider_request": return "实际 provider request";
    case "session_assistant_message": return "session 已写入回复";
    case "pi_state": return "Pi get_state";
    case "runtime_config": return "GUI runtime 配置";
    case "session_model_change": return "session model_change";
    case "settings_default": return "新 session 默认值";
    case "unknown": return "未知";
  }
}

function shortId(value?: string): string {
  return value ? value.slice(0, 8) : "—";
}

function formatTime(timestamp?: number): string {
  if (!timestamp) return "—";
  try {
    return new Intl.DateTimeFormat("zh-CN", { month: "2-digit", day: "2-digit", hour: "2-digit", minute: "2-digit", second: "2-digit" }).format(new Date(timestamp));
  } catch {
    return String(timestamp);
  }
}
