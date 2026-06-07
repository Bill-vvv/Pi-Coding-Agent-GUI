import { useMemo, useState } from "react";
import type { Project, TokenUsageDay, TokenUsageOverview as TokenUsageOverviewData, TokenUsageRange } from "@pi-gui/shared";
import { formatCompactCount, formatDayCount } from "../domain/numberFormat";
import { formatHour, formatTokenCount, tokenUsageIntensity } from "../domain/tokenUsage";
import { useTokenUsageOverview } from "../hooks/useTokenUsageOverview";

type TokenUsageOverviewProps = {
  projects: Project[];
};

type TokenUsageTab = "overview" | "models";
type TokenUsagePalette = "blue" | "green";

const RANGE_OPTIONS: Array<{ value: TokenUsageRange; label: string }> = [
  { value: "all", label: "全部" },
  { value: "30d", label: "30 天" },
  { value: "7d", label: "7 天" },
];

export function TokenUsageOverview({ projects }: TokenUsageOverviewProps) {
  const [tab, setTab] = useState<TokenUsageTab>("overview");
  const [range, setRange] = useState<TokenUsageRange>("30d");
  const [projectId, setProjectId] = useState<string | undefined>();
  const [palette, setPalette] = useState<TokenUsagePalette>("blue");
  const { usage, loading, error, refresh } = useTokenUsageOverview(range, projectId);
  const maxTokens = useMemo(() => Math.max(0, ...(usage?.days.map((day) => day.tokens.total) ?? [0])), [usage]);

  return (
    <section className="token-usage-shell" aria-label="token 用量概览">
      <div className={`token-usage-card palette-${palette}`}>
        <header className="token-usage-header">
          <nav className="token-usage-tabs" aria-label="用量视图">
            <button className={tab === "overview" ? "selected" : ""} type="button" onClick={() => setTab("overview")}>
              概览
            </button>
            <button className={tab === "models" ? "selected" : ""} type="button" onClick={() => setTab("models")}>
              模型
            </button>
          </nav>
          <div className="token-usage-actions">
            <select aria-label="项目过滤" value={projectId ?? ""} onChange={(event) => setProjectId(event.currentTarget.value || undefined)}>
              <option value="">全部项目</option>
              {projects.map((project) => (
                <option value={project.id} key={project.id}>
                  {project.name}
                </option>
              ))}
            </select>
            <select aria-label="颜色" value={palette} onChange={(event) => setPalette(event.currentTarget.value as TokenUsagePalette)}>
              <option value="blue">蓝色</option>
              <option value="green">绿色</option>
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
    { label: "会话", value: summary ? formatCompactCount(summary.sessions) : "—" },
    { label: "消息", value: summary ? formatCompactCount(summary.messages) : "—" },
    { label: "总 token", value: summary ? formatTokenCount(summary.totalTokens) : "—" },
    { label: "活跃日", value: summary ? formatDayCount(summary.activeDays) : "—" },
    { label: "当前连续", value: summary ? formatDayCount(summary.currentStreakDays) : "—" },
    { label: "最长连续", value: summary ? formatDayCount(summary.longestStreakDays) : "—" },
    { label: "高峰时段", value: summary ? formatHour(summary.peakHour) : "—" },
    { label: "常用模型", value: summary?.favoriteModel ?? "—" },
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
  if (!loading && days.length === 0) return <p className="token-usage-empty">暂无 token 用量。</p>;
  return (
    <div className="token-usage-heatmap" aria-label="每日 token 用量" aria-busy={loading}>
      {days.map((day) => {
        const intensity = tokenUsageIntensity(day, maxTokens);
        const title = `${day.day}：${formatTokenCount(day.tokens.total)} token · 输入 ${formatTokenCount(day.tokens.input)} · 输出 ${formatTokenCount(day.tokens.output)} · 缓存 ${formatTokenCount((day.tokens.cacheRead ?? 0) + (day.tokens.cacheWrite ?? 0))}`;
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
  if (loading && !usage) return <p className="token-usage-caption">正在加载 token 活动…</p>;
  if (!usage || usage.summary.totalTokens === 0) return <p className="token-usage-caption">暂无已记录 token 用量。</p>;
  const quality = usage.summary.quality === "recorded" ? "已完整记录" : usage.summary.quality === "partial" ? "部分记录" : "暂无记录";
  return (
    <p className="token-usage-caption">
      已记录 {formatTokenCount(usage.summary.totalTokens)} 个 token，覆盖 {formatDayCount(usage.summary.activeDays)}。<span>{quality}</span>
    </p>
  );
}

function ModelsContent({ usage, loading }: { usage?: TokenUsageOverviewData; loading: boolean }) {
  if (loading && !usage) return <p className="token-usage-caption">正在加载模型用量…</p>;
  if (!usage || usage.models.length === 0) return <p className="token-usage-empty">暂无模型用量。</p>;
  return (
    <div className="token-usage-models">
      {usage.models.map((model) => (
        <div className="token-usage-model-row" key={`${model.provider ?? "unknown"}/${model.model}`}>
          <span>
            <strong>{model.model}</strong>
            <small>{[model.provider, `${formatCompactCount(model.messages)} 条消息`, formatDayCount(model.activeDays)].filter(Boolean).join(" · ")}</small>
          </span>
          <b>{formatTokenCount(model.totalTokens)}</b>
        </div>
      ))}
    </div>
  );
}
