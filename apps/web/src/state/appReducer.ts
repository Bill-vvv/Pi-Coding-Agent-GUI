import type {
  AppSettings,
  ConversationContextUsage,
  ConversationMessage,
  GuiEvent,
  GuiSession,
  ResponseMode,
  Runtime,
  RuntimeConversationSummary,
  ServerEvent,
  ThinkingLevel,
  Project,
} from "@pi-gui/shared";
import { isRecord } from "@pi-gui/shared";
import { upsertById } from "../domain/collections";
import { indexConversationSummaries } from "../domain/conversationSummary";
import { applyConversationDelta, upsertConversationMessage } from "../domain/conversationState";
import { firstVisibleRuntime } from "../domain/runtime";

export type AppState = {
  projects: Project[];
  runtimes: Runtime[];
  messagesByRuntime: Record<string, ConversationMessage[]>;
  persistedConversationSummaries: Record<string, RuntimeConversationSummary>;
  contextUsageByRuntime: Record<string, ConversationContextUsage>;
  busyByRuntime: Record<string, boolean>;
  guiEvents: GuiEvent[];
  sessions: GuiSession[];
  selectedProjectId?: string;
  selectedRuntimeId?: string;
  projectCwd: string;
  settings: AppSettings;
  selectedModelKey: string;
  selectedThinkingLevel: ThinkingLevel;
  responseMode: ResponseMode;
  lastError?: string;
  showArchived: boolean;
};

export const initialAppState: AppState = {
  projects: [],
  runtimes: [],
  messagesByRuntime: {},
  persistedConversationSummaries: {},
  contextUsageByRuntime: {},
  busyByRuntime: {},
  guiEvents: [],
  sessions: [],
  projectCwd: "",
  settings: {},
  selectedModelKey: "",
  selectedThinkingLevel: "medium",
  responseMode: "normal",
  showArchived: false,
};

export type AppAction =
  | { type: "server.event"; event: ServerEvent; fallbackModelKey?: string }
  | { type: "set.lastError"; error?: string }
  | { type: "set.projectCwd"; cwd: string }
  | { type: "select.project"; projectId?: string }
  | { type: "select.runtime"; projectId: string; runtimeId: string }
  | { type: "select.model"; modelKey: string; responseMode?: ResponseMode }
  | { type: "select.thinkingLevel"; thinkingLevel: ThinkingLevel }
  | { type: "select.responseMode"; responseMode: ResponseMode };

export function appReducer(state: AppState, action: AppAction): AppState {
  switch (action.type) {
    case "server.event":
      return applyServerEvent(state, action.event, action.fallbackModelKey);
    case "set.lastError":
      return { ...state, lastError: action.error };
    case "set.projectCwd":
      return { ...state, projectCwd: action.cwd };
    case "select.project":
      return { ...state, selectedProjectId: action.projectId };
    case "select.runtime":
      return { ...state, selectedProjectId: action.projectId, selectedRuntimeId: action.runtimeId };
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
    case "hello":
      return applySettingsState(
        {
          ...state,
          projects: event.projects,
          runtimes: event.runtimes,
          persistedConversationSummaries: indexConversationSummaries(event.conversationSummaries ?? []),
          sessions: event.sessions ?? state.sessions,
          selectedProjectId: state.selectedProjectId ?? event.projects[0]?.id,
          selectedRuntimeId: state.selectedRuntimeId ?? firstVisibleRuntime(event.runtimes)?.id,
        },
        event.settings,
        fallbackModelKey,
      );
    case "project.list":
      return {
        ...state,
        projects: event.projects,
        selectedProjectId: state.selectedProjectId ?? event.projects[0]?.id,
      };
    case "project.created":
      return {
        ...state,
        projects: upsertById(state.projects, event.project),
        selectedProjectId: event.project.id,
      };
    case "session.list":
      return { ...state, sessions: event.sessions };
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
    case "command.result":
      return applyCommandResult(state, event);
    case "gui.event":
      return {
        ...state,
        guiEvents: upsertGuiEvent(state.guiEvents, event.event),
      };
  }
}

function upsertGuiEvent(events: GuiEvent[], event: GuiEvent): GuiEvent[] {
  const existingIndex = events.findIndex((item) => item.id === event.id);
  const next = existingIndex >= 0 ? events.map((item) => (item.id === event.id ? event : item)) : [...events, event];
  next.sort((left, right) => left.id - right.id);
  return next.slice(-500);
}

function applyRuntimeStatus(state: AppState, runtime: Runtime): AppState {
  const nextState: AppState = {
    ...state,
    runtimes: upsertById(state.runtimes, runtime),
  };

  if (runtime.status === "stopped" || runtime.status === "crashed") {
    return {
      ...nextState,
      busyByRuntime: { ...nextState.busyByRuntime, [runtime.id]: false },
    };
  }

  return nextState;
}

function applyCommandResult(state: AppState, event: Extract<ServerEvent, { type: "command.result" }>): AppState {
  if (!event.success) {
    return { ...state, lastError: event.error ?? "命令执行失败" };
  }

  if ((event.command === "runtime.start" || event.command === "runtime.resume") && isRecord(event.data) && isRecord(event.data.runtime)) {
    const runtime = event.data.runtime;
    const runtimeId = typeof runtime.id === "string" ? runtime.id : undefined;
    if (!runtimeId) return state;
    const projectId = typeof runtime.projectId === "string" ? runtime.projectId : undefined;
    return {
      ...state,
      selectedRuntimeId: runtimeId,
      selectedProjectId: projectId ?? state.selectedProjectId,
    };
  }

  if (event.command === "runtime.archive") {
    return { ...state, selectedRuntimeId: undefined };
  }

  return state;
}

function applySettingsState(state: AppState, settings: AppSettings, fallbackModelKey?: string): AppState {
  return {
    ...state,
    settings,
    selectedModelKey: settings.defaultModel ?? fallbackModelKey ?? "",
    selectedThinkingLevel: settings.defaultThinkingLevel ?? "medium",
    responseMode: settings.responseMode ?? "normal",
  };
}
