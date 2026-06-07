export type DropPosition = "before" | "after";

export function normalizeProjectOrder(currentOrder: string[], projectIds: string[]): string[] {
  return normalizeOrderedIds(currentOrder, projectIds);
}

export function normalizeSessionOrderByProject(
  current: Record<string, string[]>,
  projectIds: string[],
  runtimeIdsByProject: Map<string, string[]>,
): Record<string, string[]> {
  const projectIdSet = new Set(projectIds);
  const currentKeys = Object.keys(current);
  const next: Record<string, string[]> = {};
  let changed = currentKeys.length !== projectIds.length || currentKeys.some((projectId) => !projectIdSet.has(projectId));

  for (const projectId of projectIds) {
    const normalized = normalizeOrderedIds(current[projectId] ?? [], runtimeIdsByProject.get(projectId) ?? []);
    next[projectId] = normalized;
    if (!arraysEqual(normalized, current[projectId] ?? [])) changed = true;
  }

  return changed ? next : current;
}

export function orderedById<T extends { id: string }>(items: T[], order: string[]): T[] {
  if (order.length === 0) return items;

  const itemById = new Map(items.map((item) => [item.id, item]));
  const ordered = order.flatMap((id) => {
    const item = itemById.get(id);
    return item ? [item] : [];
  });
  const orderedIds = new Set(ordered.map((item) => item.id));
  return [...ordered, ...items.filter((item) => !orderedIds.has(item.id))];
}

export function moveOrderedId(currentOrder: string[], allIds: string[], draggedId: string, targetId: string, position: DropPosition): string[] {
  const baseOrder = normalizeOrderedIds(currentOrder, allIds);
  if (!baseOrder.includes(draggedId) || !baseOrder.includes(targetId) || draggedId === targetId) return currentOrder;

  const withoutDragged = baseOrder.filter((id) => id !== draggedId);
  const targetIndex = withoutDragged.indexOf(targetId);
  if (targetIndex === -1) return currentOrder;

  const nextOrder = [...withoutDragged];
  nextOrder.splice(targetIndex + (position === "after" ? 1 : 0), 0, draggedId);
  return arraysEqual(nextOrder, currentOrder) ? currentOrder : nextOrder;
}

export function arraysEqual(left: string[], right: string[]): boolean {
  return left.length === right.length && left.every((value, index) => value === right[index]);
}

function normalizeOrderedIds(currentOrder: string[], allIds: string[]): string[] {
  const allIdSet = new Set(allIds);
  const existing = currentOrder.filter((id) => allIdSet.has(id));
  const existingSet = new Set(existing);
  return [...existing, ...allIds.filter((id) => !existingSet.has(id))];
}
