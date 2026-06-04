import { useCallback, useEffect, useRef, useState } from "react";
import type { ServerEvent } from "@pi-gui/shared";
import type { ConnectionState, GuiSocketSend } from "../types";

type UseGuiSocketOptions = {
  onEvent: (event: ServerEvent) => void;
  onError: (message: string) => void;
  onConnectionWarning?: (message: string) => void;
  onOpen?: () => void;
  onClose?: () => void;
};

export function useGuiSocket({ onEvent, onError, onConnectionWarning, onOpen, onClose }: UseGuiSocketOptions) {
  const wsRef = useRef<WebSocket | null>(null);
  const onEventRef = useRef(onEvent);
  const onErrorRef = useRef(onError);
  const onConnectionWarningRef = useRef(onConnectionWarning);
  const onOpenRef = useRef(onOpen);
  const onCloseRef = useRef(onClose);
  const lastGuiEventIdRef = useRef(0);
  const [connection, setConnection] = useState<ConnectionState>("connecting");
  const [connectionWarning, setConnectionWarning] = useState<string | undefined>();

  useEffect(() => {
    onEventRef.current = onEvent;
  }, [onEvent]);

  useEffect(() => {
    onErrorRef.current = onError;
  }, [onError]);

  useEffect(() => {
    onConnectionWarningRef.current = onConnectionWarning;
  }, [onConnectionWarning]);

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
      if (connectionWarningTimer !== undefined) {
        window.clearTimeout(connectionWarningTimer);
        connectionWarningTimer = undefined;
      }
      setConnectionWarning(undefined);
    };

    const scheduleConnectionWarning = () => {
      if (closedByEffect || connectionWarningTimer !== undefined) return;
      connectionWarningTimer = window.setTimeout(() => {
        connectionWarningTimer = undefined;
        if (!closedByEffect && wsRef.current?.readyState !== WebSocket.OPEN) {
          const warning = "WebSocket 连接中断，正在重连…";
          setConnectionWarning(warning);
          onConnectionWarningRef.current?.(warning);
        }
      }, CONNECTION_WARNING_GRACE_MS);
    };

    const connect = () => {
      setConnection("connecting");
      const ws = new WebSocket(wsUrl(lastGuiEventIdRef.current));
      wsRef.current = ws;
      const isCurrentSocket = () => wsRef.current === ws;

      ws.addEventListener("open", () => {
        if (!isCurrentSocket()) return;
        clearConnectionWarning();
        setConnection("open");
        onOpenRef.current?.();
      });

      ws.addEventListener("message", (message) => {
        if (!isCurrentSocket()) return;
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
        if (!isCurrentSocket()) return;
        wsRef.current = null;
        if (closedByEffect) return;
        onCloseRef.current?.();
        setConnection("closed");
        scheduleConnectionWarning();
        reconnectTimer = window.setTimeout(connect, RECONNECT_DELAY_MS);
      });

      ws.addEventListener("error", () => {
        if (!isCurrentSocket()) return;
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

  const send = useCallback<GuiSocketSend>((command, options) => {
    if (wsRef.current?.readyState !== WebSocket.OPEN) {
      if (options?.notifyOnDisconnected !== false) onErrorRef.current("WebSocket 未连接");
      return false;
    }
    wsRef.current.send(JSON.stringify({ requestId: crypto.randomUUID(), ...command }));
    return true;
  }, []);

  return { connection, send, connectionWarning };
}

const RECONNECT_DELAY_MS = 1500;
const CONNECTION_WARNING_GRACE_MS = 3000;

function wsUrl(sinceEventId = 0): string {
  const baseUrl = import.meta.env.VITE_WS_URL || `${window.location.protocol === "https:" ? "wss" : "ws"}://${window.location.host}/ws`;
  if (sinceEventId <= 0) return baseUrl;
  const separator = baseUrl.includes("?") ? "&" : "?";
  return `${baseUrl}${separator}sinceEventId=${sinceEventId}`;
}
