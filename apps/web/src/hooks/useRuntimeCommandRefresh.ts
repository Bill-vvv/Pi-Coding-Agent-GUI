import { useEffect } from "react";
import type { Runtime } from "@pi-gui/shared";
import { isConnectionReady } from "../domain/connection";
import type { ConnectionState, GuiSocketSend } from "../types";

export function useRuntimeCommandRefresh({
  connection,
  activeRuntime,
  send,
}: {
  connection: ConnectionState;
  activeRuntime?: Runtime;
  send: GuiSocketSend;
}): void {
  useEffect(() => {
    if (!isConnectionReady(connection) || activeRuntime?.status !== "running") return;
    send({ type: "runtime.commands.list", runtimeId: activeRuntime.id }, { notifyOnDisconnected: false });
  }, [activeRuntime?.id, activeRuntime?.status, connection, send]);
}
