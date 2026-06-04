import { useMemo, useState } from "react";
import type { Project, TokenUsageDay, TokenUsageOverview as TokenUsageOverviewData, TokenUsageRange } from "@pi-gui/shared";
import { formatHour, formatTokenCount, tokenUsageIntensity } from "../domain/tokenUsage";
import { useTokenUsageOverview } from "../hooks/useTokenUsageOverview";

type TokenUsageOverviewProps = {
  projects: Project[];
};

type TokenUsageTab = "overview" | "models";
type TokenUsagePalette = "blue" | "green";

const RANGE_OPTIONS: Array<{ value: TokenUsageRange; label: string }> = [
  { value: "all", label: "All" },
  { value: "30d", label: "30d" },
  { value: "7d", label: "7d" },
];

export function TokenUsageOverview({ projects }: TokenUsageOverviewProps) {
  const [tab, setTab] = useState<TokenUsageTab>("overview");
  const [range, setRange] = useState<TokenUsageRange>("30d");
  const [projectId, setProjectId] = useState<string | undefined>();
  const [palette, setPalette] = useState<TokenUsagePalette>("blue");
  const { usage, loading, error, refresh } = useTokenUsageOverview(range, projectId);
  const maxTokens = useMemo(() => Math.max(0, ...(usage?.days.map((day) => day.tokens.total) ?? [0])), [usage]);

  return (
    <section className="token-usage-shell" aria-label="Token usage overview">
      <div className={`token-usage-card palette-${palette}`}>
        <header className="token-usage-header">
          <nav className="token-usage-tabs" aria-label="Usage view">
            <button className={tab === "overview" ? "selected" : ""} type="button" onClick={() => setTab("overview")}>
              Overview
            </button>
            <button className={tab === "models" ? "selected" : ""} type="button" onClick={() => setTab("models")}>
              Models
            </button>
          </nav>
          <div className="token-usage-actions">
            <select aria-label="项目过滤" value={projectId ?? ""} onChange={(event) => setProjectId(event.currentTarget.value || undefined)}>
              <option value="">All projects</option>
              {projects.map((project) => (
                <option value={project.id} key={project.id}>
                  {project.name}
                </option>
              ))}
            </select>
            <select aria-label="颜色" value={palette} onChange={(event) => setPalette(event.currentTarget.value as TokenUsagePalette)}>
              <option value="blue">Blue</option>
              <option value="green">Green</option>
            </select>
            <div className="token-usage-range" role="group" aria-label="时间范围">
              {RANGE_OPTIONS.map((option) => (
                <button className={range === option.value ? "selected" : ""} type="button" key={option.value} onClick={() => setRange(option.value)}>
                  {option.label}
                </button>
              ))}
            </div>
            <button className="token-usage-refresh" type="button" onClick={refresh} disabled={loading}>
              {loading ? "…" : "↻"}
            </button>
          </div>
        </header>

        {error ? <p className="token-usage-error">{error}</p> : null}
        {tab === "overview" ? <OverviewContent usage={usage} loading={loading} maxTokens={maxTokens} /> : <ModelsContent usage={usage} loading={loading} />}
      </div>
    </section>
  );
}

function OverviewContent({ usage, loading, maxTokens }: { usage?: TokenUsageOverviewData; loading: boolean; maxTokens: number }) {
  const summary = usage?.summary;
  const tiles = [
    { label: "Sessions", value: summary ? summary.sessions.toLocaleString() : "—" },
    { label: "Messages", value: summary ? summary.messages.toLocaleString() : "—" },
    { label: "Total tokens", value: summary ? formatTokenCount(summary.totalTokens) : "—" },
    { label: "Active days", value: summary ? summary.activeDays.toLocaleString() : "—" },
    { label: "Current streak", value: summary ? `${summary.currentStreakDays}d` : "—" },
    { label: "Longest streak", value: summary ? `${summary.longestStreakDays}d` : "—" },
    { label: "Peak hour", value: summary ? formatHour(summary.peakHour) : "—" },
    { label: "Favorite model", value: summary?.favoriteModel ?? "—" },
  ];

  return (
    <>
      <div className="token-usage-metrics" aria-busy={loading}>
        {tiles.map((tile) => (
          <div className="token-usage-metric" key={tile.label}>
            <span>{tile.label}</span>
            <strong>{tile.value}</strong>
          </div>
        ))}
      </div>
      <Heatmap days={usage?.days ?? []} maxTokens={maxTokens} loading={loading} />
      <UsageSummary usage={usage} loading={loading} />
    </>
  );
}

function Heatmap({ days, maxTokens, loading }: { days: TokenUsageDay[]; maxTokens: number; loading: boolean }) {
  if (!loading && days.length === 0) return <p className="token-usage-empty">暂无 token usage。</p>;
  return (
    <div className="token-usage-heatmap" aria-label="Daily token usage" aria-busy={loading}>
      {days.map((day) => {
        const intensity = tokenUsageIntensity(day, maxTokens);
        const title = `${day.day}: ${formatTokenCount(day.tokens.total)} tokens · input ${formatTokenCount(day.tokens.input)} · output ${formatTokenCount(day.tokens.output)} · cache ${formatTokenCount((day.tokens.cacheRead ?? 0) + (day.tokens.cacheWrite ?? 0))}`;
        return (
          <button className={`token-usage-cell level-${intensity}`} type="button" key={day.day} title={title} aria-label={title}>
            <span>{day.day}</span>
          </button>
        );
      })}
    </div>
  );
}

function UsageSummary({ usage, loading }: { usage?: TokenUsageOverviewData; loading: boolean }) {
  if (loading && !usage) return <p className="token-usage-caption">Loading token activity…</p>;
  if (!usage || usage.summary.totalTokens === 0) return <p className="token-usage-caption">No recorded token usage yet.</p>;
  const quality = usage.summary.quality === "recorded" ? "recorded" : usage.summary.quality === "partial" ? "partial recorded" : "empty";
  return (
    <p className="token-usage-caption">
      You’ve used {formatTokenCount(usage.summary.totalTokens)} recorded tokens across {usage.summary.activeDays} active days. <span>{quality}</span>
    </p>
  );
}

function ModelsContent({ usage, loading }: { usage?: TokenUsageOverviewData; loading: boolean }) {
  if (loading && !usage) return <p className="token-usage-caption">Loading model usage…</p>;
  if (!usage || usage.models.length === 0) return <p className="token-usage-empty">暂无 model usage。</p>;
  return (
    <div className="token-usage-models">
      {usage.models.map((model) => (
        <div className="token-usage-model-row" key={`${model.provider ?? "unknown"}/${model.model}`}>
          <span>
            <strong>{model.model}</strong>
            <small>{[model.provider, `${model.messages} messages`, `${model.activeDays} days`].filter(Boolean).join(" · ")}</small>
          </span>
          <b>{formatTokenCount(model.totalTokens)}</b>
        </div>
      ))}
    </div>
  );
}
