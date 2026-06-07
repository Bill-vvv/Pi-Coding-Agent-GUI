import type { Runtime } from "@pi-gui/shared";

export type BlankRuntimeAutoArchiveInput = {
  runtime?: Runtime;
  messageCount: number;
  isBusy: boolean;
  hasLocalUserActivity: boolean;
  draftPrompt: string;
};

export function shouldAutoArchiveBlankRuntime(input: BlankRuntimeAutoArchiveInput): boolean {
  const { runtime, messageCount, isBusy, hasLocalUserActivity, draftPrompt } = input;
  if (!runtime) return false;
  if (runtime.archivedAt || runtime.sessionId) return false;
  if (runtime.status !== "running" && runtime.status !== "starting") return false;
  if (messageCount > 0 || isBusy || hasLocalUserActivity) return false;
  return !draftPrompt.trim();
}
