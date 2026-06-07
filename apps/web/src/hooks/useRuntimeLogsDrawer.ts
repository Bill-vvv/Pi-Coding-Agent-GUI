import { useCallback, useState, type Dispatch } from "react";
import type { GuiEvent, Runtime, ServerEvent } from "@pi-gui/shared";
import type { AppAction } from "../state/appReducer";
import type { GuiSocketSend } from "../types";

type RuntimeLogsState = {
  events: GuiEvent[];
  hasMore?: boolean;
  loading?: boolean;
};

type UseRuntimeLogsDrawerOptions = {
  runtimes: Runtime[];
  busyByRuntime: Record<string, boolean>;
  dispatch: Dispatch<AppAction>;
  send: GuiSocketSend;
};

export function useRuntimeLogsDrawer({ runtimes, busyByRuntime, dispatch, send }: UseRuntimeLogsDrawerOptions) {
  const [runtimeLogDrawerId, setRuntimeLogDrawerId] = useState<string | undefined>();
  const [runtimeLogsByRuntime, setRuntimeLogsByRuntime] = useState<Record<string, RuntimeLogsState>>({});

  const requestRuntimeLogs = useCallback((runtimeId: string) => {
    setRuntimeLogsByRuntime((current) => ({
      ...current,
      [runtimeId]: { ...(current[runtimeId] ?? { events: [] }), loading: true },
    }));
    const sent = send({ type: "runtime.logs", runtimeId, limit: 200 }, { notifyOnDisconnected: false });
    if (!sent) {
      setRuntimeLogsByRuntime((current) => ({
        ...current,
        [runtimeId]: { ...(current[runtimeId] ?? { events: [] }), loading: false },
      }));
    }
  }, [send]);

  const openRuntimeLogs = useCallback((runtimeId: string) => {
    setRuntimeLogDrawerId(runtimeId);
    requestRuntimeLogs(runtimeId);
  }, [requestRuntimeLogs]);

  const closeRuntimeLogs = useCallback(() => setRuntimeLogDrawerId(undefined), []);

  const copyRuntimeLogs = useCallback((text: string) => {
    if (!text.trim()) return;
    void navigator.clipboard.writeText(text).then(
      () => dispatch({ type: "set.notice", notice: "已复制 Runtime 日志" }),
      () => dispatch({ type: "set.operationError", error: "复制 Runtime 日志失败" }),
    );
  }, [dispatch]);

  function handleRuntimeLogsServerEvent(event: ServerEvent) {
    if (event.type !== "runtime.logs") return;
    setRuntimeLogsByRuntime((current) => ({
      ...current,
      [event.runtimeId]: { events: event.events, hasMore: event.hasMore, loading: false },
    }));
  }

  const runtimeLogDrawerRuntime = runtimeLogDrawerId ? runtimes.find((runtime) => runtime.id === runtimeLogDrawerId) : undefined;
  const runtimeLogDrawerState = runtimeLogDrawerId ? runtimeLogsByRuntime[runtimeLogDrawerId] : undefined;
  const runtimeLogDrawerBusy = runtimeLogDrawerId ? busyByRuntime[runtimeLogDrawerId] : false;

  return {
    runtimeLogDrawerId,
    runtimeLogDrawerRuntime,
    runtimeLogDrawerState,
    runtimeLogDrawerBusy,
    openRuntimeLogs,
    closeRuntimeLogs,
    requestRuntimeLogs,
    copyRuntimeLogs,
    handleRuntimeLogsServerEvent,
  };
}
