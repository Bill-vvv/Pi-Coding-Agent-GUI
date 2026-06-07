import assert from "node:assert/strict";
import test from "node:test";
import { adjacentRuntimeQueueItemKey, moveRuntimeQueueItem, runtimeQueueFromOrderItems, runtimeQueueOrderItems } from "../src/domain/runtimeQueueOrdering";

test("runtime queue order helpers reorder queued prompts within each queue kind", () => {
  const items = runtimeQueueOrderItems({ steering: ["first", "second", "third"], followUp: ["later", "last"] });

  const movedSteeringUp = moveRuntimeQueueItem(items, "steering:1", "steering:0");
  assert.deepEqual(runtimeQueueFromOrderItems(movedSteeringUp), { steering: ["second", "first", "third"], followUp: ["later", "last"] });

  const movedSteeringDown = moveRuntimeQueueItem(items, "steering:0", "steering:2");
  assert.deepEqual(runtimeQueueFromOrderItems(movedSteeringDown), { steering: ["second", "third", "first"], followUp: ["later", "last"] });

  const movedFollowUp = moveRuntimeQueueItem(movedSteeringDown, "followUp:1", "followUp:0");
  assert.deepEqual(runtimeQueueFromOrderItems(movedFollowUp), { steering: ["second", "third", "first"], followUp: ["last", "later"] });
});

test("runtime queue order helpers do not move prompts across queue kinds", () => {
  const items = runtimeQueueOrderItems({ steering: ["steer"], followUp: ["follow"] });

  assert.equal(moveRuntimeQueueItem(items, "steering:0", "followUp:0"), items);
  assert.equal(adjacentRuntimeQueueItemKey(items, "steering:0", -1), undefined);
  assert.equal(adjacentRuntimeQueueItemKey(items, "steering:0", 1), undefined);
});
