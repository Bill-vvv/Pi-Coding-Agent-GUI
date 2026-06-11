type DeferredMarkdownTaskHandle = {
  cancel: () => void;
};

type DeferredMarkdownTaskOptions = {
  timeoutMs?: number;
};

type IdleDeadlineLike = {
  didTimeout: boolean;
  timeRemaining: () => number;
};

type RequestIdleCallbackLike = (callback: (deadline: IdleDeadlineLike) => void, options?: { timeout: number }) => number;
type CancelIdleCallbackLike = (handle: number) => void;

export function scheduleDeferredMarkdownTask(task: () => void, options: DeferredMarkdownTaskOptions = {}): DeferredMarkdownTaskHandle {
  const timeoutMs = options.timeoutMs ?? 64;
  const requestIdle = (globalThis as { requestIdleCallback?: RequestIdleCallbackLike }).requestIdleCallback;
  const cancelIdle = (globalThis as { cancelIdleCallback?: CancelIdleCallbackLike }).cancelIdleCallback;

  if (typeof requestIdle === "function") {
    const handle = requestIdle(() => task(), { timeout: timeoutMs });
    return { cancel: () => cancelIdle?.(handle) };
  }

  const handle = globalThis.setTimeout(task, timeoutMs);
  return { cancel: () => globalThis.clearTimeout(handle) };
}

export function markdownEnhancementCacheKey(language: string | undefined, content: string): string {
  return `${language?.toLowerCase() ?? "plain"}:${content}`;
}
