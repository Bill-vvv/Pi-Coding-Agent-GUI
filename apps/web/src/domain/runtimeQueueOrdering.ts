import type { RuntimeQueue } from "@pi-gui/shared";

export type RuntimeQueueOrderKind = keyof RuntimeQueue;

export type RuntimeQueueOrderItem = {
  key: string;
  kind: RuntimeQueueOrderKind;
  text: string;
};

export function runtimeQueueOrderItems(queue: RuntimeQueue | undefined): RuntimeQueueOrderItem[] {
  if (!queue) return [];
  return [
    ...queue.steering.map((text, index) => ({ key: `steering:${index}`, kind: "steering" as const, text })),
    ...queue.followUp.map((text, index) => ({ key: `followUp:${index}`, kind: "followUp" as const, text })),
  ];
}

export function runtimeQueueFromOrderItems(items: RuntimeQueueOrderItem[]): RuntimeQueue {
  return {
    steering: items.filter((item) => item.kind === "steering").map((item) => item.text),
    followUp: items.filter((item) => item.kind === "followUp").map((item) => item.text),
  };
}

export function moveRuntimeQueueItem(items: RuntimeQueueOrderItem[], sourceKey: string, targetKey: string): RuntimeQueueOrderItem[] {
  if (sourceKey === targetKey) return items;
  const sourceIndex = items.findIndex((item) => item.key === sourceKey);
  const targetIndex = items.findIndex((item) => item.key === targetKey);
  if (sourceIndex < 0 || targetIndex < 0) return items;
  const source = items[sourceIndex];
  const target = items[targetIndex];
  if (source.kind !== target.kind) return items;

  const next = [...items];
  next.splice(sourceIndex, 1);
  next.splice(targetIndex, 0, source);
  return next;
}

export function adjacentRuntimeQueueItemKey(items: RuntimeQueueOrderItem[], sourceKey: string, direction: -1 | 1): string | undefined {
  const sameKindItems = items.filter((item) => item.kind === items.find((candidate) => candidate.key === sourceKey)?.kind);
  const sourceIndex = sameKindItems.findIndex((item) => item.key === sourceKey);
  if (sourceIndex < 0) return undefined;
  return sameKindItems[sourceIndex + direction]?.key;
}
