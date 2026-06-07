import type { ConversationMessage } from "@pi-gui/shared";

export type RetryProjectedMessage = Omit<ConversationMessage, "runtimeId" | "projectId" | "updatedAt">;

export function formatRetryAttempt(attempt: number | undefined, maxAttempts: number | undefined): string {
  if (attempt === undefined) return "";
  return maxAttempts === undefined ? `（第 ${attempt} 次）` : `（第 ${attempt}/${maxAttempts} 次）`;
}

export function buildRetryStartedMessage(input: {
  id: string;
  attempt?: number;
  maxAttempts?: number;
  errorMessage?: string;
  timestamp: number;
}): RetryProjectedMessage {
  const attemptText = formatRetryAttempt(input.attempt, input.maxAttempts);
  return {
    id: input.id,
    role: "log",
    title: "自动重试",
    text: `${input.errorMessage || "Provider request failed"}\nPi 正在自动重试${attemptText}…`,
    timestamp: input.timestamp,
    isStreaming: false,
  };
}

export function buildRetryFinalErrorMessage(input: { id: string; finalError: string; timestamp: number }): RetryProjectedMessage {
  return {
    id: input.id,
    role: "error",
    title: undefined,
    text: input.finalError,
    timestamp: input.timestamp,
    isStreaming: false,
  };
}
