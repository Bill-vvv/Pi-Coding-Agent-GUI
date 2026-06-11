import { useCallback, useEffect, useRef, useState } from "react";
import type { ServerEvent } from "@pi-gui/shared";
import { connectionUnavailableMessage } from "../domain/connection";
import { createRequestId } from "../domain/requestId";
import { authToken, piGuiRuntimeConfig } from "../domain/runtimeConfig";
import { sanitizeWebSocketUrlForDiagnostics } from "../domain/webSocketDiagnostics";
import type { ConnectionState, GuiSocketSend, WebSocketDiagnostics } from "../types";

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
  const [diagnostics, setDiagnostics] = useState<WebSocketDiagnostics>(() => initialWebSocketDiagnostics());

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
    let reconnectAttempt = 0;
    let closedByEffect = false;

    const clearReconnectTimer = () => {
      if (reconnectTimer !== undefined) {
        window.clearTimeout(reconnectTimer);
        reconnectTimer = undefined;
      }
    };

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

    const scheduleReconnect = (immediate = false) => {
      if (closedByEffect) return;
      clearReconnectTimer();
      const attempt = reconnectAttempt++;
      setDiagnostics((current) => ({ ...current, reconnectAttempt }));
      const delay = immediate ? 0 : reconnectDelayMs(attempt);
      reconnectTimer = window.setTimeout(connect, delay);
    };

    const connect = () => {
      clearReconnectTimer();
      if (closedByEffect) return;
      setConnection(reconnectAttempt > 0 ? "reconnecting" : "connecting");
      const socketUrl = wsUrl(lastGuiEventIdRef.current);
      setDiagnostics((current) => ({ ...current, endpoint: sanitizeWebSocketUrlForDiagnostics(socketUrl), authPresent: Boolean(authToken()) }));
      const ws = new WebSocket(socketUrl);
      wsRef.current = ws;
      const isCurrentSocket = () => wsRef.current === ws;

      ws.addEventListener("open", () => {
        if (!isCurrentSocket()) return;
        reconnectAttempt = 0;
        clearConnectionWarning();
        setConnection("connected_waiting_hello");
        setDiagnostics((current) => ({ ...current, reconnectAttempt: 0 }));
        onOpenRef.current?.();
      });

      ws.addEventListener("message", (message) => {
        if (!isCurrentSocket()) return;
        try {
          const event = JSON.parse(message.data as string) as ServerEvent;
          lastGuiEventIdRef.current = replayCursorAfterServerEvent(lastGuiEventIdRef.current, event);
          setConnection((current) => connectionStateAfterServerEvent(current, event));
          setDiagnostics((current) => diagnosticsAfterServerEvent(current, event, lastGuiEventIdRef.current));
          onEventRef.current(event);
        } catch (error) {
          onErrorRef.current((error as Error).message || "WebSocket 消息解析失败");
        }
      });

      ws.addEventListener("close", (event) => {
        if (!isCurrentSocket()) return;
        wsRef.current = null;
        if (closedByEffect) return;
        onCloseRef.current?.();
        setDiagnostics((current) => ({
          ...current,
          lastClose: {
            code: event.code,
            reason: event.reason,
            wasClean: event.wasClean,
            at: Date.now(),
            reconnectAttempt,
          },
        }));
        if (isUnauthorizedCloseEvent(event)) {
          clearConnectionWarning();
          const warning = connectionUnavailableMessage("unauthorized");
          setConnection("unauthorized");
          setConnectionWarning(warning);
          onConnectionWarningRef.current?.(warning);
          return;
        }
        setConnection("closed");
        scheduleConnectionWarning();
        scheduleReconnect();
      });

      ws.addEventListener("error", () => {
        if (!isCurrentSocket()) return;
        scheduleConnectionWarning();
      });
    };

    const fastReconnectIfNeeded = () => {
      if (closedByEffect) return;
      const readyState = wsRef.current?.readyState;
      if (readyState === WebSocket.OPEN || readyState === WebSocket.CONNECTING) return;
      reconnectAttempt = 0;
      scheduleReconnect(true);
    };

    const handleVisibilityChange = () => {
      if (document.visibilityState === "visible") fastReconnectIfNeeded();
    };

    window.addEventListener("online", fastReconnectIfNeeded);
    document.addEventListener("visibilitychange", handleVisibilityChange);
    connect();

    return () => {
      closedByEffect = true;
      window.removeEventListener("online", fastReconnectIfNeeded);
      document.removeEventListener("visibilitychange", handleVisibilityChange);
      clearReconnectTimer();
      clearConnectionWarning();
      wsRef.current?.close();
    };
  }, []);

  const send = useCallback<GuiSocketSend>((command, options) => {
    if (wsRef.current?.readyState !== WebSocket.OPEN) {
      if (options?.notifyOnDisconnected !== false) onErrorRef.current("WebSocket 未连接");
      return false;
    }
    wsRef.current.send(JSON.stringify({ ...command, requestId: command.requestId ?? createRequestId() }));
    return true;
  }, []);

  return { connection, send, connectionWarning, diagnostics };
}

