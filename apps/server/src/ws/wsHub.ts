import type { ServerEvent } from "@pi-gui/shared";

export type WsClient = {
  send(data: string): void;
  on(event: "message", listener: (data: Buffer | string) => void): void;
  on(event: "close", listener: () => void): void;
  on(event: "error", listener: (error: Error) => void): void;
  on(event: "pong", listener: () => void): void;
  ping?: () => void;
  close?: (code?: number, reason?: string) => void;
  terminate?: () => void;
  bufferedAmount?: number;
};

type WsClientState = {
  alive: boolean;
};

type WsHubOptions = {
  heartbeatIntervalMs?: number;
  maxBufferedAmount?: number;
};

const DEFAULT_HEARTBEAT_INTERVAL_MS = 30_000;
const DEFAULT_MAX_BUFFERED_AMOUNT = 4 * 1024 * 1024;
const SLOW_CLIENT_CLOSE_CODE = 1013;

export class WsHub {
  private readonly clients = new Map<WsClient, WsClientState>();
  private readonly heartbeatIntervalMs: number;
  private readonly maxBufferedAmount: number;
  private readonly heartbeatTimer?: NodeJS.Timeout;

  constructor(options: WsHubOptions = {}) {
    this.heartbeatIntervalMs = options.heartbeatIntervalMs ?? DEFAULT_HEARTBEAT_INTERVAL_MS;
    this.maxBufferedAmount = options.maxBufferedAmount ?? DEFAULT_MAX_BUFFERED_AMOUNT;
    if (this.heartbeatIntervalMs > 0) {
      this.heartbeatTimer = setInterval(() => this.checkHeartbeat(), this.heartbeatIntervalMs);
      this.heartbeatTimer.unref?.();
    }
  }

  add(socket: WsClient): void {
    this.clients.set(socket, { alive: true });
    socket.on("pong", () => {
      const state = this.clients.get(socket);
      if (state) state.alive = true;
    });
  }

  remove(socket: WsClient): void {
    this.clients.delete(socket);
  }

  close(): void {
    if (this.heartbeatTimer) clearInterval(this.heartbeatTimer);
    this.clients.clear();
  }

  send(socket: WsClient, event: ServerEvent): boolean {
    return this.sendSerialized(socket, JSON.stringify(event));
  }

  broadcast(event: ServerEvent): void {
    const serialized = JSON.stringify(event);
    for (const client of this.clients.keys()) {
      this.sendSerialized(client, serialized);
    }
  }

  clientCount(): number {
    return this.clients.size;
  }

  checkHeartbeat(): void {
    for (const [client, state] of this.clients) {
      if (!state.alive) {
        this.closeClient(client, "stale");
        continue;
      }
      state.alive = false;
      try {
        client.ping?.();
      } catch {
        this.closeClient(client, "ping failed");
      }
    }
  }

  private sendSerialized(socket: WsClient, serialized: string): boolean {
    if (!this.clients.has(socket)) return false;
    if ((socket.bufferedAmount ?? 0) > this.maxBufferedAmount) {
      this.closeClient(socket, "backpressure");
      return false;
    }
    try {
      socket.send(serialized);
      return true;
    } catch {
      this.closeClient(socket, "send failed");
      return false;
    }
  }

  private closeClient(socket: WsClient, reason: string): void {
    this.clients.delete(socket);
    try {
      if (socket.terminate) socket.terminate();
      else socket.close?.(SLOW_CLIENT_CLOSE_CODE, reason);
    } catch {
      // Ignore close failures; the client has already been removed from the hub.
    }
  }
}
