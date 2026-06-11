import type { ClientCommand } from "@pi-gui/shared";
import type { ConversationDisplayMode } from "./domain/conversationDisplay";
import type { GuiKeybindingMap } from "./domain/keybindings";
import type { GuiScopedModelsPreference } from "./domain/scopedModels";

export type { ConversationContextUsage, ConversationMessage } from "@pi-gui/shared";

export type ConnectionState = "connecting" | "open" | "closed";

export type GuiSocketSendOptions = {
  notifyOnDisconnected?: boolean;
};

export type GuiSocketSend = (command: ClientCommand, options?: GuiSocketSendOptions) => boolean;

export type PendingPrompt = { projectId: string; message: string; requestId: string; waitForConversationSnapshot?: boolean; runtimeId?: string };
export type PendingProjectStart = { cwd: string; message?: string; requestId: string };

export type UiFontSize = "small" | "medium" | "large";
export type ChatFontSize = "small" | "medium" | "large";
export type ThemeMode = "dark" | "light" | "system";
export type AccentColor = "amber" | "blue" | "green" | "rose";
export type ThinkingToolDisplayMode = ConversationDisplayMode;
export type UiPreferences = {
  uiFontSize: UiFontSize;
  chatFontSize: ChatFontSize;
  theme: ThemeMode;
  accentColor: AccentColor;
  thinkingToolDisplayMode: ThinkingToolDisplayMode;
  desktopNotificationsEnabled: boolean;
  desktopPetEnabled: boolean;
  guiScopedModels: GuiScopedModelsPreference;
  keybindings: GuiKeybindingMap;
};
