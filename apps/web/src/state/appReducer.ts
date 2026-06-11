import type {
  AppSettings,
  ConversationContextUsage,
  ConversationDelta,
  ConversationMessage,
  ExecutionHostRef,
  GuiEvent,
  GuiSession,
  RewindCheckpointOperation,
  RewindCheckpointPreview,
  RewindCheckpointRestoreResult,
  RewindCheckpointSummary,
  RewindGarbageCollectResult,
  RewindJumpHistoryEntry,
  RewindStorageHealth,
  ResponseMode,
  Runtime,
  RuntimeConversationSummary,
  RuntimeQueue,
  ServerEvent,
  SlashCommand,
  SubagentRun,
  ThinkingLevel,
  Project,
} from "@pi-gui/shared";
import { isRecord } from "@pi-gui/shared";
import { upsertById } from "../domain/collections";
import { isTransportConnectionError } from "../domain/connection";
import { indexConversationSummaries } from "../domain/conversationSummary";
import { applyConversationDeltas, applyConversationDelta, evictInactiveRuntimeMessages, mergeConversationSnapshot, prependConversationPage, rememberHydratedRuntime, upsertConversationMessage } from "../domain/conversationState";
import { applyExtensionUiChromeRequest, extensionUiChromeRequestFromPayload, type ExtensionUiChromeByRuntime } from "../domain/extensionUiChrome";
import { subagentDetailKey } from "../domain/subagents";

export type ReplayRecoveryState = {
  status: "degraded" | "resyncing";
  sequence: number;
  detectedAt: number;
  gap: Extract<ServerEvent, { type: "event.replay.gap" }>;
  requestedAt?: number;
};

export type AppState = {
  projects: Project[];
  runtimes: Runtime[];
  messagesByRuntime: Record<string, ConversationMessage[]>;
  hydratedRuntimeIds: string[];
  hasMoreBeforeByRuntime: Record<string, boolean>;
  persistedConversationSummaries: Record<string, RuntimeConversationSummary>;
  contextUsageByRuntime: Record<string, ConversationContextUsage>;
  busyByRuntime: Record<string, boolean>;
  queueByRuntime: Record<string, RuntimeQueue>;
  commandsByRuntime: Record<string, SlashCommand[]>;
  extensionUiByRuntime: ExtensionUiChromeByRuntime;
  guiEvents: GuiEvent[];
  sessions: GuiSession[];
  checkpointsByProject: Record<string, RewindCheckpointSummary[]>;
  checkpointPreviewsBySnapshot: Record<string, RewindCheckpointPreview>;
  checkpointRestoreResultsBySnapshot: Record<string, RewindCheckpointRestoreResult>;
  checkpointOperations: RewindCheckpointOperation[];
  checkpointJumpsByProject: Record<string, RewindJumpHistoryEntry[]>;
  checkpointHealthByProject: Record<string, RewindStorageHealth>;
  checkpointGcResultsByProject: Record<string, RewindGarbageCollectResult>;
  subagentRuns: Record<string, SubagentRun>;
  subagentDetails: Record<string, { childRunId: string; messages: ConversationMessage[]; readAt: number; error?: string }>;
  executionHost?: ExecutionHostRef;
  selectedProjectId?: string;
  selectedRuntimeId?: string;
  selectedRuntimeIdByProject: Record<string, string>;
  projectCwd: string;
  settings: AppSettings;
  selectedModelKey: string;
  selectedThinkingLevel: ThinkingLevel;
  responseMode: ResponseMode;
  operationError?: string;
  notice?: string;
  replayRecovery?: ReplayRecoveryState;
};

export const initialAppState: AppState = {
  projects: [],
  runtimes: [],
  messagesByRuntime: {},
  hydratedRuntimeIds: [],
  hasMoreBeforeByRuntime: {},
  persistedConversationSummaries: {},
  contextUsageByRuntime: {},
  busyByRuntime: {},
  queueByRuntime: {},
  commandsByRuntime: {},
  extensionUiByRuntime: {},
  guiEvents: [],
  sessions: [],
  checkpointsByProject: {},
  checkpointPreviewsBySnapshot: {},
  checkpointRestoreResultsBySnapshot: {},
  checkpointOperations: [],
  checkpointJumpsByProject: {},
  checkpointHealthByProject: {},
  checkpointGcResultsByProject: {},
  subagentRuns: {},
  subagentDetails: {},
  selectedRuntimeIdByProject: {},
  projectCwd: "",
  settings: {},
  selectedModelKey: "",
  selectedThinkingLevel: "medium",
  responseMode: "normal",
};

