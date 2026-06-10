import { useState } from "react";
import type { ResponseMode, ServerEvent, ThinkingLevel } from "@pi-gui/shared";
import type { GuiSocketSend } from "../types";

type UseSessionRestoreActionsOptions = {
  defaultRuntimeModelKey: () => string | undefined;
  defaultThinkingLevel: ThinkingLevel;
  defaultResponseMode: ResponseMode;
  send: GuiSocketSend;
  onRestoredRuntime?: (runtimeId: string) => void;
};

export function useSessionRestoreActions({
  defaultRuntimeModelKey,
  defaultThinkingLevel,
  defaultResponseMode,
  send,
  onRestoredRuntime,
}: UseSessionRestoreActionsOptions) {
  const [sessionHistoryProjectId, setSessionHistoryProjectId] = useState<string | undefined>();
  const [pendingHistoryRestoreId, setPendingHistoryRestoreId] = useState<string | undefined>();

  function openSessionHistory(projectId: string) {
    setSessionHistoryProjectId(projectId);
    send({ type: "session.list", projectId });
  }

  function closeSessionHistory() {
    setSessionHistoryProjectId(undefined);
    setPendingHistoryRestoreId(undefined);
  }

  function resumeSessionFromHistory(sessionId: string) {
    setPendingHistoryRestoreId(sessionId);
    const sent = send({
      type: "session.resume",
      sessionId,
      model: defaultRuntimeModelKey(),
      thinkingLevel: defaultThinkingLevel,
      responseMode: defaultResponseMode,
    });
    if (!sent) setPendingHistoryRestoreId(undefined);
  }

  function handleSessionRestoreServerEvent(event: ServerEvent) {
    if (event.type !== "command.result" || event.command !== "session.resume") return;
    setPendingHistoryRestoreId(undefined);
    if (!event.success) return;
    setSessionHistoryProjectId(undefined);
    const runtimeId = restoredRuntimeId(event.data);
    if (runtimeId) onRestoredRuntime?.(runtimeId);
  }

  return {
    sessionHistoryProjectId,
    pendingHistoryRestoreId,
    openSessionHistory,
    closeSessionHistory,
    resumeSessionFromHistory,
    handleSessionRestoreServerEvent,
  };
}

function restoredRuntimeId(data: unknown): string | undefined {
  if (!isRecord(data) || !isRecord(data.runtime)) return undefined;
  return typeof data.runtime.id === "string" ? data.runtime.id : undefined;
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null;
}
