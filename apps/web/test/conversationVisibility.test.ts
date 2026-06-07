import assert from "node:assert/strict";
import test from "node:test";
import type { ConversationMessage, GuiSession, Runtime, RuntimeConversationSummary } from "@pi-gui/shared";
import { runtimeHasVisibleConversationContent } from "../src/domain/conversationVisibility";

const runtime: Runtime = {
  id: "runtime-1",
  projectId: "project-1",
  cwd: "/tmp/project",
  status: "stopped",
  startedAt: 1,
  archivedAt: 2,
};

const message: ConversationMessage = {
  id: "message-1",
  runtimeId: runtime.id,
  projectId: runtime.projectId,
  role: "user",
  text: "hello",
  timestamp: 1,
};

const session: GuiSession = {
  id: "session-1",
  projectId: runtime.projectId,
  piSessionFile: "/tmp/session.jsonl",
  createdAt: 1,
  updatedAt: 2,
};

const summary: RuntimeConversationSummary = {
  runtimeId: runtime.id,
  projectId: runtime.projectId,
  title: "Existing conversation",
  messageCount: 1,
};

test("visible conversation content ignores blank archived runtime shells", () => {
  assert.equal(runtimeHasVisibleConversationContent({ runtime, messages: [], session }), false);
});

test("visible conversation content accepts messages, summaries, or titled sessions", () => {
  assert.equal(runtimeHasVisibleConversationContent({ runtime, messages: [message] }), true);
  assert.equal(runtimeHasVisibleConversationContent({ runtime, summary }), true);
  assert.equal(runtimeHasVisibleConversationContent({ runtime, session: { ...session, title: "历史对话" } }), true);
});
