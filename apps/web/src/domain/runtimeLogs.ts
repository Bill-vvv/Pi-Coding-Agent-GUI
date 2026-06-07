import type { GuiEvent, Runtime } from "@pi-gui/shared";

export type RuntimeLogActionState = {
  canStop: boolean;
  canResume: boolean;
  canRestart: boolean;
  canArchive: boolean;
};

export function runtimeLogActionState(runtime: Runtime | undefined, busy = false): RuntimeLogActionState {
  if (!runtime || Boolean(runtime.archivedAt)) return { canStop: false, canResume: false, canRestart: false, canArchive: false };
  return {
    canStop: runtime.status === "running" || runtime.status === "starting",
    canResume: Boolean(runtime.sessionId) && (runtime.status === "stopped" || runtime.status === "crashed"),
    canRestart: !runtime.sessionId && (runtime.status === "stopped" || runtime.status === "crashed"),
    canArchive: !busy,
  };
}

export function deriveRuntimeCrashSummary(events: GuiEvent[]): { timestamp?: number; reason?: string } {
  for (const event of [...events].reverse()) {
    const text = runtimeLogEventText(event);
    if (!text) continue;
    if (event.kind === "error" || event.kind === "stderr" || event.kind === "runtime_status") {
      return { timestamp: event.timestamp, reason: text };
    }
  }
  return {};
}

export function runtimeLogsCopyText(runtime: Runtime | undefined, events: GuiEvent[]): string {
  const header = runtime
    ? [`Runtime ${runtime.id}`, `status=${runtime.status}`, `cwd=${runtime.cwd}`, runtime.pid ? `pid=${runtime.pid}` : undefined].filter(Boolean).join(" · ")
    : "Runtime logs";
  const lines = events.map((event) => `[${formatRuntimeLogTimestamp(event.timestamp)}] ${event.kind}: ${runtimeLogEventText(event)}`);
  return [header, ...lines].join("\n");
}

export function runtimeLogEventText(event: GuiEvent): string {
  if (typeof event.payload === "string") return compactWhitespace(event.payload);
  if (event.payload && typeof event.payload === "object") {
    const record = event.payload as Record<string, unknown>;
    if (typeof record.message === "string") return compactWhitespace(record.message);
    if (typeof record.error === "string") return compactWhitespace(record.error);
    if (typeof record.exitCode === "number" || typeof record.signal === "string") {
      return compactWhitespace(`exitCode=${record.exitCode ?? "unknown"} signal=${record.signal ?? "none"} status=${String(record.status ?? "unknown")}`);
    }
    if (typeof record.status === "string") return `status: ${record.status}`;
    return compactWhitespace(JSON.stringify(record));
  }
  return String(event.payload ?? "");
}

export function runtimeStatusLabel(status: Runtime["status"]): string {
  switch (status) {
    case "running":
      return "运行中";
    case "starting":
      return "启动中";
    case "stopped":
      return "已停止";
    case "crashed":
      return "已崩溃";
  }
}

export function formatRuntimeLogTimestamp(timestamp?: number): string {
  if (!timestamp) return "unknown time";
  try {
    return new Intl.DateTimeFormat("zh-CN", { month: "2-digit", day: "2-digit", hour: "2-digit", minute: "2-digit", second: "2-digit" }).format(new Date(timestamp));
  } catch {
    return String(timestamp);
  }
}

function compactWhitespace(value: string): string {
  return value.replace(/\s+/g, " ").trim();
}
