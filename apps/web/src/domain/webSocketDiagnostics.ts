import type { WebSocketCloseDiagnostic } from "../types";

export type WebSocketCloseClue = {
  severity: "warning" | "error";
  label: string;
  detail: string;
};

const SENSITIVE_QUERY_KEYS = ["token", "authtoken", "access_token", "authorization", "auth"];

export function sanitizeWebSocketUrlForDiagnostics(rawUrl: string): string {
  try {
    const url = new URL(rawUrl, "http://pi-gui.local");
    url.username = "";
    url.password = "";
    url.hash = "";
    for (const key of [...url.searchParams.keys()]) {
      const normalized = key.toLowerCase().replace(/[-_]/g, "");
      if (SENSITIVE_QUERY_KEYS.includes(key.toLowerCase()) || SENSITIVE_QUERY_KEYS.includes(normalized) || normalized.includes("token")) {
        url.searchParams.delete(key);
      }
    }
    if (rawUrl.startsWith("/")) return `${url.pathname}${url.search}${url.hash}`;
    return url.toString();
  } catch {
    return rawUrl.replace(/([?&][^=&#]*(?:token|authorization|auth)[^=&#]*=)[^&#]*/gi, "$1<redacted>");
  }
}

export function webSocketCloseClue(close?: WebSocketCloseDiagnostic): WebSocketCloseClue | undefined {
  if (!close) return undefined;
  const reason = close.reason.toLowerCase();
  if (close.code === 1008 || reason === "unauthorized") {
    return {
      severity: "error",
      label: "认证失败",
      detail: "服务端拒绝了 WebSocket 连接；检查桌面注入/远程访问令牌。",
    };
  }
  if (close.code === 1013 || /backpressure|slow|buffer|stale|ping failed|send failed/.test(reason)) {
    return {
      severity: "warning",
      label: "可能是慢客户端/背压断开",
      detail: close.reason ? `服务端 close reason: ${close.reason}` : "浏览器收到 1013/服务端过载类关闭码。",
    };
  }
  if (!close.wasClean || close.code === 1006) {
    return {
      severity: "warning",
      label: "异常断开",
      detail: "可能是后端重启、网络中断、代理超时或服务端直接终止连接。",
    };
  }
  return undefined;
}
