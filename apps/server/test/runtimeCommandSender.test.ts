import assert from "node:assert/strict";
import test from "node:test";
import type { RuntimeQueue } from "@pi-gui/shared";
import { dequeueQueuedPrompts, replaceQueuedPrompts } from "../src/runtime/runtimeCommandSender.js";
import type { ManagedRuntime } from "../src/runtime/managedRuntime.js";

function createManagedRuntime(currentQueue: RuntimeQueue) {
  const sent: Array<Record<string, unknown>> = [];
  const requests: Array<Record<string, unknown>> = [];
  const managed = {
    client: {
      request: async (command: Record<string, unknown>) => {
        requests.push(command);
        return { success: true, data: currentQueue };
      },
      send: (command: Record<string, unknown>) => sent.push(command),
    },
  } as unknown as ManagedRuntime;
  return { managed, sent, requests };
}

test("dequeueQueuedPrompts reports unsupported clear_queue without timing out", async () => {
  const { managed } = createManagedRuntime({ steering: [], followUp: [] });
  managed.client.request = async () => ({ type: "response", command: "clear_queue", success: false, error: "Unknown command: clear_queue" });

  await assert.rejects(
    () => dequeueQueuedPrompts(managed),
    /当前 Pi RPC 未暴露队列撤回\/排序接口（clear_queue）/,
  );
});

test("replaceQueuedPrompts clears and re-enqueues the requested queue order", async () => {
  const { managed, sent, requests } = createManagedRuntime({ steering: ["first", "second"], followUp: ["next", "later"] });

  await replaceQueuedPrompts(managed, { steering: ["second", "first"], followUp: ["later", "next"] }, "/tmp/project");

  assert.equal(requests.length, 1);
  assert.equal(requests[0]?.type, "clear_queue");
  assert.deepEqual(
    sent.map((command) => ({ type: command.type, message: command.message, streamingBehavior: command.streamingBehavior })),
    [
      { type: "prompt", message: "second", streamingBehavior: "steer" },
      { type: "prompt", message: "first", streamingBehavior: "steer" },
      { type: "prompt", message: "later", streamingBehavior: "followUp" },
      { type: "prompt", message: "next", streamingBehavior: "followUp" },
    ],
  );
});

test("replaceQueuedPrompts restores the current queue when the requested queue is stale", async () => {
  const { managed, sent } = createManagedRuntime({ steering: ["new", "first"], followUp: ["next"] });

  await assert.rejects(
    () => replaceQueuedPrompts(managed, { steering: ["first"], followUp: ["next"] }, "/tmp/project"),
    /队列已更新，请重试排序/,
  );

  assert.deepEqual(
    sent.map((command) => ({ message: command.message, streamingBehavior: command.streamingBehavior })),
    [
      { message: "new", streamingBehavior: "steer" },
      { message: "first", streamingBehavior: "steer" },
      { message: "next", streamingBehavior: "followUp" },
    ],
  );
});
