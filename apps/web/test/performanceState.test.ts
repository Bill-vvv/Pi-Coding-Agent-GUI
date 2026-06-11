import assert from "node:assert/strict";
import test from "node:test";
import type { ConversationMessage } from "@pi-gui/shared";
import { mergeConversationSummaries, mergeConversationSummariesCached } from "../src/domain/conversationSummary";
import { prependConversationPage, evictInactiveRuntimeMessages, rememberHydratedRuntime, applyConversationDeltas, upsertConversationMessage } from "../src/domain/conversationState";
import { performanceFixtureEvents, performanceFixtureMessages } from "../src/domain/performanceFixtures";
import { estimateVirtualRange, prependScrollTop } from "../src/domain/virtualList";

function message(id: string, runtimeId = "runtime-1", overrides: Partial<ConversationMessage> = {}): ConversationMessage {
  return { id, runtimeId, projectId: "project-1", role: "assistant", text: id, timestamp: 1, updatedAt: 1, ...overrides };
}

test("prependConversationPage merges older pages without duplicates", () => {
  const merged = prependConversationPage([message("b"), message("c")], [message("a"), message("b")]);
  assert.deepEqual(merged.map((item) => item.id), ["a", "b", "c"]);
});

test("inactive runtime MRU eviction keeps active and recent message bodies", () => {
  const messagesByRuntime = Object.fromEntries(Array.from({ length: 8 }, (_value, index) => [`runtime-${index + 1}`, [message(`m-${index + 1}`, `runtime-${index + 1}`)]]));
  const hydrated = ["runtime-1", "runtime-2", "runtime-3", "runtime-4", "runtime-5", "runtime-6"];
  const evicted = evictInactiveRuntimeMessages(messagesByRuntime, hydrated, "runtime-1");
  assert.deepEqual(Object.keys(evicted).sort(), ["runtime-1", "runtime-2", "runtime-3", "runtime-4", "runtime-5", "runtime-6"].sort());
  assert.equal(evicted["runtime-7"], undefined);
});

test("rememberHydratedRuntime moves runtimes to the MRU tail", () => {
  assert.deepEqual(rememberHydratedRuntime(["a", "b", "c"], "b", 3), ["a", "c", "b"]);
  assert.deepEqual(rememberHydratedRuntime(["a", "b", "c"], "d", 3), ["b", "c", "d"]);
});

test("applyConversationDeltas preserves append order", () => {
  const messages = applyConversationDeltas([], [
    { runtimeId: "runtime-1", projectId: "project-1", messageId: "assistant-1", timestamp: 1, appendText: "hello" },
    { runtimeId: "runtime-1", projectId: "project-1", messageId: "assistant-1", timestamp: 2, appendText: " world", appendThinking: "plan" },
  ]);
  assert.equal(messages[0]?.text, "hello world");
  assert.equal(messages[0]?.thinking, "plan");
});

test("upsertConversationMessage keeps newer local content when an older message payload arrives", () => {
  const current = [message("assistant-1", "runtime-1", { text: "hello world", thinking: "plan", updatedAt: 20, isStreaming: true })];
  const merged = upsertConversationMessage(current, message("assistant-1", "runtime-1", { text: "hello", updatedAt: 10, isStreaming: false }));

  assert.equal(merged[0]?.text, "hello world");
  assert.equal(merged[0]?.thinking, "plan");
  assert.equal(merged[0]?.isStreaming, true);
  assert.equal(merged[0]?.updatedAt, 20);
});

test("upsertConversationMessage keeps richer local content while allowing equal-timestamp terminal metadata", () => {
  const current = [message("assistant-1", "runtime-1", { text: "hello world", thinking: "plan more", updatedAt: 20, isStreaming: true })];
  const merged = upsertConversationMessage(current, message("assistant-1", "runtime-1", { text: "hello", thinking: "plan", updatedAt: 20, isStreaming: false }));

  assert.equal(merged[0]?.text, "hello world");
  assert.equal(merged[0]?.thinking, "plan more");
  assert.equal(merged[0]?.isStreaming, false);
  assert.equal(merged[0]?.updatedAt, 20);
});

test("applyConversationDeltas inserts unknown messages in chronological order", () => {
  const messages = applyConversationDeltas(
    [message("user-1", "runtime-1", { role: "user", timestamp: 1, updatedAt: 1 }), message("assistant-2", "runtime-1", { timestamp: 3, updatedAt: 3 })],
    [{ runtimeId: "runtime-1", projectId: "project-1", messageId: "assistant-1", timestamp: 2, appendText: "middle" }],
  );

  assert.deepEqual(messages.map((item) => item.id), ["user-1", "assistant-1", "assistant-2"]);
});

test("prependConversationPage returns a fresh array for duplicate-only pages", () => {
  const current = [message("b"), message("c")];
  const merged = prependConversationPage(current, [message("b")]);

  assert.deepEqual(merged.map((item) => item.id), ["b", "c"]);
  assert.notEqual(merged, current);
});

test("virtual range computes visible window and prepend scroll anchor", () => {
  const range = estimateVirtualRange({ itemCount: 100, scrollTop: 500, viewportHeight: 400, itemHeights: [], estimatedItemHeight: 100, overscan: 1 });
  assert.equal(range.startIndex <= 5, true);
  assert.equal(range.endIndex >= 9, true);
  assert.equal(prependScrollTop(200, 1000, 1400), 600);
});

test("cached conversation summaries match full summaries for tail updates", () => {
  const runtime = { id: "runtime-1", projectId: "project-1", cwd: "/tmp", status: "running" as const, startedAt: 1 };
  const messages = performanceFixtureMessages(runtime, 200, 1000);
  const initialMessagesByRuntime = { [runtime.id]: messages };
  const initial = mergeConversationSummariesCached({}, initialMessagesByRuntime);
  const last = messages[messages.length - 1]!;
  const updatedMessages = [...messages.slice(0, -1), { ...last, text: `${last.text} streamed`, updatedAt: 2000 }];
  const updatedMessagesByRuntime = { [runtime.id]: updatedMessages };
  const cached = mergeConversationSummariesCached({}, updatedMessagesByRuntime, initial).summaries;

  assert.deepEqual(cached, mergeConversationSummaries({}, updatedMessagesByRuntime));
});

test("performance fixture exposes long conversation and many runtime summaries", () => {
  const events = performanceFixtureEvents(1000);
  const hello = events.find((event) => event.type === "hello");
  const snapshot = events.find((event) => event.type === "conversation.snapshot");
  assert.equal(hello?.type, "hello");
  assert.equal(hello?.runtimes.length, 50);
  assert.equal(snapshot?.type, "conversation.snapshot");
  assert.equal(snapshot?.messages.length, 2000);
});
