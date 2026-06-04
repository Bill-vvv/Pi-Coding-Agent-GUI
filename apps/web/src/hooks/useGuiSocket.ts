import { useCallback, useEffect, useRef, useState } from "react";
import type { ClientCommand, ServerEvent } from "@pi-gui/shared";
import type { ConnectionState } from "../types";

type UseGuiSocketOptions = {
  onEvent: (event: ServerEvent) => void;
  onError: (message: string) => void;
  onOpen?: () => void;
  onClose?: () => void;
};

export function useGuiSocket({ onEvent, onError, onOpen, onClose }: UseGuiSocketOptions) {
  const wsRef = useRef<WebSocket | null>(null);
  const onEventRef = useRef(onEvent);
  const onErrorRef = useRef(onError);
  const onOpenRef = useRef(onOpen);
  const onCloseRef = useRef(onClose);
  const lastGuiEventIdRef = useRef(0);
  const [connection, setConnection] = useState<ConnectionState>("connecting");

  useEffect(() => {
    onEventRef.current = onEvent;
  }, [onEvent]);

  useEffect(() => {
    onErrorRef.current = onError;
  }, [onError]);

  useEffect(() => {
    onOpenRef.current = onOpen;
  }, [onOpen]);

  useEffect(() => {
    onCloseRef.current = onClose;
  }, [onClose]);

  useEffect(() => {
    let reconnectTimer: number | undefined;
    let connectionWarningTimer: number | undefined;
    let closedByEffect = false;

    const clearConnectionWarning = () => {
      if (connectionWarningTimer === undefined) return;
      window.clearTimeout(connectionWarningTimer);
      connectionWarningTimer = undefined;
    };

    const scheduleConnectionWarning = () => {
      if (closedByEffect || connectionWarningTimer !== undefined) return;
      connectionWarningTimer = window.setTimeout(() => {
        connectionWarningTimer = undefined;
        if (!closedByEffect && wsRef.current?.readyState !== WebSocket.OPEN) {
          onErrorRef.current("WebSocket 连接中断，正在重连…");
        }
      }, CONNECTION_WARNING_GRACE_MS);
    };

    const connect = () => {
      setConnection("connecting");
      const ws = new WebSocket(wsUrl(lastGuiEventIdRef.current));
      wsRef.current = ws;

      ws.addEventListener("open", () => {
        clearConnectionWarning();
        setConnection("open");
        onOpenRef.current?.();
      });

      ws.addEventListener("message", (message) => {
        try {
          const event = JSON.parse(message.data as string) as ServerEvent;
          if (event.type === "gui.event") {
            lastGuiEventIdRef.current = Math.max(lastGuiEventIdRef.current, event.event.id);
          }
          onEventRef.current(event);
        } catch (error) {
          onErrorRef.current((error as Error).message || "WebSocket 消息解析失败");
        }
      });

      ws.addEventListener("close", () => {
        if (wsRef.current === ws) wsRef.current = null;
        onCloseRef.current?.();
        setConnection("closed");
        scheduleConnectionWarning();
        if (!closedByEffect) reconnectTimer = window.setTimeout(connect, RECONNECT_DELAY_MS);
      });

      ws.addEventListener("error", () => {
        scheduleConnectionWarning();
      });
    };

    connect();

    return () => {
      closedByEffect = true;
      if (reconnectTimer) window.clearTimeout(reconnectTimer);
      clearConnectionWarning();
      wsRef.current?.close();
    };
  }, []);

  const send = useCallback((command: ClientCommand): boolean => {
    if (wsRef.current?.readyState !== WebSocket.OPEN) {
      onErrorRef.current("WebSocket 未连接");
      return false;
    }
    wsRef.current.send(JSON.stringify({ requestId: crypto.randomUUID(), ...command }));
    return true;
  }, []);

  return { connection, send };
}

const RECONNECT_DELAY_MS = 1500;
const CONNECTION_WARNING_GRACE_MS = 3000;

function wsUrl(sinceEventId = 0): string {
  const baseUrl = import.meta.env.VITE_WS_URL || `${window.location.protocol === "https:" ? "wss" : "ws"}://${window.location.host}/ws`;
  if (sinceEventId <= 0) return baseUrl;
  const separator = baseUrl.includes("?") ? "&" : "?";
  return `${baseUrl}${separator}sinceEventId=${sinceEventId}`;
}
