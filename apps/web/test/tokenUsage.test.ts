import assert from "node:assert/strict";
import test from "node:test";
import type { TokenUsageDay } from "@pi-gui/shared";
import { buildTokenUsageCalendar, formatTokenCount } from "../src/domain/tokenUsage";

test("formatTokenCount uses B suffix for billion-level token counts", () => {
  assert.equal(formatTokenCount(999_999_999), "1000.0M");
  assert.equal(formatTokenCount(1_000_000_000), "1.0B");
  assert.equal(formatTokenCount(2_500_000_000), "2.5B");
});

test("buildTokenUsageCalendar groups a GitHub-sized year into 7-day week columns", () => {
  const days = consecutiveUsageDays("2025-06-11", 365);
  const calendar = buildTokenUsageCalendar(days, 100, Date.parse("2026-06-10T12:00:00.000Z"));

  assert.equal(calendar.weeks.length, 53);
  assert.ok(calendar.weeks.every((week) => week.days.length === 7));
  assert.deepEqual(calendar.weekdayLabels, ["一", "二", "三", "四", "五", "六", "日"]);
  assert.equal(calendar.weeks[0]?.days[0]?.key, "2025-06-09");
  assert.equal(calendar.weeks[0]?.days[0]?.inRange, false);
  assert.equal(calendar.weeks[0]?.days[2]?.key, "2025-06-11");
  assert.equal(calendar.weeks[0]?.days[2]?.inRange, true);
  assert.equal(calendar.weeks.at(-1)?.days.at(-1)?.key, "2026-06-14");
  assert.equal(calendar.weeks.at(-1)?.days.at(-1)?.inRange, false);
});

test("buildTokenUsageCalendar fills missing days between recorded usage and generated date", () => {
  const calendar = buildTokenUsageCalendar([usageDay("2026-06-01", 12)], 12, Date.parse("2026-06-03T12:00:00.000Z"));
  const cells = calendar.weeks.flatMap((week) => week.days);

  assert.equal(cells.find((cell) => cell.key === "2026-06-01")?.intensity, 4);
  assert.equal(cells.find((cell) => cell.key === "2026-06-02")?.day.tokens.total, 0);
  assert.equal(cells.find((cell) => cell.key === "2026-06-03")?.inRange, true);
});

test("buildTokenUsageCalendar keeps the one-year view full even when the response has few rows", () => {
  const calendar = buildTokenUsageCalendar([usageDay("2026-06-10", 12)], 12, Date.parse("2026-06-10T12:00:00.000Z"), "365d");

  assert.equal(calendar.weeks.length, 53);
  assert.equal(calendar.weeks[0]?.days[0]?.key, "2025-06-09");
  assert.equal(calendar.weeks[0]?.days[0]?.inRange, false);
  assert.equal(calendar.weeks[0]?.days[2]?.key, "2025-06-11");
  assert.equal(calendar.weeks[0]?.days[2]?.inRange, true);
  assert.equal(calendar.weeks.at(-1)?.days[2]?.key, "2026-06-10");
  assert.equal(calendar.weeks.at(-1)?.days.at(-1)?.key, "2026-06-14");
});

test("buildTokenUsageCalendar emits aligned month labels with the first label carrying the year", () => {
  const calendar = buildTokenUsageCalendar(consecutiveUsageDays("2025-12-29", 12), 100, Date.parse("2026-01-09T12:00:00.000Z"));
  assert.deepEqual(calendar.weeks[0]?.monthLabel, { year: "2025", month: "12月" });
  assert.deepEqual(calendar.weeks[1]?.monthLabel, { year: "2026", month: "1月" });
});

function consecutiveUsageDays(start: string, count: number): TokenUsageDay[] {
  const result: TokenUsageDay[] = [];
  const cursor = parseLocalDay(start);
  for (let index = 0; index < count; index += 1) {
    result.push(usageDay(dayKey(cursor), index === count - 1 ? 100 : 0));
    cursor.setDate(cursor.getDate() + 1);
  }
  return result;
}

function usageDay(day: string, total: number): TokenUsageDay {
  return { day, tokens: { total }, sessions: total > 0 ? 1 : 0, assistantMessages: total > 0 ? 1 : 0, models: [] };
}

function parseLocalDay(value: string): Date {
  const [year, month, day] = value.split("-").map(Number);
  return new Date(year, month - 1, day);
}

function dayKey(date: Date): string {
  return `${date.getFullYear()}-${String(date.getMonth() + 1).padStart(2, "0")}-${String(date.getDate()).padStart(2, "0")}`;
}
