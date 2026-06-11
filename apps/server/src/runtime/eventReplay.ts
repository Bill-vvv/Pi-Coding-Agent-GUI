import type { ServerEvent } from "@pi-gui/shared";

export const RECONNECT_REPLAY_LIMIT = 1000;

export type ReplayGapEvent = Extract<ServerEvent, { type: "event.replay.gap" }>;

export function replayGapEventForReconnect(options: {
  requestedSinceEventId: number;
  firstEventId: number;
  lastEventId: number;
  replayedEventCount: number;
  lastReplayedEventId?: number;
  replayLimit?: number;
  truncated?: boolean;
}): ReplayGapEvent | undefined {
  const replayLimit = options.replayLimit ?? RECONNECT_REPLAY_LIMIT;
  if (options.requestedSinceEventId > options.lastEventId) {
    return {
      type: "event.replay.gap",
      requestedSinceEventId: options.requestedSinceEventId,
      firstAvailableEventId: options.firstEventId || undefined,
      lastEventId: options.lastEventId,
      replayedEvents: options.replayedEventCount,
      reason: "stale_cursor",
    };
  }

  if (options.firstEventId > 0 && options.requestedSinceEventId + 1 < options.firstEventId) {
    return {
      type: "event.replay.gap",
      requestedSinceEventId: options.requestedSinceEventId,
      firstAvailableEventId: options.firstEventId,
      lastEventId: options.lastEventId,
      replayedEvents: options.replayedEventCount,
      reason: "pruned",
    };
  }

  if (
    (options.truncated || options.replayedEventCount >= replayLimit) &&
    options.lastReplayedEventId !== undefined &&
    options.lastReplayedEventId < options.lastEventId
  ) {
    return {
      type: "event.replay.gap",
      requestedSinceEventId: options.requestedSinceEventId,
      firstAvailableEventId: options.firstEventId || undefined,
      lastEventId: options.lastEventId,
      replayedEvents: options.replayedEventCount,
      reason: "truncated",
    };
  }

  return undefined;
}
