export type { ConversationContextUsage, ConversationMessage } from "@pi-gui/shared";

export type ConnectionState = "connecting" | "open" | "closed";

export type DirectoryEntry = {
  name: string;
  path: string;
  type: "directory";
};

export type PendingPrompt = { projectId: string; message: string };
export type PendingProjectStart = { cwd: string; message?: string };
