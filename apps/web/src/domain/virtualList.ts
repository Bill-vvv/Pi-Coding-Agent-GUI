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
  const prefixHeights = getPrefixHeights(itemHeights, itemCount, estimatedItemHeight);
  const totalHeight = prefixHeights[itemCount] ?? 0;
  const startThreshold = Math.max(0, scrollTop - estimatedItemHeight * overscan);
  const endThreshold = scrollTop + viewportHeight + estimatedItemHeight * overscan;

  const startPrefixIndex = lowerBound(prefixHeights, startThreshold, 1, itemCount);
  const startIndex = Math.max(0, Math.min(itemCount - 1, startPrefixIndex - 1));
  const endPrefixIndex = lowerBound(prefixHeights, endThreshold, startIndex + 1, itemCount);
  const endIndex = Math.max(startIndex, Math.min(itemCount - 1, endPrefixIndex - 1));
  const beforeHeight = prefixHeights[startIndex] ?? 0;
  const renderedHeight = (prefixHeights[Math.min(itemCount, endIndex + 1)] ?? totalHeight) - beforeHeight;

  return {
    startIndex,
    endIndex,
    beforeHeight,
    afterHeight: Math.max(0, totalHeight - beforeHeight - renderedHeight),
  };
}

export function virtualHeightBefore({
  itemHeights,
  itemCount,
  index,
  estimatedItemHeight,
}: {
  itemHeights: Map<string, number> | number[];
  itemCount: number;
  index: number;
  estimatedItemHeight: number;
}): number {
  if (itemCount <= 0 || index <= 0) return 0;
  const prefixHeights = getPrefixHeights(itemHeights, itemCount, estimatedItemHeight);
  return prefixHeights[Math.min(itemCount, index)] ?? 0;
}

export function prependScrollTop(previousScrollTop: number, previousScrollHeight: number, nextScrollHeight: number): number {
  return Math.max(0, previousScrollTop + (nextScrollHeight - previousScrollHeight));
}

type PrefixHeightCache = {
  itemCount: number;
  fallback: number;
  prefixHeights: number[];
};

const prefixHeightCacheByArray = new WeakMap<number[], PrefixHeightCache>();

function getPrefixHeights(itemHeights: Map<string, number> | number[], itemCount: number, fallback: number): number[] {
  if (Array.isArray(itemHeights)) {
    const cached = prefixHeightCacheByArray.get(itemHeights);
    if (cached && cached.itemCount === itemCount && cached.fallback === fallback) return cached.prefixHeights;
    const prefixHeights = buildPrefixHeights(itemHeights, itemCount, fallback);
    prefixHeightCacheByArray.set(itemHeights, { itemCount, fallback, prefixHeights });
    return prefixHeights;
  }

  return buildPrefixHeights(itemHeights, itemCount, fallback);
}

function buildPrefixHeights(itemHeights: Map<string, number> | number[], itemCount: number, fallback: number): number[] {
  const prefixHeights = new Array<number>(itemCount + 1);
  prefixHeights[0] = 0;
  for (let index = 0; index < itemCount; index += 1) prefixHeights[index + 1] = (prefixHeights[index] ?? 0) + heightAt(itemHeights, index, fallback);
  return prefixHeights;
}

function heightAt(itemHeights: Map<string, number> | number[], index: number, fallback: number): number {
  if (Array.isArray(itemHeights)) return positiveNumber(itemHeights[index]) ?? fallback;
  return positiveNumber(itemHeights.get(String(index))) ?? fallback;
}

function positiveNumber(value: unknown): number | undefined {
  return typeof value === "number" && Number.isFinite(value) && value > 0 ? value : undefined;
}

function lowerBound(values: number[], target: number, start: number, end: number): number {
  let low = start;
  let high = end;
  while (low < high) {
    const middle = Math.floor((low + high) / 2);
    if ((values[middle] ?? 0) >= target) high = middle;
    else low = middle + 1;
  }
  return low;
}