export type AppAction =
  | { type: "server.event"; event: ServerEvent; fallbackModelKey?: string }
  | { type: "server.deltaBatch"; deltas: ConversationDelta[] }
  | { type: "set.operationError"; error?: string }
  | { type: "clear.operationError"; error?: string }
  | { type: "set.notice"; notice?: string }
  | { type: "clear.notice"; notice?: string }
  | { type: "clear.transportError" }
  | { type: "replayRecovery.resyncRequested"; sequence: number }
  | { type: "set.projectCwd"; cwd: string }
  | { type: "select.project"; projectId?: string }
  | { type: "select.runtime"; projectId: string; runtimeId: string }
  | { type: "update.runtimeConfig"; runtimeId: string; model?: string; thinkingLevel?: ThinkingLevel; responseMode?: ResponseMode }
  | { type: "select.model"; modelKey: string; responseMode?: ResponseMode }
  | { type: "select.thinkingLevel"; thinkingLevel: ThinkingLevel }
  | { type: "select.responseMode"; responseMode: ResponseMode };

export function appReducer(state: AppState, action: AppAction): AppState {
  switch (action.type) {
    case "server.event":
      return applyServerEvent(state, action.event, action.fallbackModelKey);
    case "server.deltaBatch":
      return applyConversationDeltaBatch(state, action.deltas);
    case "set.operationError":
      return { ...state, operationError: action.error };
    case "clear.operationError":
      return action.error !== undefined && state.operationError !== action.error ? state : { ...state, operationError: undefined };
    case "set.notice":
      return { ...state, notice: action.notice };
    case "clear.notice":
      return action.notice !== undefined && state.notice !== action.notice ? state : { ...state, notice: undefined };
    case "clear.transportError":
      return isTransportConnectionError(state.operationError) ? { ...state, operationError: undefined } : state;
    case "replayRecovery.resyncRequested":
      return state.replayRecovery?.sequence === action.sequence
        ? { ...state, replayRecovery: { ...state.replayRecovery, status: "resyncing", requestedAt: Date.now() } }
        : state;
    case "set.projectCwd":
      return { ...state, projectCwd: action.cwd };
    case "select.project": {
      const selectedRuntimeId = preferredRuntimeIdForProject(state.runtimes, action.projectId, [
        action.projectId ? state.selectedRuntimeIdByProject[action.projectId] : undefined,
      ]);
      return {
        ...state,
        projectCwd: "",
        selectedProjectId: action.projectId,
        selectedRuntimeId,
        selectedRuntimeIdByProject: seedSelectedRuntimeMap(state.selectedRuntimeIdByProject, action.projectId, selectedRuntimeId),
      };
    }
    case "select.runtime": {
      const hydratedRuntimeIds = rememberHydratedRuntime(state.hydratedRuntimeIds, action.runtimeId);
      return {
        ...state,
        projectCwd: "",
        selectedProjectId: action.projectId,
        selectedRuntimeId: action.runtimeId,
        selectedRuntimeIdByProject: { ...state.selectedRuntimeIdByProject, [action.projectId]: action.runtimeId },
        hydratedRuntimeIds,
        messagesByRuntime: evictInactiveRuntimeMessages(state.messagesByRuntime, hydratedRuntimeIds, action.runtimeId),
      };
    }
    case "update.runtimeConfig":
      return {
        ...state,
        runtimes: state.runtimes.map((runtime) =>
          runtime.id === action.runtimeId
            ? {
                ...runtime,
                model: action.model ?? runtime.model,
                thinkingLevel: action.thinkingLevel ?? runtime.thinkingLevel,
                responseMode: action.responseMode ?? runtime.responseMode,
              }
            : runtime,
        ),
      };
    case "select.model":
      return {
        ...state,
        selectedModelKey: action.modelKey,
        responseMode: action.responseMode ?? state.responseMode,
      };
    case "select.thinkingLevel":
      return { ...state, selectedThinkingLevel: action.thinkingLevel };
    case "select.responseMode":
      return { ...state, responseMode: action.responseMode };
  }
}

