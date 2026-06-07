import type { ConversationMessage, GuiSession, Runtime, RuntimeConversationSummary } from "@pi-gui/shared";

export type RuntimeConversationVisibilityInput = {
  runtime: Runtime;
  session?: GuiSession;
  summary?: RuntimeConversationSummary;
  messages?: ConversationMessage[];
};

export function runtimeHasVisibleConversationContent(input: RuntimeConversationVisibilityInput): boolean {
  const { session, summary, messages } = input;
  if ((messages?.length ?? 0) > 0) return true;
  if ((summary?.messageCount ?? 0) > 0) return true;
  if (Boolean(summary?.title || summary?.detail)) return true;
  if (Boolean(session?.title)) return true;
  return false;
}
