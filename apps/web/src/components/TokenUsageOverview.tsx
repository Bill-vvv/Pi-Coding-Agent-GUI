import { useMemo, useRef, useState, type CSSProperties } from "react";
import type { Project, TokenUsageDay, TokenUsageOverview as TokenUsageOverviewData, TokenUsageRange } from "@pi-gui/shared";
import { formatCompactCount, formatDayCount, formatFullCount } from "../domain/numberFormat";
import { buildTokenUsageCalendar, formatHour, formatTokenCount } from "../domain/tokenUsage";
import { useTokenUsageOverview } from "../hooks/useTokenUsageOverview";

type TokenUsageOverviewProps = {
  projects: Project[];
};

type TokenUsageTab = "overview" | "models";
type TokenUsagePalette = "blue" | "green";

const RANGE_OPTIONS: Array<{ value: TokenUsageRange; label: string }> = [
  { value: "365d", label: "近一年" },
  { value: "all", label: "全部" },
  { value: "30d", label: "30 天" },
  { value: "7d", label: "7 天" },
];

export function TokenUsageOverview({ projects }: TokenUsageOverviewProps) {
  const [tab, setTab] = useState<TokenUsageTab>("overview");
  const [range, setRange] = useState<TokenUsageRange>("365d");
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
            <button className="token-usage-refresh" type="button" onClick={refresh} disabled={loading} aria-label="刷新 token 用量">
              {loading ? "…" : "↻"}
            </button>
          </div>
        </header>

        {error ? <p className="token-usage-error">{error}</p> : null}
        {tab === "overview" ? <OverviewContent usage={usage} loading={loading} maxTokens={maxTokens} range={range} /> : <ModelsContent usage={usage} loading={loading} />}
      </div>
    </section>
  );
}

function OverviewContent({ usage, loading, maxTokens, range }: { usage?: TokenUsageOverviewData; loading: boolean; maxTokens: number; range: TokenUsageRange }) {
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
      <Heatmap days={usage?.days ?? []} generatedAt={usage?.generatedAt} maxTokens={maxTokens} loading={loading} range={range} />
      <UsageSummary usage={usage} loading={loading} />
    </>
  );
}

function Heatmap({ days, generatedAt, maxTokens, loading, range }: { days: TokenUsageDay[]; generatedAt?: number; maxTokens: number; loading: boolean; range?: TokenUsageRange }) {
  const calendar = useMemo(() => buildTokenUsageCalendar(days, maxTokens, generatedAt, range), [days, generatedAt, maxTokens, range]);
  const panelRef = useRef<HTMLDivElement | null>(null);
  const [activeHover, setActiveHover] = useState<TokenUsageHoverState | undefined>();
  if (!loading && calendar.weeks.length === 0) return <p className="token-usage-empty">暂无 token 用量。</p>;

  const calendarStyle = { "--token-usage-weeks": String(calendar.weeks.length) } as CSSProperties;

  function activateCell(cell: CalendarCell, target: HTMLElement): void {
    const panel = panelRef.current;
    if (!panel) return;
    setActiveHover(positionHover(cell, target, panel));
  }

  return (
    <div ref={panelRef} className={`token-usage-calendar-panel range-${range ?? "all"}`} aria-label="每日 token 用量" aria-busy={loading} onMouseLeave={() => setActiveHover(undefined)}>
      <div className="token-usage-calendar-header">
        <span>Token 活动</span>
      </div>
      <div className="token-usage-calendar-scroll">
        <div className="token-usage-calendar" style={calendarStyle}>
          <div className="token-usage-calendar-corner" />
          {calendar.weeks.map((week, index) => (
            <div className={`token-usage-month-label${week.monthLabel?.year ? " with-year" : ""}`} style={calendarColumnStyle(index)} key={`${week.key}-label`}>
              {week.monthLabel?.year ? <span className="token-usage-month-year">{week.monthLabel.year}</span> : null}
              {week.monthLabel ? <span className="token-usage-month-name">{week.monthLabel.month}</span> : null}
            </div>
          ))}
          <div className="token-usage-weekday-labels">
            {calendar.weekdayLabels.map((label, index) => (
              <span key={`${label}-${index}`}>{label}</span>
            ))}
          </div>
          {calendar.weeks.map((week, index) => (
            <div className="token-usage-week-column" style={calendarColumnStyle(index)} key={week.key}>
              {week.days.map((cell) => (
                <TokenUsageCell cell={cell} active={activeHover?.cell.key === cell.key} onActivate={activateCell} onDeactivate={() => setActiveHover(undefined)} key={cell.key} />
              ))}
            </div>
          ))}
        </div>
      </div>
      <TokenUsageHoverInfo hover={activeHover} />
      <div className="token-usage-legend" aria-hidden="true">
        <span>少</span>
        <span className="token-usage-legend-cells">
          {[0, 1, 2, 3, 4].map((level) => (
            <span className={`token-usage-cell level-${level}`} key={level} />
          ))}
        </span>
        <span>多</span>
      </div>
    </div>
  );
}

