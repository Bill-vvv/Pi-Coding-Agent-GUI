import type {
  AppSettings,
  ConversationContextUsage,
  ConversationMessage,
  GuiEvent,
  GuiSession,
  ResponseMode,
  Runtime,
  RuntimeConversationSummary,
  RuntimeQueue,
  ServerEvent,
  SlashCommand,
  ThinkingLevel,
  Project,
} from "@pi-gui/shared";
import { isRecord } from "@pi-gui/shared";
import { upsertById } from "../domain/collections";
import { isTransportConnectionError } from "../domain/connection";
import { indexConversationSummaries } from "../domain/conversationSummary";
import { applyConversationDelta, upsertConversationMessage } from "../domain/conversationState";

export type AppState = {
  projects: Project[];
  runtimes: Runtime[];
  messagesByRuntime: Record<string, ConversationMessage[]>;
  persistedConversationSummaries: Record<string, RuntimeConversationSummary>;
  contextUsageByRuntime: Record<string, ConversationContextUsage>;
  busyByRuntime: Record<string, boolean>;
  queueByRuntime: Record<string, RuntimeQueue>;
  commandsByRuntime: Record<string, SlashCommand[]>;
  guiEvents: GuiEvent[];
  sessions: GuiSession[];
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
  persistedConversationSummaries: {},
  contextUsageByRuntime: {},
  busyByRuntime: {},
  queueByRuntime: {},
  commandsByRuntime: {},
  guiEvents: [],
  sessions: [],
  selectedRuntimeIdByProject: {},
  projectCwd: "",
  settings: {},
  selectedModelKey: "",
  selectedThinkingLevel: "medium",
  responseMode: "normal",
};

export type AppAction =
  | { type: "server.event"; event: ServerEvent; fallbackModelKey?: string }
  | { type: "set.operationError"; error?: string }
  | { type: "clear.operationError" }
  | { type: "set.notice"; notice?: string }
  | { type: "clear.notice" }
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
    case "set.operationError":
      return { ...state, operationError: action.error };
    case "clear.operationError":
      return { ...state, operationError: undefined };
    case "set.notice":
      return { ...state, notice: action.notice };
    case "clear.notice":
      return { ...state, notice: undefined };
    case "clear.transportError":
      return isTransportConnectionError(state.operationError) ? { ...state, operationError: undefined } : state;
    case "set.projectCwd":
      return { ...state, projectCwd: action.cwd };
    case "select.project":
      return { ...state, selectedProjectId: action.projectId, selectedRuntimeId: runtimeIdForProject(state, action.projectId) };
    case "select.runtime":
      return {
        ...state,
        selectedProjectId: action.projectId,
        selectedRuntimeId: action.runtimeId,
        selectedRuntimeIdByProject: { ...state.selectedRuntimeIdByProject, [action.projectId]: action.runtimeId },
      };
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

function applyServerEvent(state: AppState, event: ServerEvent, fallbackModelKey?: string): AppState {
  switch (event.type) {
    case "hello": {
      const nextProjectId = event.projects.some((project) => project.id === state.selectedProjectId) ? state.selectedProjectId : event.projects[0]?.id;
      const nextRuntimeMap = reconcileSelectedRuntimeMap(state.selectedRuntimeIdByProject, event.runtimes);
      const nextRuntimeId = validRuntimeIdForProject(event.runtimes, nextProjectId, state.selectedRuntimeId) ?? runtimeIdForProject({ ...state, runtimes: event.runtimes, selectedRuntimeIdByProject: nextRuntimeMap }, nextProjectId);
      const seededRuntimeMap = nextProjectId && nextRuntimeId ? { ...nextRuntimeMap, [nextProjectId]: nextRuntimeId } : nextRuntimeMap;
      return applySettingsState(
        {
          ...state,
          projects: event.projects,
          runtimes: event.runtimes,
          persistedConversationSummaries: indexConversationSummaries(event.conversationSummaries ?? []),
          sessions: event.sessions ?? state.sessions,
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
      const nextRuntimeId = runtimeIdForProject(state, nextProjectId);
      return {
        ...state,
        projects: event.projects,
        selectedProjectId: nextProjectId,
        selectedRuntimeId: nextRuntimeId,
        selectedRuntimeIdByProject: nextProjectId && nextRuntimeId ? { ...state.selectedRuntimeIdByProject, [nextProjectId]: nextRuntimeId } : state.selectedRuntimeIdByProject,
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
      return { ...state, sessions: mergeSessionList(state.sessions, event.sessions, event.projectId) };
    case "session.updated":
      return { ...state, sessions: upsertById(state.sessions, event.session) };
    case "settings.updated":
      return applySettingsState(state, event.settings, fallbackModelKey);
    case "runtime.status":
      return applyRuntimeStatus(state, event.runtime);
    case "conversation.snapshot":
      return {
        ...state,
        messagesByRuntime: { ...state.messagesByRuntime, [event.runtimeId]: event.messages },
        busyByRuntime: { ...state.busyByRuntime, [event.runtimeId]: event.busy },
        contextUsageByRuntime: event.contextUsage
          ? { ...state.contextUsageByRuntime, [event.runtimeId]: event.contextUsage }
          : state.contextUsageByRuntime,
      };
    case "conversation.message":
      return {
        ...state,
        messagesByRuntime: {
          ...state.messagesByRuntime,
          [event.message.runtimeId]: upsertConversationMessage(state.messagesByRuntime[event.message.runtimeId] ?? [], event.message),
        },
      };
    case "conversation.delta":
      return {
        ...state,
        messagesByRuntime: {
          ...state.messagesByRuntime,
          [event.delta.runtimeId]: applyConversationDelta(state.messagesByRuntime[event.delta.runtimeId] ?? [], event.delta),
        },
      };
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
    case "extension.ui.request":
      return state;
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

function applyGuiEvent(state: AppState, event: GuiEvent): AppState {
  return {
    ...state,
    guiEvents: upsertGuiEvent(state.guiEvents, event),
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
  const shouldRememberRuntime = !runtime.archivedAt && (state.selectedProjectId === runtime.projectId || !state.selectedRuntimeIdByProject[runtime.projectId]);
  const nextState: AppState = {
    ...state,
    runtimes: nextRuntimes,
    selectedRuntimeIdByProject: shouldRememberRuntime
      ? { ...state.selectedRuntimeIdByProject, [runtime.projectId]: runtime.id }
      : state.selectedRuntimeIdByProject,
    selectedRuntimeId:
      shouldRememberRuntime && state.selectedProjectId === runtime.projectId
        ? runtime.id
        : validRuntimeIdForProject(nextRuntimes, state.selectedProjectId, state.selectedRuntimeId) ?? runtimeIdForProject({ ...state, runtimes: nextRuntimes }, state.selectedProjectId),
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

function runtimeIdForProject(state: AppState, projectId?: string): string | undefined {
  if (!projectId) return undefined;
  const remembered = validRuntimeIdForProject(state.runtimes, projectId, state.selectedRuntimeIdByProject[projectId]);
  if (remembered) return remembered;
  const projectRuntimes = state.runtimes.filter((runtime) => runtime.projectId === projectId && !runtime.archivedAt);
  return projectRuntimes.find((runtime) => runtime.status === "running")?.id ?? projectRuntimes[0]?.id;
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