function applyConversationDeltaBatch(state: AppState, deltas: ConversationDelta[]): AppState {
  if (deltas.length === 0) return state;
  const grouped = new Map<string, ConversationDelta[]>();
  for (const delta of deltas) {
    const items = grouped.get(delta.runtimeId) ?? [];
    items.push(delta);
    grouped.set(delta.runtimeId, items);
  }

  let messagesByRuntime = state.messagesByRuntime;
  let hydratedRuntimeIds = state.hydratedRuntimeIds;
  for (const [runtimeId, runtimeDeltas] of grouped) {
    if (messagesByRuntime === state.messagesByRuntime) messagesByRuntime = { ...state.messagesByRuntime };
    messagesByRuntime[runtimeId] = applyConversationDeltas(messagesByRuntime[runtimeId] ?? [], runtimeDeltas);
    hydratedRuntimeIds = rememberHydratedRuntime(hydratedRuntimeIds, runtimeId);
  }

  return {
    ...state,
    hydratedRuntimeIds,
    messagesByRuntime: evictInactiveRuntimeMessages(messagesByRuntime, hydratedRuntimeIds, state.selectedRuntimeId),
  };
}

function applyServerEvent(state: AppState, event: ServerEvent, fallbackModelKey?: string): AppState {
  switch (event.type) {
    case "connection.ready":
    case "bootstrap.begin":
    case "bootstrap.complete":
    case "replay.complete":
      return state;
    case "hello": {
      let nextState: AppState = { ...state, replayRecovery: undefined, executionHost: event.executionHost ?? state.executionHost };
      if (event.projects && event.runtimes) nextState = applyProjectsAndRuntimesSnapshot(nextState, event.projects, event.runtimes, event.executionHost);
      else {
        if (event.projects) nextState = applyProjectsSnapshot(nextState, event.projects, event.executionHost);
        if (event.runtimes) nextState = applyRuntimesSnapshot(nextState, event.runtimes);
      }
      if (event.conversationSummaries) nextState = { ...nextState, persistedConversationSummaries: indexConversationSummaries(event.conversationSummaries) };
      if (event.sessions) nextState = { ...nextState, sessions: event.sessions };
      if (event.checkpointOperations || event.checkpointJumps) {
        nextState = {
          ...nextState,
          checkpointOperations: mergeCheckpointOperations(nextState.checkpointOperations, event.checkpointOperations ?? []),
          checkpointJumpsByProject: mergeCheckpointJumpsByProject(nextState.checkpointJumpsByProject, event.checkpointJumps ?? []),
        };
      }
      if (event.subagentRuns) nextState = { ...nextState, subagentRuns: indexSubagentRuns(event.subagentRuns) };
      return event.settings ? applySettingsState(nextState, event.settings, fallbackModelKey) : nextState;
    }
    case "bootstrap.chunk": {
      switch (event.scope) {
        case "projects":
          return applyProjectsSnapshot(state, event.projects, event.executionHost);
        case "runtimes":
          return applyRuntimesSnapshot(state, event.runtimes);
        case "settings":
          return applySettingsState(state, event.settings, fallbackModelKey);
        case "sessions":
          return { ...state, sessions: mergeSessionList(state.sessions, event.sessions, undefined, undefined) };
        case "conversationSummaries":
          return { ...state, persistedConversationSummaries: indexConversationSummaries(event.conversationSummaries) };
        case "subagents":
          return { ...state, subagentRuns: indexSubagentRuns(event.subagentRuns) };
        case "checkpoints":
          return {
            ...state,
            checkpointOperations: mergeCheckpointOperations(state.checkpointOperations, event.checkpointOperations),
            checkpointJumpsByProject: mergeCheckpointJumpsByProject(state.checkpointJumpsByProject, event.checkpointJumps),
          };
      }
    }
    case "project.list": {
      const nextProjectId = event.projects.some((project) => project.id === state.selectedProjectId) ? state.selectedProjectId : event.projects[0]?.id;
      const nextRuntimeMap = reconcileSelectedRuntimeMap(state.selectedRuntimeIdByProject, state.runtimes);
      const nextRuntimeId = preferredRuntimeIdForProject(state.runtimes, nextProjectId, [
        state.selectedRuntimeId,
        nextProjectId ? nextRuntimeMap[nextProjectId] : undefined,
      ]);
      return {
        ...state,
        projects: event.projects,
        selectedProjectId: nextProjectId,
        selectedRuntimeId: nextRuntimeId,
        selectedRuntimeIdByProject: seedSelectedRuntimeMap(nextRuntimeMap, nextProjectId, nextRuntimeId),
      };
    }
    case "project.created":
      return {
        ...state,
        projectCwd: state.projectCwd.trim() === event.project.cwd ? "" : state.projectCwd,
        projects: upsertById(state.projects, event.project),
        selectedProjectId: event.project.id,
        selectedRuntimeId: undefined,
      };
    case "session.list":
      return { ...state, sessions: mergeSessionList(state.sessions, event.sessions, event.projectId, event.cursor), replayRecovery: undefined };
    case "session.updated":
      return { ...state, sessions: upsertById(state.sessions, event.session) };
    case "settings.updated":
      return applySettingsState(state, event.settings, fallbackModelKey);
    case "runtime.status":
      return applyRuntimeStatus(state, event.runtime);
    case "conversation.snapshot": {
      const hydratedRuntimeIds = rememberHydratedRuntime(state.hydratedRuntimeIds, event.runtimeId);
      return {
        ...state,
        hydratedRuntimeIds,
        messagesByRuntime: evictInactiveRuntimeMessages(
          { ...state.messagesByRuntime, [event.runtimeId]: mergeConversationSnapshot(state.messagesByRuntime[event.runtimeId] ?? [], event.messages) },
          hydratedRuntimeIds,
          state.selectedRuntimeId,
        ),
        hasMoreBeforeByRuntime: { ...state.hasMoreBeforeByRuntime, [event.runtimeId]: event.hasMoreBefore },
        busyByRuntime: { ...state.busyByRuntime, [event.runtimeId]: event.busy },
        contextUsageByRuntime: event.contextUsage
          ? { ...state.contextUsageByRuntime, [event.runtimeId]: event.contextUsage }
          : state.contextUsageByRuntime,
        replayRecovery: undefined,
      };
    }
    case "conversation.page":
      return {
        ...state,
        messagesByRuntime: {
          ...state.messagesByRuntime,
          [event.runtimeId]: prependConversationPage(state.messagesByRuntime[event.runtimeId] ?? [], event.messages),
        },
        hasMoreBeforeByRuntime: { ...state.hasMoreBeforeByRuntime, [event.runtimeId]: event.hasMoreBefore },
      };
    case "conversation.message": {
      const hydratedRuntimeIds = rememberHydratedRuntime(state.hydratedRuntimeIds, event.message.runtimeId);
      return {
        ...state,
        hydratedRuntimeIds,
        messagesByRuntime: evictInactiveRuntimeMessages(
          {
            ...state.messagesByRuntime,
            [event.message.runtimeId]: upsertConversationMessage(state.messagesByRuntime[event.message.runtimeId] ?? [], event.message),
          },
          hydratedRuntimeIds,
          state.selectedRuntimeId,
        ),
      };
    }
    case "conversation.delta":
      return applyConversationDeltaBatch(state, [event.delta]);
    case "conversation.context":
      return {
        ...state,
        contextUsageByRuntime: { ...state.contextUsageByRuntime, [event.runtimeId]: event.contextUsage },
      };
    case "conversation.busy":
      return {
        ...state,
        busyByRuntime: { ...state.busyByRuntime, [event.runtimeId]: event.busy },
      };
    case "checkpoint.list":
      return {
        ...state,
        checkpointsByProject: { ...state.checkpointsByProject, [event.projectId]: event.checkpoints },
      };
    case "checkpoint.captured":
      return {
        ...state,
        checkpointsByProject: {
          ...state.checkpointsByProject,
          [event.projectId]: upsertCheckpointSummary(state.checkpointsByProject[event.projectId] ?? [], event.checkpoint),
        },
      };
    case "checkpoint.preview":
      return {
        ...state,
        checkpointPreviewsBySnapshot: { ...state.checkpointPreviewsBySnapshot, [event.preview.snapshotId]: event.preview },
      };
    case "checkpoint.restored":
      return {
        ...state,
        checkpointRestoreResultsBySnapshot: { ...state.checkpointRestoreResultsBySnapshot, [event.result.snapshotId]: event.result },
        notice: checkpointRestoreNotice(event.result),
      };
    case "checkpoint.operation":
      return {
        ...state,
        checkpointOperations: mergeCheckpointOperations(state.checkpointOperations, [event.operation]),
      };
    case "checkpoint.jumps":
      return {
        ...state,
        checkpointJumpsByProject: { ...state.checkpointJumpsByProject, [event.projectId]: event.jumps },
      };
    case "checkpoint.health":
      return {
        ...state,
        checkpointHealthByProject: { ...state.checkpointHealthByProject, [event.projectId]: event.health },
      };
    case "checkpoint.gc":
      return {
        ...state,
        checkpointGcResultsByProject: { ...state.checkpointGcResultsByProject, [event.projectId]: event.result },
        checkpointHealthByProject: { ...state.checkpointHealthByProject, [event.projectId]: event.result },
        notice: event.result.dryRun ? "已完成 Rewind 存储清理预览" : "已清理 Rewind 存储",
      };
    case "runtime.queue":
      return {
        ...state,
        queueByRuntime: { ...state.queueByRuntime, [event.runtimeId]: event.queue },
      };
    case "runtime.commands":
      return {
        ...state,
        commandsByRuntime: { ...state.commandsByRuntime, [event.runtimeId]: event.commands },
        replayRecovery: undefined,
      };
    case "runtime.logs":
      return state;
    case "runtime.rpc.response":
      return state;
    case "extension.ui.request":
      return {
        ...state,
        extensionUiByRuntime: applyExtensionUiChromeRequest(state.extensionUiByRuntime, event.runtimeId, event.request),
      };
    case "subagent.snapshot":
      return { ...state, subagentRuns: mergeSubagentRuns(state.subagentRuns, event.runs) };
    case "subagent.run":
      return { ...state, subagentRuns: { ...state.subagentRuns, [event.run.id]: event.run } };
    case "subagent.detail":
      return {
        ...state,
        subagentDetails: {
          ...state.subagentDetails,
          [subagentDetailKey(event.runId, event.childRunId)]: {
            childRunId: event.childRunId,
            messages: event.messages,
            readAt: event.readAt,
            error: event.error,
          },
        },
      };
    case "command.result":
      return applyCommandResult(state, event);
    case "event.replay.gap":
      return {
        ...state,
        notice: replayGapNotice(event),
        replayRecovery: {
          status: "degraded",
          sequence: (state.replayRecovery?.sequence ?? 0) + 1,
          detectedAt: Date.now(),
          gap: event,
        },
      };
    case "gui.event":
      return applyGuiEvent(state, event.event);
  }
}

