export function isTransportConnectionError(message?: string): boolean {
  return message === "WebSocket 未连接" || message === "WebSocket 连接错误";
}
