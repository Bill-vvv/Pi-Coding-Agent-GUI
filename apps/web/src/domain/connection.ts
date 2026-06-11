import type { ConnectionState } from "../types";

export function isConnectionReady(connection: ConnectionState): boolean {
  return connection === "ready";
}

export function isRecoveringConnection(connection: ConnectionState): boolean {
  return connection === "connected_waiting_hello" || connection === "bootstrapping" || connection === "replaying" || connection === "reconnecting";
}

export function connectionUnavailableMessage(connection: ConnectionState): string {
  if (connection === "unauthorized") return "WebSocket 认证失败，请检查连接令牌。";
  if (connection === "connected_waiting_hello" || connection === "bootstrapping") return "WebSocket 已连接，正在恢复状态…";
  if (connection === "replaying") return "WebSocket 正在回放离线事件…";
  if (connection === "degraded") return "连接已恢复，但正在重新同步状态…";
  if (connection === "reconnecting") return "WebSocket 连接中断，正在重连…";
  return "连接尚未就绪。";
}

export function isTransportConnectionError(message?: string): boolean {
  return message === "WebSocket 未连接" || message === "WebSocket 连接错误" || message === "WebSocket 认证失败";
}
