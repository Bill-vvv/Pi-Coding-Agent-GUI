import type { GuiEvent } from "../domain.js";

// Replay events own durable event cursor semantics and recovery gaps. Snapshot
// bootstrap and command lifecycle events intentionally live in sibling modules.
export type ReplayCompleteEvent = { type: "replay.complete"; connectionId: string; serverTime: number; lastEventId: number; replayedEvents: number };

export type EventReplayGapEvent = {
  type: "event.replay.gap";
  requestedSinceEventId: number;
  firstAvailableEventId?: number;
  lastEventId: number;
  replayedEvents: number;
  reason: "pruned" | "truncated" | "stale_cursor";
};

export type GuiEventEnvelopeEvent = { type: "gui.event"; event: GuiEvent };

export type ReplayServerEvent = ReplayCompleteEvent | EventReplayGapEvent | GuiEventEnvelopeEvent;
