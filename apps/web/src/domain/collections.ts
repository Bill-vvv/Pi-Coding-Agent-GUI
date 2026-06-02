import type { GuiEvent } from "@pi-gui/shared";

const MAX_BUFFERED_EVENTS = 20_000;

export function upsertById<T extends { id: string }>(items: T[], item: T): T[] {
  const index = items.findIndex((candidate) => candidate.id === item.id);
  if (index === -1) return [item, ...items];
  const next = [...items];
  next[index] = item;
  return next;
}

export function appendEvent(events: GuiEvent[], event: GuiEvent): GuiEvent[] {
  if (events.some((existing) => existing.id === event.id)) return events;
  return [...events, event].slice(-MAX_BUFFERED_EVENTS);
}
