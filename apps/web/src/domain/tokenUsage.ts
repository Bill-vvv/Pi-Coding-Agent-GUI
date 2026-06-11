import type { TokenUsageDay, TokenUsageRange } from "@pi-gui/shared";
import { formatCompactCount } from "./numberFormat";

const WEEKDAY_LABELS = ["一", "二", "三", "四", "五", "六", "日"] as const;

export type TokenUsageCalendarCell = {
  key: string;
  day: TokenUsageDay;
  date: Date;
  intensity: number;
  inRange: boolean;
};

export type TokenUsageCalendarMonthLabel = {
  year?: string;
  month: string;
};

export type TokenUsageCalendarWeek = {
  key: string;
  monthLabel?: TokenUsageCalendarMonthLabel;
  days: TokenUsageCalendarCell[];
};

export type TokenUsageCalendar = {
  weekdayLabels: readonly string[];
  weeks: TokenUsageCalendarWeek[];
};

export function tokenUsageIntensity(day: TokenUsageDay, maxTokens: number): number {
  if (day.tokens.total <= 0 || maxTokens <= 0) return 0;
  const ratio = day.tokens.total / maxTokens;
  if (ratio >= 0.8) return 4;
  if (ratio >= 0.45) return 3;
  if (ratio >= 0.18) return 2;
  return 1;
}

export function buildTokenUsageCalendar(days: TokenUsageDay[], maxTokens: number, generatedAt = Date.now(), range?: TokenUsageRange): TokenUsageCalendar {
  const sortedDays = [...days].filter((day) => validDayKey(day.day)).sort((left, right) => left.day.localeCompare(right.day));
  const daysByKey = new Map(sortedDays.map((day) => [day.day, day]));
  const generatedDay = startOfLocalDay(new Date(generatedAt));
  const fixedRangeDays = fixedRangeDayCount(range);
  if (sortedDays.length === 0 && !fixedRangeDays) return { weekdayLabels: WEEKDAY_LABELS, weeks: [] };

  const firstDay = fixedRangeDays ? addDays(generatedDay, -(fixedRangeDays - 1)) : parseDayKey(sortedDays[0]?.day);
  const lastRecordedDay = sortedDays.length > 0 ? parseDayKey(sortedDays[sortedDays.length - 1]?.day) : generatedDay;
  const lastDay = fixedRangeDays ? generatedDay : lastRecordedDay.getTime() > generatedDay.getTime() ? lastRecordedDay : generatedDay;
  const gridStart = addDays(firstDay, -mondayFirstWeekdayIndex(firstDay));
  const gridEnd = addDays(lastDay, 6 - mondayFirstWeekdayIndex(lastDay));
  const weeks: TokenUsageCalendarWeek[] = [];

  for (let cursor = gridStart; cursor.getTime() <= gridEnd.getTime(); cursor = addDays(cursor, 7)) {
    const weekDays: TokenUsageCalendarCell[] = [];
    for (let offset = 0; offset < 7; offset += 1) {
      const date = addDays(cursor, offset);
      const key = dayKey(date);
      const day = daysByKey.get(key) ?? emptyUsageDay(key);
      const inRange = date.getTime() >= firstDay.getTime() && date.getTime() <= lastDay.getTime();
      weekDays.push({ key, day, date, intensity: inRange ? tokenUsageIntensity(day, maxTokens) : 0, inRange });
    }
    weeks.push({ key: dayKey(cursor), days: weekDays });
  }

  return { weekdayLabels: WEEKDAY_LABELS, weeks: weeksWithMonthLabels(weeks) };
}

export function formatTokenCount(value: number | undefined): string {
  return formatCompactCount(value ?? 0);
}

export function formatHour(hour: number | undefined): string {
  if (hour === undefined) return "—";
  return `${String(hour).padStart(2, "0")}:00`;
}

function fixedRangeDayCount(range: TokenUsageRange | undefined): number | undefined {
  if (range === "365d") return 365;
  if (range === "30d") return 30;
  if (range === "7d") return 7;
  return undefined;
}

function weeksWithMonthLabels(weeks: TokenUsageCalendarWeek[]): TokenUsageCalendarWeek[] {
  let lastLabelKey = "";
  let emittedLabels = 0;
  return weeks.map((week, index) => {
    const labelDay = index === 0 ? week.days.find((day) => day.inRange) : week.days.find((day) => day.inRange && day.date.getDate() <= 7);
    if (!labelDay) return week;
    const labelKey = `${labelDay.date.getFullYear()}-${labelDay.date.getMonth()}`;
    if (labelKey === lastLabelKey) return week;
    lastLabelKey = labelKey;
    emittedLabels += 1;
    return { ...week, monthLabel: monthLabel(labelDay.date, emittedLabels === 1) };
  });
}

function monthLabel(date: Date, includeYear: boolean): TokenUsageCalendarMonthLabel {
  return { year: includeYear || date.getMonth() === 0 ? `${date.getFullYear()}` : undefined, month: `${date.getMonth() + 1}月` };
}

function mondayFirstWeekdayIndex(date: Date): number {
  return (date.getDay() + 6) % 7;
}

function validDayKey(value: string): boolean {
  if (!/^\d{4}-\d{2}-\d{2}$/.test(value)) return false;
  return dayKey(parseDayKey(value)) === value;
}

function parseDayKey(value: string | undefined): Date {
  const match = /^(\d{4})-(\d{2})-(\d{2})$/.exec(value ?? "");
  if (!match) return startOfLocalDay(new Date());
  return new Date(Number(match[1]), Number(match[2]) - 1, Number(match[3]));
}

function dayKey(date: Date): string {
  const year = date.getFullYear();
  const month = String(date.getMonth() + 1).padStart(2, "0");
  const day = String(date.getDate()).padStart(2, "0");
  return `${year}-${month}-${day}`;
}

function addDays(date: Date, count: number): Date {
  const next = new Date(date);
  next.setDate(next.getDate() + count);
  return startOfLocalDay(next);
}

function startOfLocalDay(date: Date): Date {
  const next = new Date(date);
  next.setHours(0, 0, 0, 0);
  return next;
}

function emptyUsageDay(key: string): TokenUsageDay {
  return { day: key, tokens: { total: 0 }, sessions: 0, assistantMessages: 0, models: [] };
}
