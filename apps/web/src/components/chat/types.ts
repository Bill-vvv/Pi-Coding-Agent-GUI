import type { SubagentRun } from "@pi-gui/shared";

export type ConversationBlockActions = {
  onOpenSubagentRun?: (runId: string) => void;
  onCopySubagentOutput?: (run: SubagentRun) => void;
};
