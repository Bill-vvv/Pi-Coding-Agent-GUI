import { useRef, useState, type Dispatch } from "react";
import type { ConversationMessage, Project, ResponseMode, Runtime, RuntimeConversationSummary, ServerEvent, ThinkingLevel } from "@pi-gui/shared";
import { isRecord } from "@pi-gui/shared";
import type { AppAction } from "../state/appReducer";
import type { GuiSocketSend, PendingProjectStart, PendingPrompt } from "../types";

type UseProjectRuntimeActionsOptions = {
  projects: Project[];
  runtimes: Runtime[];
  messagesByRuntime: Record<string, ConversationMessage[]>;
  conversationSummaries: Record<string, RuntimeConversationSummary>;
  activeRuntime?: Runtime;
  activeRuntimeIsBusy: boolean;
  selectedProject?: Project;
  projectCwd: string;
  defaultRuntimeModelKey: () => string | undefined;
  defaultThinkingLevel: ThinkingLevel;
  defaultResponseMode: ResponseMode;
  dispatch: Dispatch<AppAction>;
  send: GuiSocketSend;
  markRuntimeConversationStale: (runtimeId: string) => void;
};

export function useProjectRuntimeActions({
  projects,
  runtimes,
  messagesByRuntime,
  conversationSummaries,
  activeRuntime,
  activeRuntimeIsBusy,
  selectedProject,
  projectCwd,
  defaultRuntimeModelKey,
  defaultThinkingLevel,
  defaultResponseMode,
  dispatch,
  send,
  markRuntimeConversationStale,
}: UseProjectRuntimeActionsOptions) {
  const pendingPromptRef = useRef<PendingPrompt | undefined>(undefined);
  const pendingProjectStartRef = useRef<PendingProjectStart | undefined>(undefined);
  const [prompt, setPrompt] = useState("");

  function handleProjectRuntimeServerEvent(event: ServerEvent) {
    if (event.type === "hello") {
      reconcilePendingActionsAfterReconnect(event);
      return;
    }

    if (event.type === "project.created" && pendingProjectStartRef.current?.cwd === event.project.cwd) {
      const pending = pendingProjectStartRef.current;
      pendingProjectStartRef.current = undefined;
      dispatch({ type: "set.projectCwd", cwd: "" });
      if (!startRuntimeForProject(event.project.id, pending.message)) restorePendingMessage(pending.message);
      return;
    }

    if (event.type !== "command.result") return;

    if (!event.success) {
      if (event.command === "project.create" && pendingProjectStartRef.current && event.requestId === pendingProjectStartRef.current.requestId) {
        const pending = pendingProjectStartRef.current;
        pendingProjectStartRef.current = undefined;
        restorePendingMessage(pending.message);
      }
      if (isRuntimeLaunchCommand(event.command) && pendingPromptRef.current && event.requestId === pendingPromptRef.current.requestId) {
        const pending = pendingPromptRef.current;
        pendingPromptRef.current = undefined;
        restorePendingMessage(pending.message);
      }
      return;
    }

    if (isRuntimeLaunchCommand(event.command) && isRecord(event.data) && isRecord(event.data.runtime) && typeof event.data.runtime.id === "string") {
      const runtime = event.data.runtime as { id: string; projectId?: unknown };
      const runtimeId = runtime.id;
      const projectId = typeof runtime.projectId === "string" ? runtime.projectId : undefined;
      markRuntimeConversationStale(runtimeId);
      if (pendingPromptRef.current && event.requestId === pendingPromptRef.current.requestId && projectId === pendingPromptRef.current.projectId) {
        const pending = pendingPromptRef.current;
        pendingPromptRef.current = undefined;
        if (!send({ type: "runtime.prompt", runtimeId, message: pending.message })) restorePendingMessage(pending.message);
      }
    }
  }

  function reconcilePendingActionsAfterReconnect(event: Extract<ServerEvent, { type: "hello" }>) {
    const pendingPrompt = pendingPromptRef.current;
    pendingPromptRef.current = undefined;
    restorePendingMessage(pendingPrompt?.message);

    const pendingProjectStart = pendingProjectStartRef.current;
    if (!pendingProjectStart) return;
    pendingProjectStartRef.current = undefined;
    const project = event.projects.find((item) => item.cwd === pendingProjectStart.cwd);
    if (!project) {
      restorePendingMessage(pendingProjectStart.message);
      return;
    }
    dispatch({ type: "set.projectCwd", cwd: "" });
    if (!startRuntimeForProject(project.id, pendingProjectStart.message)) restorePendingMessage(pendingProjectStart.message);
  }

  function restorePendingMessage(message?: string) {
    if (!message?.trim()) return;
    setPrompt((current) => (current.trim() ? current : message));
  }

  function createProjectFromCwd(cwd: string, message?: string): boolean {
    const existingProject = projects.find((project) => project.cwd === cwd);
    if (existingProject) {
      dispatch({ type: "select.project", projectId: existingProject.id });
      return startRuntimeForProject(existingProject.id, message);
    }
    const requestId = crypto.randomUUID();
    if (!send({ type: "project.create", requestId, cwd })) return false;
    pendingProjectStartRef.current = { cwd, message, requestId };
    return true;
  }

  function createProjectOnly(cwd: string): boolean {
    const normalizedCwd = cwd.trim();
    if (!normalizedCwd) return false;
    const existingProject = projects.find((project) => project.cwd === normalizedCwd);
    if (existingProject) {
      dispatch({ type: "set.projectCwd", cwd: "" });
      dispatch({ type: "select.project", projectId: existingProject.id });
      return true;
    }
    if (!send({ type: "project.create", cwd: normalizedCwd })) return false;
    dispatch({ type: "set.projectCwd", cwd: "" });
    return true;
  }

  function startRuntimeForProject(projectId: string, message?: string): boolean {
    if (!message?.trim()) {
      const emptyRuntime = findEmptyRuntimeForProject(projectId);
      if (emptyRuntime) {
        dispatch({ type: "select.runtime", projectId, runtimeId: emptyRuntime.id });
        return true;
      }
    }

    const requestId = crypto.randomUUID();
    const sent = send({
      type: "runtime.start",
      requestId,
      projectId,
      model: defaultRuntimeModelKey(),
      thinkingLevel: defaultThinkingLevel,
      responseMode: defaultResponseMode,
    });
    if (sent && message?.trim()) pendingPromptRef.current = { projectId, message, requestId };
    return sent;
  }

  function startRuntimeForSidebarProject(projectId: string) {
    dispatch({ type: "select.project", projectId });
    startRuntimeForProject(projectId);
  }

  function resumeRuntime(runtimeId: string, message?: string): boolean {
    const runtime = runtimes.find((item) => item.id === runtimeId);
    if (!runtime) return false;
    const requestId = crypto.randomUUID();
    const sent = send({
      type: "runtime.resume",
      requestId,
      runtimeId,
    });
    if (!sent) return false;
    if (message?.trim()) pendingPromptRef.current = { projectId: runtime.projectId, message, requestId };
    dispatch({ type: "select.project", projectId: runtime.projectId });
    return true;
  }

  function restartRuntime(runtimeId: string, message?: string): boolean {
    const runtime = runtimes.find((item) => item.id === runtimeId);
    if (!runtime) return false;
    const requestId = crypto.randomUUID();
    const sent = send({
      type: "runtime.restart",
      requestId,
      runtimeId,
      model: runtime.model ?? defaultRuntimeModelKey(),
      thinkingLevel: runtime.thinkingLevel ?? defaultThinkingLevel,
      responseMode: runtime.responseMode ?? defaultResponseMode,
    });
    if (!sent) return false;
    if (message?.trim()) pendingPromptRef.current = { projectId: runtime.projectId, message, requestId };
    dispatch({ type: "select.project", projectId: runtime.projectId });
    return true;
  }

  function stopRuntime() {
    if (!activeRuntime) return;
    send({ type: "runtime.stop", runtimeId: activeRuntime.id });
  }

  function archiveRuntime(runtimeId: string) {
    send({ type: "runtime.archive", runtimeId });
  }

  function submitPrompt(streamingBehavior?: "steer" | "followUp") {
    const message = prompt.trim();
    if (!message) return;

    if (activeRuntime?.status === "running") {
      const queuedBehavior = activeRuntimeIsBusy ? streamingBehavior ?? "steer" : undefined;
      if (send({ type: "runtime.prompt", runtimeId: activeRuntime.id, message, streamingBehavior: queuedBehavior })) {
        setPrompt("");
      }
      return;
    }

    if (projectCwd.trim()) {
      if (createProjectFromCwd(projectCwd.trim(), message)) setPrompt("");
      return;
    }

    if (activeRuntime && (activeRuntime.status === "stopped" || activeRuntime.status === "crashed")) {
      const sent = activeRuntime.sessionId ? resumeRuntime(activeRuntime.id, message) : restartRuntime(activeRuntime.id, message);
      if (sent) setPrompt("");
      return;
    }

    if (selectedProject) {
      if (startRuntimeForProject(selectedProject.id, message)) setPrompt("");
      return;
    }

    dispatch({ type: "set.operationError", error: "请先在输入框下方选择项目文件夹" });
  }

  function findEmptyRuntimeForProject(projectId: string) {
    const projectRuntimes = runtimes.filter((runtime) => runtime.projectId === projectId && !runtime.archivedAt);
    const activeEmptyRuntime = activeRuntime && activeRuntime.projectId === projectId && isEmptyRuntime(activeRuntime) ? activeRuntime : undefined;
    return activeEmptyRuntime ?? projectRuntimes.find(isEmptyRuntime);
  }

  function isEmptyRuntime(runtime: Runtime): boolean {
    const summary = conversationSummaries[runtime.id];
    if (summary?.messageCount) return false;

    const messages = messagesByRuntime[runtime.id] ?? [];
    return !messages.some((message) => (message.role === "user" || message.role === "assistant") && message.text.trim());
  }

  return {
    prompt,
    setPrompt,
    createProjectOnly,
    startRuntimeForSidebarProject,
    resumeRuntime,
    restartRuntime,
    stopRuntime,
    archiveRuntime,
    submitPrompt,
    handleProjectRuntimeServerEvent,
  };
}

function isRuntimeLaunchCommand(command: Extract<ServerEvent, { type: "command.result" }>["command"]): boolean {
  return command === "runtime.start" || command === "runtime.resume" || command === "runtime.restart" || command === "session.resume";
}
