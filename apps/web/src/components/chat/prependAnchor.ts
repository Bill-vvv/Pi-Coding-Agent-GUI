import { prependScrollTop } from "../../domain/virtualList";

export type PendingPrependAnchor = {
  runtimeId?: string;
  beforeMessageId?: string;
  scrollTop: number;
  scrollHeight: number;
  messageCount: number;
  pageSignal: number;
};

export function resolvedPrependAnchorScrollTop(
  anchor: PendingPrependAnchor,
  nextMessageCount: number,
  nextScrollHeight: number,
  nextFirstMessageId?: string,
): number | undefined {
  if (nextMessageCount <= anchor.messageCount) return undefined;
  if (!anchor.beforeMessageId || !nextFirstMessageId || nextFirstMessageId === anchor.beforeMessageId) return undefined;
  return prependScrollTop(anchor.scrollTop, anchor.scrollHeight, nextScrollHeight);
}