type CalendarCell = ReturnType<typeof buildTokenUsageCalendar>["weeks"][number]["days"][number];
type TokenUsageHoverState = { cell: CalendarCell; left: number; top: number; placement: "above" | "below" };

function TokenUsageCell({ cell, active, onActivate, onDeactivate }: { cell: CalendarCell; active: boolean; onActivate: (cell: CalendarCell, target: HTMLElement) => void; onDeactivate: () => void }) {
  const label = tokenUsageCellLabel(cell);
  return (
    <button
      className={`token-usage-cell level-${cell.intensity}${cell.inRange ? "" : " outside"}${active ? " is-active" : ""}`}
      type="button"
      aria-label={label}
      aria-pressed={active}
      tabIndex={cell.inRange ? 0 : -1}
      onMouseEnter={(event) => onActivate(cell, event.currentTarget)}
      onFocus={(event) => onActivate(cell, event.currentTarget)}
      onBlur={onDeactivate}
      onClick={(event) => onActivate(cell, event.currentTarget)}
    >
      <span>{cell.key}</span>
    </button>
  );
}

function TokenUsageHoverInfo({ hover }: { hover?: TokenUsageHoverState }) {
  if (!hover) return null;
  const { cell } = hover;
  const cacheTokens = cacheTokenTotal(cell.day);
  const topModel = cell.day.models[0];
  const style = { left: hover.left, top: hover.top } as CSSProperties;
  return (
    <div className={`token-usage-tooltip ${hover.placement}`} style={style} role="tooltip">
      <div className="token-usage-tooltip-head">
        <span>{formatCellDate(cell.date)}</span>
        <strong>{formatFullCount(cell.day.tokens.total)} token</strong>
      </div>
      <div className="token-usage-tooltip-grid">
        <span>输入</span><b>{formatFullCount(cell.day.tokens.input)}</b>
        <span>输出</span><b>{formatFullCount(cell.day.tokens.output)}</b>
        <span>缓存</span><b>{formatFullCount(cacheTokens)}</b>
        <span>消息</span><b>{formatCompactCount(cell.day.assistantMessages)}</b>
        <span>会话</span><b>{formatCompactCount(cell.day.sessions)}</b>
      </div>
      {topModel ? <div className="token-usage-tooltip-model">{topModel.model}</div> : null}
    </div>
  );
}

function positionHover(cell: CalendarCell, target: HTMLElement, panel: HTMLElement): TokenUsageHoverState {
  const targetRect = target.getBoundingClientRect();
  const panelRect = panel.getBoundingClientRect();
  const tooltipWidth = 220;
  const rawLeft = targetRect.left - panelRect.left + targetRect.width / 2;
  const left = clamp(rawLeft, tooltipWidth / 2 + 8, panelRect.width - tooltipWidth / 2 - 8);
  const placement = targetRect.top - panelRect.top > 92 ? "above" : "below";
  const top = placement === "above" ? targetRect.top - panelRect.top - 8 : targetRect.bottom - panelRect.top + 8;
  return { cell, left, top, placement };
}

function tokenUsageCellLabel(cell: CalendarCell): string {
  const cacheTokens = cacheTokenTotal(cell.day);
  return `${formatCellDate(cell.date)}：${formatFullCount(cell.day.tokens.total)} token，输入 ${formatFullCount(cell.day.tokens.input)}，输出 ${formatFullCount(cell.day.tokens.output)}，缓存 ${formatFullCount(cacheTokens)}`;
}

function cacheTokenTotal(day: TokenUsageDay): number | undefined {
  return day.tokens.cacheRead === undefined && day.tokens.cacheWrite === undefined ? undefined : (day.tokens.cacheRead ?? 0) + (day.tokens.cacheWrite ?? 0);
}

function clamp(value: number, min: number, max: number): number {
  if (max < min) return value;
  return Math.min(max, Math.max(min, value));
}

function calendarColumnStyle(index: number): CSSProperties {
  return { gridColumn: index + 2 };
}

function formatCellDate(date: Date): string {
  return `${date.getFullYear()}-${String(date.getMonth() + 1).padStart(2, "0")}-${String(date.getDate()).padStart(2, "0")} ${["周日", "周一", "周二", "周三", "周四", "周五", "周六"][date.getDay()]}`;
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