function replayGapNotice(event: Extract<ServerEvent, { type: "event.replay.gap" }>): string {
  const reason = event.reason === "pruned" ? "部分较早事件已被清理" : event.reason === "truncated" ? "离线期间事件过多，已截断回放" : "事件回放游标已过期";
  return `${reason}；连接已部分恢复，正在请求最新快照重新同步，并回放最近 ${event.replayedEvents} 条事件。`;
}

function applyProjectsAndRuntimesSnapshot(state: AppState, projects: Project[], runtimes: Runtime[], executionHost?: ExecutionHostRef): AppState {
  const nextProjectId = projects.some((project) => project.id === state.selectedProjectId) ? state.selectedProjectId : projects[0]?.id;
  const nextRuntimeMap = reconcileSelectedRuntimeMap(state.selectedRuntimeIdByProject, runtimes);
  const nextRuntimeId = preferredRuntimeIdForProject(runtimes, nextProjectId, [
    state.selectedRuntimeId,
    nextProjectId ? nextRuntimeMap[nextProjectId] : undefined,
  ]);
  return {
    ...state,
    projects,
    runtimes,
    executionHost: executionHost ?? state.executionHost,
    selectedProjectId: nextProjectId,
    selectedRuntimeId: nextRuntimeId,
    selectedRuntimeIdByProject: seedSelectedRuntimeMap(nextRuntimeMap, nextProjectId, nextRuntimeId),
  };
}

