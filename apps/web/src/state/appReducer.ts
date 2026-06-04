import type {
  AppSettings,
  ConversationContextUsage,
  ConversationDelta,
  ConversationMessage,
  GuiEvent,
  GuiSession,
  RewindCheckpoint,
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
  checkpointsByProject: Record<string, RewindCheckpoint[]>;
  subagentRuns: Record<string, SubagentRun>;
  subagentDetails: Record<string, { childRunId: string; messages: ConversationMessage[]; readAt: number; error?: string }>;
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
    case "set.projectCwd":
      return { ...state, projectCwd: action.cwd };
    case "select.project":
      return { ...state, selectedProjectId: action.projectId, selectedRuntimeId: undefined };
    case "select.runtime": {
      const hydratedRuntimeIds = rememberHydratedRuntime(state.hydratedRuntimeIds, action.runtimeId);
      return {
        ...state,
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
    case "hello": {
      const nextProjectId = event.projects.some((project) => project.id === state.selectedProjectId) ? state.selectedProjectId : event.projects[0]?.id;
      const nextRuntimeMap = reconcileSelectedRuntimeMap(state.selectedRuntimeIdByProject, event.runtimes);
      const nextRuntimeId = validRuntimeIdForProject(event.runtimes, nextProjectId, state.selectedRuntimeId);
      const seededRuntimeMap = nextRuntimeMap;
      const nextSubagentRuns = event.subagentRuns ? indexSubagentRuns(event.subagentRuns) : state.subagentRuns;
      return applySettingsState(
        {
          ...state,
          projects: event.projects,
          runtimes: event.runtimes,
          persistedConversationSummaries: indexConversationSummaries(event.conversationSummaries ?? []),
          sessions: filterChildSubagentSessions(event.sessions ?? state.sessions, nextSubagentRuns),
          subagentRuns: nextSubagentRuns,
          selectedProjectId: nextProjectId,
          selectedRuntimeId: nextRuntimeId,
          selectedRuntimeIdByProject: seededRuntimeMap,
        },
        event.settings,
        fallbackModelKey,
      );
    }
    case "project.list": {
      const nextProjectId = event.projects.some((project) => project.id === state.selectedProjectId) ? state.selectedProjectId : event.projects[0]?.id;
      const nextRuntimeId = validRuntimeIdForProject(state.runtimes, nextProjectId, state.selectedRuntimeId);
      return {
        ...state,
        projects: event.projects,
        selectedProjectId: nextProjectId,
        selectedRuntimeId: nextRuntimeId,
      };
    }
    case "project.created":
      return {
        ...state,
        projects: upsertById(state.projects, event.project),
        selectedProjectId: event.project.id,
        selectedRuntimeId: undefined,
      };
    case "session.list":
      return { ...state, sessions: filterChildSubagentSessions(mergeSessionList(state.sessions, event.sessions, event.projectId), state.subagentRuns) };
    case "session.updated":
      return { ...state, sessions: filterChildSubagentSessions(upsertById(state.sessions, event.session), state.subagentRuns) };
    case "checkpoint.list":
      return {
        ...state,
        checkpointsByProject: { ...state.checkpointsByProject, [event.projectId]: event.checkpoints },
      };
    case "checkpoint.updated":
      return {
        ...state,
        checkpointsByProject: {
          ...state.checkpointsByProject,
          [event.projectId]: upsertById(state.checkpointsByProject[event.projectId] ?? [], event.checkpoint).sort((left, right) => right.createdAt - left.createdAt),
        },
      };
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
        hasMoreBeforeByRuntime: { ...state.hasMoreBeforeByRuntime, [event.runtimeId]: event.messages.length > 0 },
        busyByRuntime: { ...state.busyByRuntime, [event.runtimeId]: event.busy },
        contextUsageByRuntime: event.contextUsage
          ? { ...state.contextUsageByRuntime, [event.runtimeId]: event.contextUsage }
          : state.contextUsageByRuntime,
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
    case "runtime.queue":
      return {
        ...state,
        queueByRuntime: { ...state.queueByRuntime, [event.runtimeId]: event.queue },
      };
    case "runtime.commands":
      return {
        ...state,
        commandsByRuntime: { ...state.commandsByRuntime, [event.runtimeId]: event.commands },
      };
    case "runtime.rpc.response":
      return state;
    case "extension.ui.request":
      return {
        ...state,
        extensionUiByRuntime: applyExtensionUiChromeRequest(state.extensionUiByRuntime, event.runtimeId, event.request),
      };
    case "subagent.snapshot": {
      const nextSubagentRuns = mergeSubagentRuns(state.subagentRuns, event.runs);
      return { ...state, subagentRuns: nextSubagentRuns, sessions: filterChildSubagentSessions(state.sessions, nextSubagentRuns) };
    }
    case "subagent.run": {
      const nextSubagentRuns = { ...state.subagentRuns, [event.run.id]: event.run };
      return { ...state, subagentRuns: nextSubagentRuns, sessions: filterChildSubagentSessions(state.sessions, nextSubagentRuns) };
    }
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
    case "gui.event":
      return applyGuiEvent(state, event.event);
  }
}

function mergeSessionList(currentSessions: GuiSession[], nextSessions: GuiSession[], projectId?: string): GuiSession[] {
  const retainedSessions = projectId ? currentSessions.filter((session) => session.projectId !== projectId) : [];
  return [...retainedSessions, ...nextSessions].sort((left, right) => right.updatedAt - left.updatedAt);
}

function indexSubagentRuns(runs: SubagentRun[]): Record<string, SubagentRun> {
  return Object.fromEntries(runs.map((run) => [run.id, run]));
}

function mergeSubagentRuns(current: Record<string, SubagentRun>, runs: SubagentRun[]): Record<string, SubagentRun> {
  if (runs.length === 0) return current;
  return { ...current, ...indexSubagentRuns(runs) };
}

function filterChildSubagentSessions(sessions: GuiSession[], runs: Record<string, SubagentRun>): GuiSession[] {
  const childSessionFiles = subagentChildSessionFiles(runs);
  if (childSessionFiles.size === 0) return sessions;
  return sessions.filter((session) => !childSessionFiles.has(session.piSessionFile));
}

function subagentChildSessionFiles(runs: Record<string, SubagentRun>): Set<string> {
  const files = new Set<string>();
  for (const run of Object.values(runs)) {
    for (const child of run.runs) {
      if (child.sessionFile) files.add(child.sessionFile);
    }
  }
  return files;
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
  const existingIndex = events.findIndex((item) => item.id === event.id);
  const next = existingIndex >= 0 ? events.map((item) => (item.id === event.id ? event : item)) : [...events, event];
  next.sort((left, right) => left.id - right.id);
  return next.slice(-500);
}

function applyRuntimeStatus(state: AppState, runtime: Runtime): AppState {
  const nextRuntimes = upsertById(state.runtimes, runtime);
  const selectedRuntimeId = validRuntimeIdForProject(nextRuntimes, state.selectedProjectId, state.selectedRuntimeId);
  const selectedRuntimeIdByProject = selectedRuntimeId === state.selectedRuntimeId
    ? state.selectedRuntimeIdByProject
    : reconcileSelectedRuntimeMap(state.selectedRuntimeIdByProject, nextRuntimes);
  const nextState: AppState = {
    ...state,
    runtimes: nextRuntimes,
    selectedRuntimeIdByProject,
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
      selectedRuntimeId: runtimeId,
      selectedProjectId: projectId ?? state.selectedProjectId,
      selectedRuntimeIdByProject: projectId ? { ...state.selectedRuntimeIdByProject, [projectId]: runtimeId } : state.selectedRuntimeIdByProject,
    };
  }

  if (event.command === "runtime.archive") {
    return { ...state, selectedRuntimeId: undefined };
  }

  return state;
}

function validRuntimeIdForProject(runtimes: Runtime[], projectId?: string, runtimeId?: string): string | undefined {
  if (!projectId || !runtimeId) return undefined;
  const runtime = runtimes.find((item) => item.id === runtimeId && item.projectId === projectId && !item.archivedAt);
  return runtime?.id;
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
