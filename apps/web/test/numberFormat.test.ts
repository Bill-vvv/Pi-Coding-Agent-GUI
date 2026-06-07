import assert from "node:assert/strict";
import test from "node:test";
import { formatCompactCount, formatDayCount, formatFullCount, formatPercent } from "../src/domain/numberFormat";

test("formatCompactCount uses stable K/M/B suffixes for summary numbers", () => {
  assert.equal(formatCompactCount(undefined), "—");
  assert.equal(formatCompactCount(999), "999");
  assert.equal(formatCompactCount(1_250), "1.3K");
  assert.equal(formatCompactCount(2_500_000), "2.5M");
});

test("formatFullCount keeps precise localized detail counts", () => {
  assert.equal(formatFullCount(undefined), "—");
  assert.equal(formatFullCount(1_234.5), "1,235");
});

test("formatDayCount and formatPercent keep semantic units", () => {
  assert.equal(formatDayCount(12), "12天");
  assert.equal(formatDayCount(12_000), "12.0K天");
  assert.equal(formatPercent(0), "0%");
  assert.equal(formatPercent(3.45), "3.5%");
  assert.equal(formatPercent(73.4), "73%");
  assert.equal(formatPercent(Number.NaN), "—");
});
