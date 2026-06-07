const COMPACT_SUFFIXES = [
  { value: 1_000_000_000, suffix: "B" },
  { value: 1_000_000, suffix: "M" },
  { value: 1_000, suffix: "K" },
] as const;

const fullCountFormatter = new Intl.NumberFormat(undefined, { maximumFractionDigits: 0 });

export function formatCompactCount(value: number | undefined): string {
  if (value === undefined || !Number.isFinite(value)) return "—";
  const count = Math.round(value);
  const absoluteCount = Math.abs(count);
  const suffix = COMPACT_SUFFIXES.find((entry) => absoluteCount >= entry.value);
  if (!suffix) return String(count);
  return `${(count / suffix.value).toFixed(1)}${suffix.suffix}`;
}

export function formatFullCount(value: number | undefined): string {
  if (value === undefined || !Number.isFinite(value)) return "—";
  return fullCountFormatter.format(Math.round(value));
}

export function formatDayCount(value: number | undefined): string {
  if (value === undefined || !Number.isFinite(value)) return "—";
  return `${formatCompactCount(value)}天`;
}

export function formatPercent(percent: number): string {
  if (!Number.isFinite(percent)) return "—";
  if (percent <= 0) return "0%";
  if (percent < 10) return `${percent.toFixed(1)}%`;
  return `${Math.round(percent)}%`;
}
