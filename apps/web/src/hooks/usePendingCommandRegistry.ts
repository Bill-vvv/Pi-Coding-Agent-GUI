import { useCallback, useEffect, useMemo, useReducer } from "react";
import type { ClientCommand, ServerEvent } from "@pi-gui/shared";
import {
  DEFAULT_PENDING_COMMAND_TIMEOUT_MS,
  pendingCommandRegistryReducer,
  summarizePendingCommands,
  type PendingCommandEntry,
} from "../domain/pendingCommands";
import { createRequestId } from "../domain/requestId";
import type { ConnectionState, GuiSocketSend } from "../types";

export function usePendingCommandRegistry({
  connection,
  send,
  timeoutMs = DEFAULT_PENDING_COMMAND_TIMEOUT_MS,
}: {
  connection: ConnectionState;
  send: GuiSocketSend;
  timeoutMs?: number;
}) {
  const [entries, dispatch] = useReducer(pendingCommandRegistryReducer, [] as PendingCommandEntry[]);

  const sendWithRegistry = useCallback<GuiSocketSend>((command, options) => {
    const commandWithRequestId = { ...command, requestId: command.requestId ?? createRequestId() } as ClientCommand & { requestId: string };
    if (!send(commandWithRequestId, options)) return false;
    dispatch({ type: "record", command: commandWithRequestId, now: Date.now(), timeoutMs });
    return true;
  }, [send, timeoutMs]);

  const handlePendingCommandServerEvent = useCallback((event: ServerEvent) => {
    if (event.type !== "command.result") return;
    dispatch({ type: "result", result: event, now: Date.now() });
  }, []);

  useEffect(() => {
    const timer = window.setInterval(() => {
      const now = Date.now();
      dispatch({ type: "timeout", now });
      dispatch({ type: "prune", now });
    }, PENDING_COMMAND_SWEEP_MS);
    return () => window.clearInterval(timer);
  }, []);

  useEffect(() => {
    if (connection !== "closed" && connection !== "reconnecting" && connection !== "unauthorized") return;
    dispatch({ type: "disconnect", now: Date.now() });
  }, [connection]);

  const summary = useMemo(() => summarizePendingCommands(entries), [entries]);

  return {
    send: sendWithRegistry,
    pendingCommands: entries,
    pendingCommandSummary: summary,
    handlePendingCommandServerEvent,
  };
}

const PENDING_COMMAND_SWEEP_MS = 1000;
