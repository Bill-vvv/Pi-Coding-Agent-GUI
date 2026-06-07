import { isRecord, type ServerEvent } from "@pi-gui/shared";
import type { ManagedRuntime } from "./managedRuntime.js";
import type { RuntimeEventSink } from "./runtimeEventSink.js";
import { requestRuntimeMessages, requestRuntimeState, requestSessionStats } from "./runtimeStateRequester.js";

type Broadcast = (event: ServerEvent) => void;

export function handleNativeRpcResponse(
  managed: ManagedRuntime,
  id: string,
  response: Record<string, unknown>,
  broadcast: Broadcast,
  events: RuntimeEventSink,
): void {
  const pending = managed.pendingNativeRpcCommands.get(id);
  if (!pending) return;
  managed.pendingNativeRpcCommands.delete(id);

  const command = typeof response.command === "string" ? response.command : pending.command;
  const data = response.success === true ? response.data : undefined;
  const error = response.success === false && typeof response.error === "string" ? response.error : undefined;
  broadcast({
    type: "runtime.rpc.response",
    runtimeId: managed.runtime.id,
    projectId: managed.runtime.projectId,
    command,
    success: response.success === true,
    data,
    error,
    label: pending.label,
  });

  const log = formatNativeRpcResponse(command, response.success === true, data, error);
  if (log) managed.projection.appendLog(response.success === true ? "log" : "error", log, pending.label ?? command);

  if (["new_session", "switch_session", "fork", "clone"].includes(command)) {
    requestRuntimeState(managed, events);
    requestRuntimeMessages(managed, events);
    requestSessionStats(managed, events);
  }
  if (command === "set_session_name") {
    requestRuntimeState(managed, events);
    requestSessionStats(managed, events);
  }
  if (command === "compact") {
    // The compact RPC response is returned after Pi emits compaction_end and rewrites
    // active context. Force a fresh stats sample so stale pre-compact requests cannot
    // leave the composer context meter showing the old token count.
    managed.statsRequestId = undefined;
    requestRuntimeState(managed, events);
    requestSessionStats(managed, events);
  }
}

function formatNativeRpcResponse(command: string, success: boolean, data: unknown, error?: string): string | undefined {
  if (!success) return error ?? `${command} failed`;
  const record = isRecord(data) ? data : undefined;
  switch (command) {
    case "compact": {
      const tokensBefore = typeof record?.tokensBefore === "number" ? `（压缩前约 ${record.tokensBefore.toLocaleString()} tokens）` : "";
      return `上下文压缩完成${tokensBefore}`;
    }
    case "set_session_name":
      return "会话名称已更新";
    case "get_session_stats":
      return formatSessionStats(record);
    case "export_html": {
      const path = typeof record?.path === "string" ? record.path : undefined;
      return path ? `会话已导出到 ${path}` : "会话已导出";
    }
    case "new_session":
      return record?.cancelled === true ? "新会话创建已取消" : "已创建新会话";
    case "clone":
      return record?.cancelled === true ? "克隆已取消" : "已克隆当前会话分支";
    case "fork":
      return record?.cancelled === true ? "Fork 已取消" : "已创建 Fork 会话";
    case "bash": {
      const output = typeof record?.output === "string" ? record.output : "";
      const exitCode = typeof record?.exitCode === "number" ? record.exitCode : undefined;
      const head = `Bash 执行完成${exitCode !== undefined ? `（exit ${exitCode}）` : ""}`;
      return output ? `${head}\n\n${output}` : head;
    }
    default:
      return undefined;
  }
}

function formatSessionStats(data?: Record<string, unknown>): string {
  if (!data) return "暂无会话统计信息";
  const totalMessages = typeof data.totalMessages === "number" ? data.totalMessages : undefined;
  const userMessages = typeof data.userMessages === "number" ? data.userMessages : undefined;
  const assistantMessages = typeof data.assistantMessages === "number" ? data.assistantMessages : undefined;
  const toolCalls = typeof data.toolCalls === "number" ? data.toolCalls : undefined;
  const cost = numberFromRecord(data, "cost");
  const sessionTokens = isRecord(data.tokens) ? data.tokens : undefined;
  const totalSessionTokens = sessionTokens ? numberFromRecord(sessionTokens, "total") ?? numberFromRecord(sessionTokens, "totalTokens") : undefined;
  const inputTokens = sessionTokens ? numberFromRecord(sessionTokens, "input") : undefined;
  const outputTokens = sessionTokens ? numberFromRecord(sessionTokens, "output") : undefined;
  const cacheReadTokens = sessionTokens ? numberFromRecord(sessionTokens, "cacheRead") : undefined;
  const cacheWriteTokens = sessionTokens ? numberFromRecord(sessionTokens, "cacheWrite") : undefined;
  const contextUsage = isRecord(data.contextUsage) ? data.contextUsage : undefined;
  const tokens = typeof contextUsage?.tokens === "number" ? contextUsage.tokens : undefined;
  const contextWindow = typeof contextUsage?.contextWindow === "number" ? contextUsage.contextWindow : undefined;
  const percent = typeof contextUsage?.percent === "number" ? contextUsage.percent : undefined;

  const lines = ["当前会话统计："];
  if (totalMessages !== undefined) lines.push(`- 消息：${totalMessages}（用户 ${userMessages ?? 0} / 助手 ${assistantMessages ?? 0}）`);
  if (toolCalls !== undefined) lines.push(`- 工具调用：${toolCalls}`);
  if (tokens !== undefined || contextWindow !== undefined || percent !== undefined) {
    lines.push(`- 上下文：${formatNumber(tokens)} / ${formatNumber(contextWindow)} tokens${percent !== undefined ? `（${percent.toFixed(1)}%）` : ""}`);
  }
  if (totalSessionTokens !== undefined || inputTokens !== undefined || outputTokens !== undefined || cacheReadTokens !== undefined || cacheWriteTokens !== undefined) {
    lines.push(`- Tokens：总计 ${formatNumber(totalSessionTokens)} / 输入 ${formatNumber(inputTokens)} / 输出 ${formatNumber(outputTokens)} / 缓存读 ${formatNumber(cacheReadTokens)} / 缓存写 ${formatNumber(cacheWriteTokens)}`);
  }
  if (cost !== undefined) lines.push(`- 成本：$${cost.toFixed(4)}`);
  return lines.join("\n");
}

function numberFromRecord(record: Record<string, unknown>, key: string): number | undefined {
  const value = record[key];
  return typeof value === "number" && Number.isFinite(value) ? value : undefined;
}

function formatNumber(value: number | undefined): string {
  return value === undefined ? "—" : value.toLocaleString();
}
