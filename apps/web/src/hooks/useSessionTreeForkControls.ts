import { useState } from "react";
import type { Runtime, ServerEvent } from "@pi-gui/shared";
import { normalizeSessionForkMessages, type SessionForkMessage } from "../domain/sessionForkMessages";
import type { GuiSocketSend } from "../types";

export type SessionTreeForkMode = "fork" | "tree";

export type SessionTreeForkState = {
  open: boolean;
  mode: SessionTreeForkMode;
  targetRuntimeId?: string;
  loading: boolean;
  messages: SessionForkMessage[];
  error?: string;
  notice?: string;
};

type UseSessionTreeForkControlsOptions = {
  activeRuntime?: Runtime;
  runtimes: Runtime[];
  send: GuiSocketSend;
};

export function useSessionTreeForkControls({ activeRuntime, runtimes, send }: UseSessionTreeForkControlsOptions) {
  const [state, setState] = useState<SessionTreeForkState>({ open: false, mode: "fork", loading: false, messages: [] });

  function openSessionTreeForkControls(mode: SessionTreeForkMode = "fork") {
    const targetRuntimeId = activeRuntime?.id;
    setState({ open: true, mode, targetRuntimeId, loading: true, messages: [], notice: mode === "tree" ? "当前 Pi RPC 尚未暴露完整 tree 导航；可先从历史用户消息创建 fork。" : undefined });
    if (!activeRuntime || activeRuntime.status !== "running" || activeRuntime.archivedAt) {
      setState({ open: true, mode, targetRuntimeId, loading: false, messages: [], error: "需要运行中的 Pi runtime 才能读取可 fork 消息。" });
      return;
    }
    const ok = send({ type: "runtime.rpc", runtimeId: activeRuntime.id, command: { type: "get_fork_messages" }, label: "/fork messages" }, { notifyOnDisconnected: true });
    if (!ok) setState({ open: true, mode, targetRuntimeId: activeRuntime.id, loading: false, messages: [], error: "WebSocket 未连接，无法读取可 fork 消息。" });
  }

  function closeSessionTreeForkControls() {
    setState((current) => ({ ...current, open: false, loading: false }));
  }

  function forkFromMessage(entryId: string): boolean {
    const targetRuntimeId = state.targetRuntimeId ?? activeRuntime?.id;
    const targetRuntime = targetRuntimeId ? runtimes.find((runtime) => runtime.id === targetRuntimeId) : undefined;
    if (!targetRuntime || targetRuntime.status !== "running" || targetRuntime.archivedAt) {
      setState((current) => ({ ...current, error: "需要打开面板时的 Pi runtime 仍在运行才能 fork。" }));
      return false;
    }
    const ok = send({ type: "runtime.rpc", runtimeId: targetRuntime.id, command: { type: "fork", entryId }, label: "/fork", displayMessage: `/fork ${entryId}` });
    if (ok) setState((current) => ({ ...current, targetRuntimeId: targetRuntime.id, loading: true, error: undefined, notice: "正在创建 fork…" }));
    else setState((current) => ({ ...current, error: "WebSocket 未连接，无法创建 fork。" }));
    return ok;
  }

  function handleSessionTreeForkServerEvent(event: ServerEvent) {
    if (event.type !== "runtime.rpc.response") return;
    if (event.command === "get_fork_messages") {
      setState((current) => {
        if (!current.open || current.targetRuntimeId !== event.runtimeId) return current;
        if (!event.success) return { ...current, loading: false, error: event.error ?? "读取可 fork 消息失败。" };
        return { ...current, loading: false, error: undefined, messages: normalizeSessionForkMessages(event.data) };
      });
      return;
    }

    if (event.command === "fork") {
      setState((current) => {
        if (!current.open || current.targetRuntimeId !== event.runtimeId) return current;
        if (!event.success) return { ...current, loading: false, error: event.error ?? "创建 fork 失败。" };
        return { ...current, open: false, loading: false, notice: undefined, error: undefined };
      });
    }
  }

  return {
    sessionTreeForkState: state,
    openSessionTreeForkControls,
    closeSessionTreeForkControls,
    forkFromMessage,
    handleSessionTreeForkServerEvent,
  };
}