function applyProjectsSnapshot(state: AppState, projects: Project[], executionHost?: ExecutionHostRef): AppState {
  const nextProjectId = projects.some((project) => project.id === state.selectedProjectId) ? state.selectedProjectId : projects[0]?.id;
  const nextRuntimeMap = reconcileSelectedRuntimeMap(state.selectedRuntimeIdByProject, state.runtimes);
  const nextRuntimeId = preferredRuntimeIdForProject(state.runtimes, nextProjectId, [
    state.selectedRuntimeId,
    nextProjectId ? nextRuntimeMap[nextProjectId] : undefined,
  ]);
  return {
    ...state,
    projects,
    executionHost: executionHost ?? state.executionHost,
    selectedProjectId: nextProjectId,
    selectedRuntimeId: nextRuntimeId,
    selectedRuntimeIdByProject: seedSelectedRuntimeMap(nextRuntimeMap, nextProjectId, nextRuntimeId),
  };
}

function applyRuntimesSnapshot(state: AppState, runtimes: Runtime[]): AppState {
  const nextProjectId = state.projects.some((project) => project.id === state.selectedProjectId) ? state.selectedProjectId : state.projects[0]?.id;
  const nextRuntimeMap = reconcileSelectedRuntimeMap(state.selectedRuntimeIdByProject, runtimes);
  const nextRuntimeId = preferredRuntimeIdForProject(runtimes, nextProjectId, [
    state.selectedRuntimeId,
    nextProjectId ? nextRuntimeMap[nextProjectId] : undefined,
  ]);
  return {
    ...state,
    runtimes,
    selectedProjectId: nextProjectId,
    selectedRuntimeId: nextRuntimeId,
    selectedRuntimeIdByProject: seedSelectedRuntimeMap(nextRuntimeMap, nextProjectId, nextRuntimeId),
  };
}

