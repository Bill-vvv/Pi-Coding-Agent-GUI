import assert from "node:assert/strict";
import test from "node:test";
import { buildRetryFinalErrorMessage, buildRetryStartedMessage, formatRetryAttempt } from "../src/runtime/conversation/retryProjection.js";

test("formatRetryAttempt preserves existing retry suffix copy", () => {
  assert.equal(formatRetryAttempt(undefined, undefined), "");
  assert.equal(formatRetryAttempt(2, undefined), "（第 2 次）");
  assert.equal(formatRetryAttempt(2, 3), "（第 2/3 次）");
});

test("buildRetryStartedMessage preserves retry log projection copy", () => {
  assert.deepEqual(buildRetryStartedMessage({ id: "retry-1", attempt: 1, maxAttempts: 3, errorMessage: "timeout", timestamp: 123 }), {
    id: "retry-1",
    role: "log",
    title: "自动重试",
    text: "timeout\nPi 正在自动重试（第 1/3 次）…",
    timestamp: 123,
    isStreaming: false,
  });

  assert.equal(buildRetryStartedMessage({ id: "retry-2", timestamp: 124 }).text, "Provider request failed\nPi 正在自动重试…");
});

test("buildRetryFinalErrorMessage preserves final retry error projection", () => {
  assert.deepEqual(buildRetryFinalErrorMessage({ id: "retry-1", finalError: "Retry cancelled", timestamp: 125 }), {
    id: "retry-1",
    role: "error",
    title: undefined,
    text: "Retry cancelled",
    timestamp: 125,
    isStreaming: false,
  });
});
