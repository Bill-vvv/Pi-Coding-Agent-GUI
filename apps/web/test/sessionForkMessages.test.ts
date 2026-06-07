import assert from "node:assert/strict";
import test from "node:test";
import { normalizeSessionForkMessages, sessionForkMessagePreview } from "../src/domain/sessionForkMessages";

test("normalizeSessionForkMessages keeps valid fork messages only", () => {
  assert.deepEqual(normalizeSessionForkMessages({ messages: [{ entryId: " a ", text: "hello" }, { entryId: "", text: "skip" }, { entryId: "b", text: 1 }] }), [
    { entryId: "a", text: "hello" },
  ]);
  assert.deepEqual(normalizeSessionForkMessages({ messages: "bad" }), []);
});

test("sessionForkMessagePreview compacts whitespace and truncates", () => {
  assert.equal(sessionForkMessagePreview("hello\n world"), "hello world");
  assert.equal(sessionForkMessagePreview("abcdef", 4), "abc…");
  assert.equal(sessionForkMessagePreview("   "), "（空消息）");
});
