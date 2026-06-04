import { useRef, useState, type Dispatch } from "react";
import type { ClientCommand, ConversationMessage, Project, ResponseMode, Runtime, RuntimeConversationSummary, ServerEvent, ThinkingLevel } from "@pi-gui/shared";
import { isRecord } from "@pi-gui/shared";
import type { AppAction } from "../state/appReducer";
import type { PendingProjectStart, PendingPrompt } from "../types";

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
  send: (command: ClientCommand) => boolean;
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
    if (event.type === "project.created" && pendingProjectStartRef.current) {
      const pending = pendingProjectStartRef.current;
      pendingProjectStartRef.current = undefined;
      dispatch({ type: "set.projectCwd", cwd: "" });
      startRuntimeForProject(event.project.id, pending.message);
      return;
    }

    if (event.type !== "command.result" || !event.success) return;

    if (isRuntimeLaunchCommand(event.command) && isRecord(event.data) && isRecord(event.data.runtime) && typeof event.data.runtime.id === "string") {
      const runtime = event.data.runtime as { id: string; projectId?: unknown };
      const runtimeId = runtime.id;
      const projectId = typeof runtime.projectId === "string" ? runtime.projectId : undefined;
      markRuntimeConversationStale(runtimeId);
      if (projectId && pendingPromptRef.current?.projectId === projectId) {
        const pending = pendingPromptRef.current;
        pendingPromptRef.current = undefined;
        send({ type: "runtime.prompt", runtimeId, message: pending.message });
      }
    }
  }

  function createProjectFromCwd(cwd: string, message?: string) {
    const existingProject = projects.find((project) => project.cwd === cwd);
    if (existingProject) {
      dispatch({ type: "select.project", projectId: existingProject.id });
      startRuntimeForProject(existingProject.id, message);
      return;
    }
    pendingProjectStartRef.current = { cwd, message };
    send({ type: "project.create", cwd });
  }

  function createProjectOnly(cwd: string) {
    const normalizedCwd = cwd.trim();
    if (!normalizedCwd) return;
    const existingProject = projects.find((project) => project.cwd === normalizedCwd);
    dispatch({ type: "set.projectCwd", cwd: "" });
    if (existingProject) {
      dispatch({ type: "select.project", projectId: existingProject.id });
      return;
    }
    send({ type: "project.create", cwd: normalizedCwd });
  }

  function startRuntimeForProject(projectId: string, message?: string) {
    if (!message?.trim()) {
      const emptyRuntime = findEmptyRuntimeForProject(projectId);
      if (emptyRuntime) {
        dispatch({ type: "select.runtime", projectId, runtimeId: emptyRuntime.id });
        return;
      }
    }

    if (message?.trim()) pendingPromptRef.current = { projectId, message };
    send({
      type: "runtime.start",
      projectId,
      model: defaultRuntimeModelKey(),
      thinkingLevel: defaultThinkingLevel,
      responseMode: defaultResponseMode,
    });
  }

  function startRuntimeForSidebarProject(projectId: string) {
    dispatch({ type: "select.project", projectId });
    startRuntimeForProject(projectId);
  }

  function resumeRuntime(runtimeId: string, message?: string) {
    const runtime = runtimes.find((item) => item.id === runtimeId);
    if (!runtime) return;
    if (message?.trim()) pendingPromptRef.current = { projectId: runtime.projectId, message };
    dispatch({ type: "select.project", projectId: runtime.projectId });
    send({
      type: "runtime.resume",
      runtimeId,
    });
  }

  function restartRuntime(runtimeId: string, message?: string) {
    const runtime = runtimes.find((item) => item.id === runtimeId);
    if (!runtime) return;
    if (message?.trim()) pendingPromptRef.current = { projectId: runtime.projectId, message };
    dispatch({ type: "select.project", projectId: runtime.projectId });
    send({
      type: "runtime.restart",
      runtimeId,
      model: runtime.model ?? defaultRuntimeModelKey(),
      thinkingLevel: runtime.thinkingLevel ?? defaultThinkingLevel,
      responseMode: runtime.responseMode ?? defaultResponseMode,
    });
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
      createProjectFromCwd(projectCwd.trim(), message);
      setPrompt("");
      return;
    }

    if (activeRuntime && (activeRuntime.status === "stopped" || activeRuntime.status === "crashed")) {
      if (activeRuntime.sessionId) resumeRuntime(activeRuntime.id, message);
      else restartRuntime(activeRuntime.id, message);
      setPrompt("");
      return;
    }

    if (selectedProject) {
      startRuntimeForProject(selectedProject.id, message);
      setPrompt("");
      return;
    }

    dispatch({ type: "set.lastError", error: "请先在输入框下方选择项目文件夹" });
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