function mergeSessionList(currentSessions: GuiSession[], nextSessions: GuiSession[], projectId?: string, cursor?: string): GuiSession[] {
  const retainedSessions = cursor ? currentSessions : projectId ? currentSessions.filter((session) => session.projectId !== projectId) : [];
  const byId = new Map(retainedSessions.map((session) => [session.id, session]));
  for (const session of nextSessions) byId.set(session.id, session);
  return [...byId.values()].sort((left, right) => right.updatedAt - left.updatedAt || right.id.localeCompare(left.id));
}

function indexSubagentRuns(runs: SubagentRun[]): Record<string, SubagentRun> {
  return Object.fromEntries(runs.map((run) => [run.id, run]));
}

function upsertCheckpointSummary(current: RewindCheckpointSummary[], checkpoint: RewindCheckpointSummary): RewindCheckpointSummary[] {
  const byId = new Map(current.map((item) => [item.id, item]));
  byId.set(checkpoint.id, checkpoint);
  return [...byId.values()].sort((left, right) => right.createdAt - left.createdAt || right.id.localeCompare(left.id));
}

function mergeCheckpointOperations(current: RewindCheckpointOperation[], operations: RewindCheckpointOperation[]): RewindCheckpointOperation[] {
  if (operations.length === 0) return current;
  const byId = new Map(current.map((operation) => [operation.id, operation]));
  for (const operation of operations) byId.set(operation.id, operation);
  return [...byId.values()].sort((left, right) => left.id - right.id).slice(-50);
}

