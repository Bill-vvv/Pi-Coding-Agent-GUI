import assert from "node:assert/strict";
import { test } from "node:test";
import type { ConversationDelta, ServerEvent } from "@pi-gui/shared";
import { dispatchAppServerEvent } from "../src/domain/serverEventDispatcher";
import type { AppAction } from "../src/state/appReducer";

function createContext(overrides: Partial<Parameters<typeof dispatchAppServerEvent>[0]> = {}) {
  const calls: string[] = [];
  const actions: AppAction[] = [];
  const deltas: ConversationDelta[] = [];

  return {
    calls,
    actions,
    deltas,
    context: {
      event: { type: "project.list", projects: [] } satisfies ServerEvent,
      performanceFixtureMode: false,
      dispatch: (action: AppAction) => {
        calls.push(action.type === "server.event" ? `dispatch:${action.event.type}` : `dispatch:${action.type}`);
        actions.push(action);
      },
      queueConversationDelta: (delta: ConversationDelta) => {
        calls.push("queueDelta");
        deltas.push(delta);
      },
      flushConversationDeltas: () => {
        calls.push("flushDeltas");
      },
      handleRuntimeLogsServerEvent: () => {
        calls.push("runtimeLogs");
      },
      handleProjectRuntimeServerEvent: () => {
        calls.push("projectRuntime");
      },
      handleSessionRestoreServerEvent: () => {
        calls.push("sessionRestore");
      },
      handleSessionTreeForkServerEvent: () => {
        calls.push("sessionTreeFork");
      },
      handleExtensionUiServerEvent: () => {
        calls.push("extensionUi");
      },
      handleComposerCommandServerEvent: () => {
        calls.push("composerCommand");
      },
      ...overrides,
    },
  };
}

test("conversation deltas are queued without flushing, reducer dispatch, or side effects", () => {
  const delta: ConversationDelta = {
    runtimeId: "r1",
    projectId: "p1",
    messageId: "m1",
    timestamp: 1,
    appendText: "hello",
  };
  const { context, calls, actions, deltas } = createContext({
    event: { type: "conversation.delta", delta },
  });

  dispatchAppServerEvent(context);

  assert.deepEqual(calls, ["queueDelta"]);
  assert.deepEqual(deltas, [delta]);
  assert.deepEqual(actions, []);
});

test("non-delta events flush deltas before reducer dispatch and post-reducer side effects", () => {
  const event = { type: "project.list", projects: [] } satisfies ServerEvent;
  const { context, calls, actions } = createContext({ event });

  dispatchAppServerEvent(context);

  assert.deepEqual(calls, [
    "flushDeltas",
    "runtimeLogs",
    "dispatch:project.list",
    "projectRuntime",
    "sessionRestore",
    "sessionTreeFork",
    "extensionUi",
    "composerCommand",
  ]);
  assert.deepEqual(actions, [{ type: "server.event", event }]);
});
