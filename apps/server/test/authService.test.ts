import assert from "node:assert/strict";
import test from "node:test";
import type { AddressInfo } from "node:net";
import cors from "@fastify/cors";
import websocket from "@fastify/websocket";
import Fastify from "fastify";
import { isWebSocketRequestAuthorized, redactTokenInUrl, registerApiAuth } from "../src/services/authService.js";
import type { ServerRuntimeConfig } from "../src/services/serverConfig.js";

const authedConfig: ServerRuntimeConfig = {
  host: "127.0.0.1",
  port: 8787,
  mode: "test",
  authToken: "secret-token",
  authRequired: true,
  remoteLan: false,
};

const devConfig: ServerRuntimeConfig = {
  host: "127.0.0.1",
  port: 8787,
  mode: "test",
  authRequired: false,
  remoteLan: false,
};

test("api auth allows dev no-token mode and protects /api routes when configured", async (t) => {
  const dev = Fastify({ logger: false });
  registerApiAuth(dev, devConfig);
  dev.get("/api/projects", async () => ({ ok: true }));
  t.after(() => dev.close());

  const devResponse = await dev.inject({ method: "GET", url: "/api/projects" });
  assert.equal(devResponse.statusCode, 200);

  const secured = Fastify({ logger: false });
  registerApiAuth(secured, authedConfig);
  secured.get("/api/projects", async () => ({ ok: true }));
  secured.get("/health", async () => ({ ok: true }));
  t.after(() => secured.close());

  assert.equal((await secured.inject({ method: "GET", url: "/health" })).statusCode, 200);
  assert.equal((await secured.inject({ method: "GET", url: "/api/projects" })).statusCode, 401);
  assert.equal((await secured.inject({ method: "GET", url: "/api/projects", headers: { authorization: "Bearer wrong" } })).statusCode, 401);
  assert.equal((await secured.inject({ method: "GET", url: "/api/projects", headers: { authorization: "Bearer secret-token" } })).statusCode, 200);
});

test("api auth does not block CORS preflight", async (t) => {
  const fastify = Fastify({ logger: false });
  await fastify.register(cors, { origin: [/^http:\/\/localhost(?::\d+)?$/] });
  registerApiAuth(fastify, authedConfig);
  fastify.get("/api/projects", async () => ({ ok: true }));
  t.after(() => fastify.close());

  const response = await fastify.inject({
    method: "OPTIONS",
    url: "/api/projects",
    headers: {
      origin: "http://localhost:5173",
      "access-control-request-method": "GET",
      "access-control-request-headers": "authorization",
    },
  });

  assert.notEqual(response.statusCode, 401);
});

test("websocket auth accepts token query or bearer header and rejects missing tokens", () => {
  assert.equal(isWebSocketRequestAuthorized(fakeRequest({ query: { token: "secret-token" } }), authedConfig), true);
  assert.equal(isWebSocketRequestAuthorized(fakeRequest({ headers: { authorization: "Bearer secret-token" } }), authedConfig), true);
  assert.equal(isWebSocketRequestAuthorized(fakeRequest({ query: { token: "wrong" } }), authedConfig), false);
  assert.equal(isWebSocketRequestAuthorized(fakeRequest({}), authedConfig), false);
  assert.equal(isWebSocketRequestAuthorized(fakeRequest({}), devConfig), true);
});

test("redactTokenInUrl hides websocket query tokens", () => {
  assert.equal(redactTokenInUrl("/ws?token=secret-token&sinceEventId=12"), "/ws?token=%5Bredacted%5D&sinceEventId=12");
  assert.equal(redactTokenInUrl("/ws?authToken=secret-token"), "/ws?authToken=%5Bredacted%5D");
  assert.equal(redactTokenInUrl("/api/models"), "/api/models");
});

test("websocket auth rejects clients before hello and allows valid token", async (t) => {
  const fastify = Fastify({ logger: false });
  await fastify.register(websocket);
  fastify.get("/ws", { websocket: true }, (socket, request) => {
    if (!isWebSocketRequestAuthorized(request, authedConfig)) {
      socket.close(1008, "Unauthorized");
      return;
    }
    socket.send(JSON.stringify({ type: "hello" }));
  });
  await fastify.listen({ host: "127.0.0.1", port: 0 });
  t.after(() => fastify.close());
  const address = fastify.server.address() as AddressInfo;
  const baseUrl = `ws://127.0.0.1:${address.port}/ws`;

  const missingToken = await observeWebSocket(baseUrl);
  assert.equal(missingToken.message, undefined);
  assert.equal(missingToken.closeCode, 1008);

  const invalidToken = await observeWebSocket(`${baseUrl}?token=wrong`);
  assert.equal(invalidToken.message, undefined);
  assert.equal(invalidToken.closeCode, 1008);

  const validToken = await observeWebSocket(`${baseUrl}?token=secret-token`);
  assert.equal(validToken.message, '{"type":"hello"}');
});

async function observeWebSocket(url: string): Promise<{ message?: string; closeCode?: number }> {
  const WebSocketCtor = globalThis.WebSocket;
  assert.ok(WebSocketCtor, "global WebSocket is required for this test");
  const socket = new WebSocketCtor(url);
  return await new Promise((resolve, reject) => {
    const timer = setTimeout(() => reject(new Error(`Timed out waiting for websocket: ${url}`)), 1000);
    let message: string | undefined;
    socket.addEventListener("message", (event) => {
      message = String(event.data);
      socket.close();
    });
    socket.addEventListener("close", (event) => {
      clearTimeout(timer);
      resolve({ message, closeCode: event.code });
    });
    socket.addEventListener("error", () => {
      // Unauthorized websocket upgrades close immediately after connect on this route.
    });
  });
}

function fakeRequest({ query, headers }: { query?: Record<string, unknown>; headers?: Record<string, string> }) {
  return { query, headers: headers ?? {} } as never;
}
