import { useState } from "react";
import type { ClientCommand, ResponseMode, ServerEvent, ThinkingLevel } from "@pi-gui/shared";

type UseSessionRestoreActionsOptions = {
  defaultRuntimeModelKey: () => string | undefined;
  defaultThinkingLevel: ThinkingLevel;
  defaultResponseMode: ResponseMode;
  send: (command: ClientCommand) => boolean;
};

export function useSessionRestoreActions({
  defaultRuntimeModelKey,
  defaultThinkingLevel,
  defaultResponseMode,
  send,
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
    if (event.success) setSessionHistoryProjectId(undefined);
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