function mergeCheckpointJumpsByProject(current: Record<string, RewindJumpHistoryEntry[]>, jumps: RewindJumpHistoryEntry[]): Record<string, RewindJumpHistoryEntry[]> {
  if (jumps.length === 0) return current;
  const next = { ...current };
  for (const jump of jumps) {
    const byId = new Map((next[jump.projectId] ?? []).map((item) => [item.id, item]));
    byId.set(jump.id, jump);
    next[jump.projectId] = [...byId.values()].sort((left, right) => left.id - right.id).slice(-50);
  }
  return next;
}

function checkpointRestoreNotice(result: RewindCheckpointRestoreResult): string {
  if (result.ok) return "已恢复 checkpoint";
  return result.error ? `Checkpoint 恢复失败：${result.error}` : "Checkpoint 恢复失败";
}

function mergeSubagentRuns(current: Record<string, SubagentRun>, runs: SubagentRun[]): Record<string, SubagentRun> {
  if (runs.length === 0) return current;
  return { ...current, ...indexSubagentRuns(runs) };
}

function applyGuiEvent(state: AppState, event: GuiEvent): AppState {
  const nextState = {
    ...state,
    guiEvents: upsertGuiEvent(state.guiEvents, event),
  };

  const request = event.kind === "pi_event" ? extensionUiChromeRequestFromPayload(event.payload) : undefined;
  if (!request) return nextState;

  return {
    ...nextState,
    extensionUiByRuntime: applyExtensionUiChromeRequest(nextState.extensionUiByRuntime, event.runtimeId, request),
  };
}

function upsertGuiEvent(events: GuiEvent[], event: GuiEvent): GuiEvent[] {
  const latest = events.at(-1);
  if (!latest || event.id > latest.id) return [...events, event].slice(-500);

  const existingIndex = events.findIndex((item) => item.id === event.id);
  const next = existingIndex >= 0 ? events.map((item) => (item.id === event.id ? event : item)) : [...events, event];
  next.sort((left, right) => left.id - right.id);
  return next.slice(-500);
}

function applyRuntimeStatus(state: AppState, runtime: Runtime): AppState {
  const nextRuntimes = upsertById(state.runtimes, runtime);
  const nextRuntimeMap = reconcileSelectedRuntimeMap(state.selectedRuntimeIdByProject, nextRuntimes);
  const selectedRuntimeId = preferredRuntimeIdForProject(nextRuntimes, state.selectedProjectId, [
    state.selectedRuntimeId,
    state.selectedProjectId ? nextRuntimeMap[state.selectedProjectId] : undefined,
  ]);
  const nextState: AppState = {
    ...state,
    runtimes: nextRuntimes,
    selectedRuntimeIdByProject: seedSelectedRuntimeMap(nextRuntimeMap, state.selectedProjectId, selectedRuntimeId),
    selectedRuntimeId,
  };

  if (runtime.status === "stopped" || runtime.status === "crashed") {
    return {
      ...nextState,
      busyByRuntime: { ...nextState.busyByRuntime, [runtime.id]: false },
      queueByRuntime: { ...nextState.queueByRuntime, [runtime.id]: { steering: [], followUp: [] } },
    };
  }

  return nextState;
}

function applyCommandResult(state: AppState, event: Extract<ServerEvent, { type: "command.result" }>): AppState {
  if (!event.success) {
    return { ...state, operationError: event.error ?? "命令执行失败" };
  }

  if ((event.command === "runtime.start" || event.command === "runtime.resume" || event.command === "runtime.restart" || event.command === "session.resume") && isRecord(event.data) && isRecord(event.data.runtime)) {
    const runtime = event.data.runtime;
    const runtimeId = typeof runtime.id === "string" ? runtime.id : undefined;
    if (!runtimeId) return state;
    const projectId = typeof runtime.projectId === "string" ? runtime.projectId : undefined;
    return {
      ...state,
      projectCwd: "",
      selectedRuntimeId: runtimeId,
      selectedProjectId: projectId ?? state.selectedProjectId,
      selectedRuntimeIdByProject: projectId ? { ...state.selectedRuntimeIdByProject, [projectId]: runtimeId } : state.selectedRuntimeIdByProject,
    };
  }

  if (event.command === "runtime.archive") {
    return applyRuntimeArchiveCommandResult(state, event);
  }

  if (event.command === "runtime.archiveBlank") {
    // Guarded cleanup can succeed without archiving when the backend denies cleanup;
    // hide/reconcile only when the returned runtime confirms archivedAt.
    return applyRuntimeArchiveCommandResult(state, event, { requireArchivedAt: true });
  }

  return state;
}

