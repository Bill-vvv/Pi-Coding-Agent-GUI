import assert from "node:assert/strict";
import test from "node:test";
import { markdownEnhancementCacheKey, scheduleDeferredMarkdownTask } from "../src/domain/markdownEnhancement";

test("markdownEnhancementCacheKey depends only on language and content", () => {
  assert.equal(markdownEnhancementCacheKey("TS", "const value = 1;"), markdownEnhancementCacheKey("ts", "const value = 1;"));
  assert.notEqual(markdownEnhancementCacheKey("ts", "const value = 1;"), markdownEnhancementCacheKey("ts", "const value = 2;"));
});

test("scheduleDeferredMarkdownTask falls back to timeout scheduling when requestIdleCallback is unavailable", async () => {
  const originalRequestIdleCallback = (globalThis as { requestIdleCallback?: unknown }).requestIdleCallback;
  const originalCancelIdleCallback = (globalThis as { cancelIdleCallback?: unknown }).cancelIdleCallback;
  delete (globalThis as { requestIdleCallback?: unknown }).requestIdleCallback;
  delete (globalThis as { cancelIdleCallback?: unknown }).cancelIdleCallback;

  let called = false;
  try {
    scheduleDeferredMarkdownTask(() => {
      called = true;
    }, { timeoutMs: 0 });
    await new Promise((resolve) => globalThis.setTimeout(resolve, 10));
    assert.equal(called, true);
  } finally {
    if (originalRequestIdleCallback !== undefined) (globalThis as { requestIdleCallback?: unknown }).requestIdleCallback = originalRequestIdleCallback;
    if (originalCancelIdleCallback !== undefined) (globalThis as { cancelIdleCallback?: unknown }).cancelIdleCallback = originalCancelIdleCallback;
  }
});

test("scheduleDeferredMarkdownTask cancellation prevents timeout fallback execution", async () => {
  const originalRequestIdleCallback = (globalThis as { requestIdleCallback?: unknown }).requestIdleCallback;
  const originalCancelIdleCallback = (globalThis as { cancelIdleCallback?: unknown }).cancelIdleCallback;
  delete (globalThis as { requestIdleCallback?: unknown }).requestIdleCallback;
  delete (globalThis as { cancelIdleCallback?: unknown }).cancelIdleCallback;

  let called = false;
  try {
    const scheduled = scheduleDeferredMarkdownTask(() => {
      called = true;
    }, { timeoutMs: 10 });
    scheduled.cancel();
    await new Promise((resolve) => globalThis.setTimeout(resolve, 20));
    assert.equal(called, false);
  } finally {
    if (originalRequestIdleCallback !== undefined) (globalThis as { requestIdleCallback?: unknown }).requestIdleCallback = originalRequestIdleCallback;
    if (originalCancelIdleCallback !== undefined) (globalThis as { cancelIdleCallback?: unknown }).cancelIdleCallback = originalCancelIdleCallback;
  }
});