const RECONNECT_BASE_DELAY_MS = 800;
const RECONNECT_MAX_DELAY_MS = 10_000;
const CONNECTION_WARNING_GRACE_MS = 3000;

function reconnectDelayMs(attempt: number): number {
  const exponential = RECONNECT_BASE_DELAY_MS * 2 ** Math.min(attempt, 4);
  const jitter = Math.floor(Math.random() * 350);
  return Math.min(RECONNECT_MAX_DELAY_MS, exponential + jitter);
}

export function replayCursorAfterServerEvent(currentEventId: number, event: ServerEvent): number {
  if ((event.type === "hello" || event.type === "bootstrap.begin" || event.type === "bootstrap.complete" || event.type === "replay.complete" || event.type === "connection.ready") && currentEventId > event.lastEventId) return event.lastEventId;
  if (event.type === "gui.event") return Math.max(currentEventId, event.event.id);
  if (event.type === "event.replay.gap") return event.lastEventId;
  return currentEventId;
}

export function connectionStateAfterServerEvent(current: ConnectionState, event: ServerEvent): ConnectionState {
  if (event.type === "hello" || event.type === "bootstrap.begin") return "bootstrapping";
  if (event.type === "bootstrap.complete") return "replaying";
  if (event.type === "event.replay.gap") return "degraded";
  if (event.type === "connection.ready") return "ready";
  return current;
}

export function diagnosticsAfterServerEvent(current: WebSocketDiagnostics, event: ServerEvent, lastGuiEventId: number): WebSocketDiagnostics {
  const base = current.lastGuiEventId === lastGuiEventId ? current : { ...current, lastGuiEventId };
  if (event.type === "hello") {
    return { ...base, lastHelloAt: Date.now(), lastServerTime: event.serverTime, lastConnectionId: event.connectionId ?? current.lastConnectionId };
  }
  if (event.type === "bootstrap.begin" || event.type === "bootstrap.complete" || event.type === "replay.complete") {
    return { ...base, lastServerTime: event.serverTime, lastConnectionId: event.connectionId };
  }
  if (event.type === "connection.ready") {
    return { ...base, lastReadyAt: Date.now(), lastServerTime: event.serverTime, lastConnectionId: event.connectionId ?? current.lastConnectionId };
  }
  if (event.type === "event.replay.gap") {
    return { ...base, lastReplayGap: event };
  }
  return base;
}

function initialWebSocketDiagnostics(): WebSocketDiagnostics {
  return {
    endpoint: sanitizeWebSocketUrlForDiagnostics(wsUrl()),
    authPresent: Boolean(authToken()),
    reconnectAttempt: 0,
    lastGuiEventId: 0,
  };
}

export function isUnauthorizedCloseEvent(event: CloseEvent): boolean {
  return event.code === 1008 || event.reason.toLowerCase() === "unauthorized";
}

export function wsUrl(sinceEventId = 0): string {
  const config = piGuiRuntimeConfig();
  const baseUrl = config.wsUrl || wsUrlFromApiBaseUrl(config.apiBaseUrl) || `${window.location.protocol === "https:" ? "wss" : "ws"}://${window.location.host}/ws`;
  const url = new URL(baseUrl, window.location.href);
  const token = authToken();
  if (token) url.searchParams.set("token", token);
  if (sinceEventId > 0) url.searchParams.set("sinceEventId", String(sinceEventId));
  return url.toString();
}

function wsUrlFromApiBaseUrl(value: string | undefined): string | undefined {
  if (!value) return undefined;
  try {
    const url = new URL(value, window.location.href);
    if (url.protocol !== "http:" && url.protocol !== "https:") return undefined;
    url.protocol = url.protocol === "https:" ? "wss:" : "ws:";
    const basePath = stripTrailingApiPath(url.pathname).replace(/\/+$/, "");
    url.pathname = `${basePath}/ws` || "/ws";
    url.search = "";
    url.hash = "";
    return url.toString();
  } catch {
    return undefined;
  }
}

function stripTrailingApiPath(pathname: string): string {
  if (pathname === "/api") return "";
  return pathname.endsWith("/api") ? pathname.slice(0, -"/api".length) : pathname;
}
