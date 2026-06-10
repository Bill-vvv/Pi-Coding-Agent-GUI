import type { ConversationContextUsage, ConversationToolDetails } from "@pi-gui/shared";

export type NormalizedMessageRole = "user" | "assistant";
export type NormalizedConversationRole = NormalizedMessageRole | "tool" | "error";

export type NormalizedMessage = {
  role: NormalizedMessageRole;
  id?: string;
  text: string;
  thinking?: string;
  timestamp: number;
  errorMessage?: string;
};

export type NormalizedSnapshotMessage = {
  role: NormalizedConversationRole;
  id: string;
  text: string;
  thinking?: string;
  title?: string;
  timestamp: number;
  isStreaming?: boolean;
  toolDetails?: ConversationToolDetails;
};

export type NormalizedTool = {
  key: string;
  name: string;
  text: string;
  timestamp: number;
  isError?: boolean;
  toolDetails?: ConversationToolDetails;
};

export type NormalizedConversationEvent =
  | { type: "busy.changed"; busy: boolean }
  | { type: "context.usage"; usage: ConversationContextUsage }
  | { type: "context.window"; contextWindow: number }
  | { type: "messages.snapshot"; messages: NormalizedSnapshotMessage[] }
  | { type: "message.started"; message: NormalizedMessage }
  | { type: "message.finished"; message: NormalizedMessage }
  | { type: "assistant.delta"; appendText?: string; appendThinking?: string; text?: string; thinking?: string; isStreaming?: boolean }
  | { type: "assistant.error"; reason: string; errorText: string }
  | { type: "retry.started"; attempt?: number; maxAttempts?: number; errorMessage?: string }
  | { type: "retry.finished"; attempt?: number; success?: boolean; finalError?: string }
  | { type: "tool.started"; tool: NormalizedTool }
  | { type: "tool.updated"; tool: NormalizedTool }
  | { type: "tool.finished"; tool: NormalizedTool };
