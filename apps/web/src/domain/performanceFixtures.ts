import type { ConversationMessage, Project, Runtime, RuntimeConversationSummary, ServerEvent, SubagentRun } from "@pi-gui/shared";

export function performanceFixtureEvents(now = Date.now()): ServerEvent[] {
  const project: Project = { id: "fixture-project", name: "Perf Fixture", cwd: "/tmp/pi-gui-fixture", lastOpenedAt: now };
  const runtimes: Runtime[] = Array.from({ length: 50 }, (_value, index) => ({
    id: `fixture-runtime-${index + 1}`,
    projectId: project.id,
    cwd: project.cwd,
    status: index === 0 ? "running" : "stopped",
    startedAt: now - index * 1000,
    sessionId: `fixture-session-${index + 1}`,
  }));
  const summaries: RuntimeConversationSummary[] = runtimes.map((runtime, index) => ({
    runtimeId: runtime.id,
    projectId: runtime.projectId,
    title: `性能 Fixture 对话 ${index + 1}`,
    detail: index === 0 ? "包含 2,000 条消息、工具、代码块和思考内容" : "summary-only runtime",
    updatedAt: now - index * 1000,
    messageCount: index === 0 ? 2000 : 2,
    latestAssistantCompletedAt: now - index * 1000,
  }));
  const subagentRun: SubagentRun = {
    id: "fixture-runtime-1:subagent-fixture",
    projectId: project.id,
    parentRuntimeId: "fixture-runtime-1",
    parentToolCallId: "subagent-fixture",
    parentToolMessageId: "tool-subagent-fixture",
    agent: "review-agent",
    mode: "parallel",
    status: "running",
    startedAt: now - 5_000,
    updatedAt: now,
    runs: [
      { id: "child-1", agent: "review-agent", status: "running", textTail: "正在分析性能路径…", sessionFile: "/tmp/pi-gui-fixture/child-1.jsonl" },
      { id: "child-2", agent: "review-agent", status: "succeeded", finalText: "完成局部检查。", sessionFile: "/tmp/pi-gui-fixture/child-2.jsonl" },
    ],
  };

  return [
    {
      type: "hello",
      serverTime: now,
      projects: [project],
      runtimes,
      settings: {},
      lastEventId: 0,
      conversationSummaries: summaries,
      sessions: [],
      subagentRuns: [subagentRun],
    },
    {
      type: "conversation.snapshot",
      runtimeId: runtimes[0]!.id,
      projectId: project.id,
      messages: performanceFixtureMessages(runtimes[0]!, 2000, now),
      busy: true,
      hasMoreBefore: false,
    },
    { type: "subagent.snapshot", runs: [subagentRun] },
  ];
}

export function performanceFixtureMessages(runtime: Runtime, count: number, now = Date.now()): ConversationMessage[] {
  const messages: ConversationMessage[] = [];
  for (let index = 0; index < count; index += 1) {
    const timestamp = now - (count - index) * 100;
    if (index % 10 === 0) {
      messages.push(message(runtime, `user-${index}`, "user", `请分析第 ${index} 个性能场景。`, timestamp));
      continue;
    }
    if (index % 17 === 0) {
      messages.push(message(runtime, `tool-read-${index}`, "tool", `读取 fixture-${index}.ts\n${"output line\n".repeat(20)}`, timestamp, `read ${index % 34 === 0 ? "运行中" : "完成"}`, index % 34 === 0));
      continue;
    }
    if (index % 37 === 0) {
      messages.push(message(runtime, "tool-subagent-fixture", "tool", "subagent running", timestamp, "agent_run 运行中", true));
      continue;
    }
    const code = index % 23 === 0 ? `\n\n\`\`\`ts\n${"const value = 1;\n".repeat(120)}\`\`\`` : "";
    messages.push(message(runtime, `assistant-${index}`, "assistant", `这是第 ${index} 条 fixture 回复，包含 Markdown 内容。${code}`, timestamp, undefined, index === count - 1, index % 13 === 0 ? "先思考，再回答。" : undefined));
  }
  return messages;
}

function message(
  runtime: Runtime,
  id: string,
  role: ConversationMessage["role"],
  text: string,
  timestamp: number,
  title?: string,
  isStreaming = false,
  thinking?: string,
): ConversationMessage {
  return {
    id,
    runtimeId: runtime.id,
    projectId: runtime.projectId,
    role,
    text,
    title,
    isStreaming,
    thinking,
    timestamp,
    updatedAt: timestamp,
  };
}
