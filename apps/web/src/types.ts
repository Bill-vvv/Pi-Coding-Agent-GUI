import type { ClientCommand, ServerEvent } from "@pi-gui/shared";
import type { ConversationDisplayMode } from "./domain/conversationDisplay";
import type { GuiKeybindingMap } from "./domain/keybindings";
import type { GuiScopedModelsPreference } from "./domain/scopedModels";

export type { ConversationContextUsage, ConversationMessage } from "@pi-gui/shared";

export type ConnectionState =
  | "connecting"
  | "reconnecting"
  | "connected_waiting_hello"
  | "bootstrapping"
  | "replaying"
  | "ready"
  | "degraded"
  | "closed"
  | "unauthorized";

export type WebSocketCloseDiagnostic = {
  code: number;
  reason: string;
  wasClean: boolean;
  at: number;
  reconnectAttempt: number;
};

export type WebSocketDiagnostics = {
  endpoint: string;
  authPresent: boolean;
  lastClose?: WebSocketCloseDiagnostic;
  reconnectAttempt: number;
  lastHelloAt?: number;
  lastReadyAt?: number;
  lastServerTime?: number;
  lastGuiEventId: number;
  lastConnectionId?: string;
  lastReplayGap?: Extract<ServerEvent, { type: "event.replay.gap" }>;
};

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
