import assert from "node:assert/strict";
import test from "node:test";
import { replayGapEventForReconnect } from "../src/runtime/eventReplay.js";

test("replayGapEventForReconnect returns undefined for complete replay windows", () => {
  assert.equal(
    replayGapEventForReconnect({
      requestedSinceEventId: 10,
      firstEventId: 1,
      lastEventId: 12,
      replayedEventCount: 2,
      lastReplayedEventId: 12,
      replayLimit: 1000,
    }),
    undefined,
  );
});

test("replayGapEventForReconnect reports pruned replay gaps", () => {
  assert.deepEqual(
    replayGapEventForReconnect({
      requestedSinceEventId: 10,
      firstEventId: 15,
      lastEventId: 30,
      replayedEventCount: 16,
      lastReplayedEventId: 30,
      replayLimit: 1000,
    }),
    {
      type: "event.replay.gap",
      requestedSinceEventId: 10,
      firstAvailableEventId: 15,
      lastEventId: 30,
      replayedEvents: 16,
      reason: "pruned",
    },
  );
});

test("replayGapEventForReconnect reports truncated replay gaps", () => {
  assert.deepEqual(
    replayGapEventForReconnect({
      requestedSinceEventId: 10,
      firstEventId: 1,
      lastEventId: 1200,
      replayedEventCount: 1000,
      lastReplayedEventId: 1010,
      replayLimit: 1000,
    }),
    {
      type: "event.replay.gap",
      requestedSinceEventId: 10,
      firstAvailableEventId: 1,
      lastEventId: 1200,
      replayedEvents: 1000,
      reason: "truncated",
    },
  );
});

test("replayGapEventForReconnect reports stale cursors beyond the current log", () => {
  assert.deepEqual(
    replayGapEventForReconnect({
      requestedSinceEventId: 500,
      firstEventId: 1,
      lastEventId: 30,
      replayedEventCount: 0,
      replayLimit: 1000,
    }),
    {
      type: "event.replay.gap",
      requestedSinceEventId: 500,
      firstAvailableEventId: 1,
      lastEventId: 30,
      replayedEvents: 0,
      reason: "stale_cursor",
    },
  );
});