function applyRuntimeArchiveCommandResult(state: AppState, event: Extract<ServerEvent, { type: "command.result" }>, options: { requireArchivedAt?: boolean } = {}): AppState {
  const runtime = isRecord(event.data) && isRecord(event.data.runtime) ? event.data.runtime : undefined;
  const archivedRuntimeId = typeof runtime?.id === "string" ? runtime.id : undefined;
  if (!archivedRuntimeId || state.selectedRuntimeId !== archivedRuntimeId) return state;
  if (options.requireArchivedAt && typeof runtime?.archivedAt !== "number") return state;

  const archivedProjectId = typeof runtime?.projectId === "string" ? runtime.projectId : state.runtimes.find((item) => item.id === archivedRuntimeId)?.projectId;
  const archivedAt = typeof runtime?.archivedAt === "number" ? runtime.archivedAt : Date.now();
  const nextRuntimes = state.runtimes.map((item) => (item.id === archivedRuntimeId ? { ...item, archivedAt } : item));
  const nextRuntimeMap = reconcileSelectedRuntimeMap(state.selectedRuntimeIdByProject, nextRuntimes);
  const selectedRuntimeId = nextRuntimes.find((item) => item.projectId === (archivedProjectId ?? state.selectedProjectId) && !item.archivedAt)?.id;

  return {
    ...state,
    runtimes: nextRuntimes,
    selectedRuntimeId,
    selectedRuntimeIdByProject: selectedRuntimeId && archivedProjectId ? { ...nextRuntimeMap, [archivedProjectId]: selectedRuntimeId } : nextRuntimeMap,
  };
}

function validRuntimeIdForProject(runtimes: Runtime[], projectId?: string, runtimeId?: string): string | undefined {
  if (!projectId || !runtimeId) return undefined;
  const runtime = runtimes.find((item) => item.id === runtimeId && item.projectId === projectId && !item.archivedAt);
  return runtime?.id;
}

function preferredRuntimeIdForProject(runtimes: Runtime[], projectId: string | undefined, runtimeIds: Array<string | undefined>): string | undefined {
  if (!projectId) return undefined;

  const visibleRuntimes = runtimes.filter((runtime) => runtime.projectId === projectId && !runtime.archivedAt);

  for (const runtimeId of runtimeIds) {
    const validRuntimeId = validRuntimeIdForProject(runtimes, projectId, runtimeId);
    if (validRuntimeId) return validRuntimeId;
  }

  const activeRuntimeId = visibleRuntimes.find((runtime) => runtime.status === "running")?.id ?? visibleRuntimes.find((runtime) => runtime.status === "starting")?.id;
  return activeRuntimeId ?? visibleRuntimes[0]?.id;
}

function seedSelectedRuntimeMap(current: Record<string, string>, projectId: string | undefined, runtimeId: string | undefined): Record<string, string> {
  if (!projectId || !runtimeId || current[projectId] === runtimeId) return current;
  return { ...current, [projectId]: runtimeId };
}

function reconcileSelectedRuntimeMap(current: Record<string, string>, runtimes: Runtime[]): Record<string, string> {
  const next: Record<string, string> = {};
  for (const [projectId, runtimeId] of Object.entries(current)) {
    if (validRuntimeIdForProject(runtimes, projectId, runtimeId)) next[projectId] = runtimeId;
  }
  return next;
}

function applySettingsState(state: AppState, settings: AppSettings, fallbackModelKey?: string): AppState {
  return {
    ...state,
    settings,
    selectedModelKey: settings.defaultModel ?? "",
    selectedThinkingLevel: settings.defaultThinkingLevel ?? "medium",
    responseMode: settings.responseMode ?? "normal",
  };
}
