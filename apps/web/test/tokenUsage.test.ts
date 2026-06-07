import assert from "node:assert/strict";
import test from "node:test";
import { formatTokenCount } from "../src/domain/tokenUsage";

test("formatTokenCount uses B suffix for billion-level token counts", () => {
  assert.equal(formatTokenCount(999_999_999), "1000.0M");
  assert.equal(formatTokenCount(1_000_000_000), "1.0B");
  assert.equal(formatTokenCount(2_500_000_000), "2.5B");
});
