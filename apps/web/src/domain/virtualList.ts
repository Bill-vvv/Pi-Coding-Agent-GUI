export type VirtualRange = {
  startIndex: number;
  endIndex: number;
  beforeHeight: number;
  afterHeight: number;
};

export function estimateVirtualRange({
  itemCount,
  scrollTop,
  viewportHeight,
  itemHeights,
  estimatedItemHeight,
  overscan,
}: {
  itemCount: number;
  scrollTop: number;
  viewportHeight: number;
  itemHeights: Map<string, number> | number[];
  estimatedItemHeight: number;
  overscan: number;
}): VirtualRange {
  if (itemCount <= 0) return { startIndex: 0, endIndex: -1, beforeHeight: 0, afterHeight: 0 };
  const heights = Array.from({ length: itemCount }, (_value, index) => heightAt(itemHeights, index, estimatedItemHeight));
  const startThreshold = Math.max(0, scrollTop - estimatedItemHeight * overscan);
  const endThreshold = scrollTop + viewportHeight + estimatedItemHeight * overscan;

  let offset = 0;
  let startIndex = 0;
  for (; startIndex < itemCount; startIndex += 1) {
    if (offset + heights[startIndex]! >= startThreshold) break;
    offset += heights[startIndex]!;
  }

  let endIndex = startIndex;
  let visibleOffset = offset;
  for (; endIndex < itemCount; endIndex += 1) {
    visibleOffset += heights[endIndex]!;
    if (visibleOffset >= endThreshold) break;
  }

  const beforeHeight = sumHeights(heights, 0, startIndex);
  const renderedHeight = sumHeights(heights, startIndex, Math.min(itemCount, endIndex + 1));
  const totalHeight = sumHeights(heights, 0, itemCount);
  return {
    startIndex,
    endIndex: Math.min(itemCount - 1, endIndex),
    beforeHeight,
    afterHeight: Math.max(0, totalHeight - beforeHeight - renderedHeight),
  };
}

export function prependScrollTop(previousScrollTop: number, previousScrollHeight: number, nextScrollHeight: number): number {
  return Math.max(0, previousScrollTop + (nextScrollHeight - previousScrollHeight));
}

function heightAt(itemHeights: Map<string, number> | number[], index: number, fallback: number): number {
  if (Array.isArray(itemHeights)) return positiveNumber(itemHeights[index]) ?? fallback;
  return positiveNumber(itemHeights.get(String(index))) ?? fallback;
}

function positiveNumber(value: unknown): number | undefined {
  return typeof value === "number" && Number.isFinite(value) && value > 0 ? value : undefined;
}

function sumHeights(heights: number[], start: number, end: number): number {
  let total = 0;
  for (let index = start; index < end; index += 1) total += heights[index] ?? 0;
  return total;
}
