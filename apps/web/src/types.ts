import type { ClientCommand } from "@pi-gui/shared";

export type { ConversationContextUsage, ConversationMessage } from "@pi-gui/shared";

export type ConnectionState = "connecting" | "open" | "closed";

export type GuiSocketSendOptions = {
  notifyOnDisconnected?: boolean;
};

export type GuiSocketSend = (command: ClientCommand, options?: GuiSocketSendOptions) => boolean;

export type DirectoryEntry = {
  name: string;
  path: string;
  type: "directory";
};

export type PendingPrompt = { projectId: string; message: string; requestId: string };
export type PendingProjectStart = { cwd: string; message?: string; requestId: string };

export type UiFontSize = "small" | "medium" | "large";
export type ChatFontSize = "small" | "medium" | "large";
export type ThemeMode = "dark" | "system";
export type AccentColor = "amber" | "blue" | "green" | "rose";

export type UiPreferences = {
  uiFontSize: UiFontSize;
  chatFontSize: ChatFontSize;
  theme: ThemeMode;
  accentColor: AccentColor;
};
