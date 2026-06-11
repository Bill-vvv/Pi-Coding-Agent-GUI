import assert from "node:assert/strict";
import test from "node:test";
import type { ServerEvent } from "@pi-gui/shared";
import { WsHub, type WsClient } from "../src/ws/wsHub.js";

const event = { type: "project.list", projects: [] } satisfies ServerEvent;

test("WsHub.send catches direct send failures and removes the client", () => {
  const hub = new WsHub({ heartbeatIntervalMs: 0 });
  const client = new FakeWsClient();
  client.throwOnSend = true;
  hub.add(client);

  assert.equal(hub.send(client, event), false);
  assert.equal(hub.clientCount(), 0);
  assert.equal(client.terminated, true);
  hub.close();
});

test("WsHub.broadcast removes clients that fail while keeping healthy clients", () => {
  const hub = new WsHub({ heartbeatIntervalMs: 0 });
  const failing = new FakeWsClient();
  const healthy = new FakeWsClient();
  failing.throwOnSend = true;
  hub.add(failing);
  hub.add(healthy);

  hub.broadcast(event);

  assert.equal(hub.clientCount(), 1);
  assert.equal(failing.terminated, true);
  assert.equal(healthy.sent.length, 1);
  assert.equal(JSON.parse(healthy.sent[0])?.type, "project.list");
  hub.close();
});

test("WsHub closes clients above the bufferedAmount threshold", () => {
  const hub = new WsHub({ heartbeatIntervalMs: 0, maxBufferedAmount: 10 });
  const client = new FakeWsClient();
  client.bufferedAmount = 11;
  hub.add(client);

  assert.equal(hub.send(client, event), false);

  assert.equal(hub.clientCount(), 0);
  assert.equal(client.terminated, true);
  assert.deepEqual(client.sent, []);
  hub.close();
});

test("WsHub heartbeat pings live clients and closes stale clients", () => {
  const hub = new WsHub({ heartbeatIntervalMs: 0 });
  const client = new FakeWsClient();
  hub.add(client);

  hub.checkHeartbeat();
  assert.equal(client.pingCount, 1);
  assert.equal(hub.clientCount(), 1);

  hub.checkHeartbeat();
  assert.equal(hub.clientCount(), 0);
  assert.equal(client.terminated, true);
  hub.close();
});

test("WsHub heartbeat keeps clients alive after pong", () => {
  const hub = new WsHub({ heartbeatIntervalMs: 0 });
  const client = new FakeWsClient();
  hub.add(client);

  hub.checkHeartbeat();
  client.emitPong();
  hub.checkHeartbeat();

  assert.equal(client.pingCount, 2);
  assert.equal(hub.clientCount(), 1);
  hub.close();
});

test("WsHub reports why it closed a client", () => {
  const closed: Array<{ reason: string; mode: "close" | "terminate"; bufferedAmount?: number }> = [];
  const hub = new WsHub({
    heartbeatIntervalMs: 0,
    onClientClosed: ({ reason, mode, bufferedAmount }) => closed.push({ reason, mode, bufferedAmount }),
  });
  const client = new FakeWsClient();
  client.throwOnSend = true;
  hub.add(client);

  assert.equal(hub.send(client, event), false);

  assert.deepEqual(closed, [{ reason: "send failed", mode: "terminate", bufferedAmount: 0 }]);
  hub.close();
});

class FakeWsClient implements WsClient {
  sent: string[] = [];
  bufferedAmount = 0;
  throwOnSend = false;
  terminated = false;
  closed: { code?: number; reason?: string } | undefined;
  pingCount = 0;
  private readonly listeners = new Map<string, Array<(...args: never[]) => void>>();

  send(data: string): void {
    if (this.throwOnSend) throw new Error("send failed");
    this.sent.push(data);
  }

  on(event: "message", listener: (data: Buffer | string) => void): void;
  on(event: "close", listener: () => void): void;
  on(event: "error", listener: (error: Error) => void): void;
  on(event: "pong", listener: () => void): void;
  on(event: string, listener: (...args: never[]) => void): void {
    const listeners = this.listeners.get(event) ?? [];
    listeners.push(listener);
    this.listeners.set(event, listeners);
  }

  ping(): void {
    this.pingCount += 1;
  }

  terminate(): void {
    this.terminated = true;
  }

  close(code?: number, reason?: string): void {
    this.closed = { code, reason };
  }

  emitPong(): void {
    for (const listener of this.listeners.get("pong") ?? []) listener();
  }
}
