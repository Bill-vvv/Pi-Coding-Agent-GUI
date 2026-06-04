import { useState } from "react";
import type { Runtime, ServerEvent } from "@pi-gui/shared";
import type { GuiSocketSend } from "../types";

type UseCheckpointActionsOptions = {
  send: GuiSocketSend;
};

export function useCheckpointActions({ send }: UseCheckpointActionsOptions) {
  const [checkpointPanelProjectId, setCheckpointPanelProjectId] = useState<string | undefined>();
  const [checkpointPanelRuntimeId, setCheckpointPanelRuntimeId] = useState<string | undefined>();
  const [pendingCheckpointActionId, setPendingCheckpointActionId] = useState<string | undefined>();

  function openCheckpointPanel(projectId: string, runtimeId?: string) {
    setCheckpointPanelProjectId(projectId);
    setCheckpointPanelRuntimeId(runtimeId);
    refreshCheckpoints(projectId);
  }

  function closeCheckpointPanel() {
    setCheckpointPanelProjectId(undefined);
    setCheckpointPanelRuntimeId(undefined);
    setPendingCheckpointActionId(undefined);
  }

  function refreshCheckpoints(projectId?: string) {
    const targetProjectId = projectId ?? checkpointPanelProjectId;
    if (!targetProjectId) return false;
    return send({ type: "checkpoint.list", projectId: targetProjectId }, { notifyOnDisconnected: false });
  }

  function restoreCheckpoint(runtime: Runtime | undefined, checkpointId: string, restoreFiles: boolean) {
    if (!runtime) return false;
    const requestId = crypto.randomUUID();
    setPendingCheckpointActionId(checkpointId);
    const sent = send({ type: "checkpoint.restore", requestId, runtimeId: runtime.id, checkpointId, restoreFiles });
    if (!sent) setPendingCheckpointActionId(undefined);
    return sent;
  }

  function fastForward(runtime: Runtime | undefined, restoreFiles: boolean) {
    if (!runtime) return false;
    const requestId = crypto.randomUUID();
    setPendingCheckpointActionId("__fastforward__");
    const sent = send({ type: "checkpoint.fastForward", requestId, runtimeId: runtime.id, restoreFiles });
    if (!sent) setPendingCheckpointActionId(undefined);
    return sent;
  }

  function handleCheckpointServerEvent(event: ServerEvent) {
    if (event.type === "checkpoint.list") return;
    if (event.type !== "command.result") return;
    if (event.command !== "checkpoint.restore" && event.command !== "checkpoint.fastForward") return;
    setPendingCheckpointActionId(undefined);
    if (checkpointPanelProjectId) refreshCheckpoints(checkpointPanelProjectId);
  }

  return {
    checkpointPanelProjectId,
    checkpointPanelRuntimeId,
    pendingCheckpointActionId,
    openCheckpointPanel,
    closeCheckpointPanel,
    refreshCheckpoints,
    restoreCheckpoint,
    fastForward,
    handleCheckpointServerEvent,
  };
}
