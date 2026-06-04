import assert from "node:assert/strict";
import test from "node:test";
import type { GuiSession, Runtime, RuntimeConversationSummary } from "@pi-gui/shared";
import { sidebarSessionDetail, sidebarSessionTitle } from "../src/domain/sidebarSessions";

const runtime: Runtime = {
  id: "runtime-12345678",
  projectId: "project-1",
  cwd: "/tmp/project",
  status: "stopped",
  startedAt: 1,
  sessionId: "abcdef1234567890",
};

const session: GuiSession = {
  id: "abcdef1234567890",
  projectId: "project-1",
  piSessionFile: "/tmp/session.jsonl",
  title: "索引标题",
  createdAt: 1,
  updatedAt: Date.parse("2026-06-03T10:01:00.000Z"),
  runtimeId: runtime.id,
};

test("sidebar session title prefers backend conversation summary", () => {
  const summary: RuntimeConversationSummary = {
    runtimeId: runtime.id,
    projectId: runtime.projectId,
    title: "后端摘要标题",
    detail: "后端最新回复",
    updatedAt: 2,
    messageCount: 2,
  };

  assert.equal(sidebarSessionTitle(runtime, summary, session), "后端摘要标题");
  assert.equal(sidebarSessionDetail(runtime, summary, session), "后端最新回复");
});

test("sidebar session title uses indexed session title instead of saved-conversation fallback", () => {
  assert.equal(sidebarSessionTitle(runtime, undefined, session), "索引标题");
  assert.notEqual(sidebarSessionTitle(runtime, undefined, session), "已保存对话");
});

test("sidebar session fallback avoids generic saved-conversation label when only session id exists", () => {
  assert.equal(sidebarSessionTitle(runtime, undefined, undefined), "对话 abcdef12");
  assert.equal(sidebarSessionDetail(runtime, undefined, undefined), "Session abcdef12");
});
