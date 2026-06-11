import assert from "node:assert/strict";
import test from "node:test";
import { resolvedPrependAnchorScrollTop, type PendingPrependAnchor } from "../src/components/chat/prependAnchor";

function anchor(overrides: Partial<PendingPrependAnchor> = {}): PendingPrependAnchor {
  return {
    scrollTop: 200,
    scrollHeight: 1000,
    messageCount: 10,
    pageSignal: 1,
    beforeMessageId: "message-10",
    ...overrides,
  };
}

test("resolvedPrependAnchorScrollTop restores scroll position when older messages are prepended", () => {
  assert.equal(resolvedPrependAnchorScrollTop(anchor(), 12, 1400, "message-8"), 600);
});

test("resolvedPrependAnchorScrollTop clears without scrolling when a page adds no messages", () => {
  assert.equal(resolvedPrependAnchorScrollTop(anchor(), 10, 1000, "message-10"), undefined);
  assert.equal(resolvedPrependAnchorScrollTop(anchor(), 10, 1400, "message-10"), undefined);
});

test("resolvedPrependAnchorScrollTop ignores unrelated tail growth while a page request is pending", () => {
  assert.equal(resolvedPrependAnchorScrollTop(anchor(), 11, 1200, "message-10"), undefined);
});
