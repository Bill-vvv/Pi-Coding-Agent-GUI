import { useEffect, useRef, type Dispatch } from "react";
import type { Runtime } from "@pi-gui/shared";
import { isConnectionReady } from "../domain/connection";
import type { AppAction, ReplayRecoveryState } from "../state/appReducer";
import type { ConnectionState, GuiSocketSend } from "../types";

const ACTIVE_CONVERSATION_RESYNC_LIMIT = 500;
const SESSION_RESYNC_LIMIT = 200;

type UseReplayGapResyncOptions = {
  replayRecovery?: ReplayRecoveryState;
  connection: ConnectionState;
  activeRuntime?: Runtime;
  selectedProjectId?: string;
  send: GuiSocketSend;
  dispatch: Dispatch<AppAction>;
};

export function useReplayGapResync({
  replayRecovery,
  connection,
  activeRuntime,
  selectedProjectId,
  send,
  dispatch,
}: UseReplayGapResyncOptions): void {
  const requestedRecoveriesRef = useRef(new Set<number>());

  useEffect(() => {
    if (!replayRecovery || replayRecovery.status !== "degraded") return;
    if (!isConnectionReady(connection)) return;
    if (requestedRecoveriesRef.current.has(replayRecovery.detectedAt)) return;

    requestedRecoveriesRef.current.add(replayRecovery.detectedAt);
    dispatch({ type: "replayRecovery.resyncRequested", sequence: replayRecovery.sequence });

    if (activeRuntime) {
      send({ type: "conversation.open", runtimeId: activeRuntime.id, limit: ACTIVE_CONVERSATION_RESYNC_LIMIT }, { notifyOnDisconnected: false });
      if (activeRuntime.status === "running") {
        send({ type: "runtime.commands.list", runtimeId: activeRuntime.id }, { notifyOnDisconnected: false });
      }
    }

    send({ type: "session.list", projectId: selectedProjectId, limit: SESSION_RESYNC_LIMIT }, { notifyOnDisconnected: false });
  }, [activeRuntime?.id, activeRuntime?.status, connection, dispatch, replayRecovery, selectedProjectId, send]);
}
