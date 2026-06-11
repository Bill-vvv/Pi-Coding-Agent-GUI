import type { ClientCommand, ServerEvent } from "@pi-gui/shared";

export type PendingCommandStatus = "sent" | "succeeded" | "failed" | "timeout" | "unknown_after_disconnect";

export type PendingCommandTarget = {
  projectId?: string;
  runtimeId?: string;
  sessionId?: string;
  checkpointSnapshotId?: string;
  cwd?: string;
};

export type PendingCommandEntry = {
  requestId: string;
  command: ClientCommand["type"];
  target: PendingCommandTarget;
  status: PendingCommandStatus;
  sentAt: number;
  timeoutAt: number;
  updatedAt: number;
  result?: Extract<ServerEvent, { type: "command.result" }>;
  error?: string;
};

export type PendingCommandSummary = {
  total: number;
  sent: number;
  succeeded: number;
  failed: number;
  timeout: number;
  unknownAfterDisconnect: number;
  latest?: PendingCommandEntry;
};

export type PendingCommandRegistryAction =
  | { type: "record"; command: ClientCommand & { requestId: string }; now: number; timeoutMs?: number }
  | { type: "result"; result: Extract<ServerEvent, { type: "command.result" }>; now: number }
  | { type: "timeout"; now: number }
  | { type: "disconnect"; now: number }
  | { type: "prune"; now: number };

export const DEFAULT_PENDING_COMMAND_TIMEOUT_MS = 15_000;
export const COMPLETED_PENDING_COMMAND_TTL_MS = 60_000;
const MAX_PENDING_COMMAND_ENTRIES = 120;

const CRITICAL_COMPOSER_COMMANDS = new Set<ClientCommand["type"]>([
  "project.create",
  "runtime.start",
  "runtime.resume",
  "runtime.restart",
  "runtime.prompt",
  "runtime.abort",
  "runtime.stop",
  "runtime.archive",
  "runtime.archiveBlank",
  "runtime.queue.dequeue",
  "runtime.queue.reorder",
  "session.resume",
]);

export function pendingCommandRegistryReducer(entries: PendingCommandEntry[], action: PendingCommandRegistryAction): PendingCommandEntry[] {
  switch (action.type) {
    case "record":
      return prunePendingCommandEntries(upsertPendingCommandEntry(entries, entryFromCommand(action.command, action.now, action.timeoutMs)), action.now);
    case "result":
      return applyCommandResult(entries, action.result, action.now);
    case "timeout":
      return entries.map((entry) => entry.status === "sent" && entry.timeoutAt <= action.now ? { ...entry, status: "timeout", updatedAt: action.now, error: "Command timed out" } : entry);
    case "disconnect":
      return entries.map((entry) => entry.status === "sent" ? { ...entry, status: "unknown_after_disconnect", updatedAt: action.now, error: "Connection disconnected before result" } : entry);
    case "prune":
      return prunePendingCommandEntries(entries, action.now);
  }
}

export function summarizePendingCommands(entries: PendingCommandEntry[]): PendingCommandSummary {
  const summary: PendingCommandSummary = { total: entries.length, sent: 0, succeeded: 0, failed: 0, timeout: 0, unknownAfterDisconnect: 0 };
  for (const entry of entries) {
    if (entry.status === "sent") summary.sent += 1;
    else if (entry.status === "succeeded") summary.succeeded += 1;
    else if (entry.status === "failed") summary.failed += 1;
    else if (entry.status === "timeout") summary.timeout += 1;
    else if (entry.status === "unknown_after_disconnect") summary.unknownAfterDisconnect += 1;
    if (!summary.latest || entry.updatedAt > summary.latest.updatedAt || (entry.updatedAt === summary.latest.updatedAt && entry.sentAt > summary.latest.sentAt)) {
      summary.latest = entry;
    }
  }
  return summary;
}

export function latestVisiblePendingCommandForTarget(
  entries: PendingCommandEntry[],
  target: { runtimeId?: string; projectId?: string },
): PendingCommandEntry | undefined {
  return entries
    .filter((entry) => shouldShowCommandInComposer(entry, target))
    .sort((left, right) => right.updatedAt - left.updatedAt || right.sentAt - left.sentAt)[0];
}

function shouldShowCommandInComposer(entry: PendingCommandEntry, target: { runtimeId?: string; projectId?: string }): boolean {
  if (entry.status === "succeeded") return false;
  if (!CRITICAL_COMPOSER_COMMANDS.has(entry.command)) return false;
  if (target.runtimeId && entry.target.runtimeId === target.runtimeId) return true;
  if (target.projectId && entry.target.projectId === target.projectId) return true;
  return false;
}

function entryFromCommand(command: ClientCommand & { requestId: string }, now: number, timeoutMs = DEFAULT_PENDING_COMMAND_TIMEOUT_MS): PendingCommandEntry {
  return {
    requestId: command.requestId,
    command: command.type,
    target: commandTarget(command),
    status: "sent",
    sentAt: now,
    updatedAt: now,
    timeoutAt: now + timeoutMs,
  };
}

function applyCommandResult(entries: PendingCommandEntry[], result: Extract<ServerEvent, { type: "command.result" }>, now: number): PendingCommandEntry[] {
  if (!result.requestId) return entries;
  let matched = false;
  const next = entries.map((entry) => {
    if (entry.requestId !== result.requestId) return entry;
    matched = true;
    return {
      ...entry,
      status: result.success ? "succeeded" : "failed",
      updatedAt: now,
      result,
      error: result.error,
    } satisfies PendingCommandEntry;
  });
  return matched ? next : entries;
}

function upsertPendingCommandEntry(entries: PendingCommandEntry[], nextEntry: PendingCommandEntry): PendingCommandEntry[] {
  const existingIndex = entries.findIndex((entry) => entry.requestId === nextEntry.requestId);
  if (existingIndex < 0) return [...entries, nextEntry];
  return entries.map((entry, index) => (index === existingIndex ? nextEntry : entry));
}

function prunePendingCommandEntries(entries: PendingCommandEntry[], now: number): PendingCommandEntry[] {
  const retained = entries.filter((entry) => entry.status === "sent" || entry.status === "timeout" || entry.status === "unknown_after_disconnect" || now - entry.updatedAt <= COMPLETED_PENDING_COMMAND_TTL_MS);
  if (retained.length <= MAX_PENDING_COMMAND_ENTRIES) return retained;
  return retained.sort((left, right) => right.updatedAt - left.updatedAt || right.sentAt - left.sentAt).slice(0, MAX_PENDING_COMMAND_ENTRIES);
}

function commandTarget(command: ClientCommand): PendingCommandTarget {
  const target: PendingCommandTarget = {};
  if ("projectId" in command && typeof command.projectId === "string") target.projectId = command.projectId;
  if ("runtimeId" in command && typeof command.runtimeId === "string") target.runtimeId = command.runtimeId;
  if ("sessionId" in command && typeof command.sessionId === "string") target.sessionId = command.sessionId;
  if ("snapshotId" in command && typeof command.snapshotId === "string") target.checkpointSnapshotId = command.snapshotId;
  if ("cwd" in command && typeof command.cwd === "string") target.cwd = command.cwd;
  return target;
}
