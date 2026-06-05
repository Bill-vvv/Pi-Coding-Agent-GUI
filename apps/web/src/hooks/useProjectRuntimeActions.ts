import { useRef, useState, type Dispatch } from "react";
import type { Project, ResponseMode, Runtime, ServerEvent, ThinkingLevel } from "@pi-gui/shared";
import { isRecord } from "@pi-gui/shared";
import type { AppAction } from "../state/appReducer";
import type { GuiSocketSend, PendingProjectStart, PendingPrompt } from "../types";

type UseProjectRuntimeActionsOptions = {
  projects: Project[];
  runtimes: Runtime[];
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
  const pendingRuntimePromptRef = useRef(new Map<string, string>());
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
      if (event.command === "runtime.prompt" && event.requestId) {
        const pendingMessage = pendingRuntimePromptRef.current.get(event.requestId);
        pendingRuntimePromptRef.current.delete(event.requestId);
        restorePendingMessage(pendingMessage);
      }
      if (isRuntimeLaunchCommand(event.command) && pendingPromptRef.current && event.requestId === pendingPromptRef.current.requestId) {
        const pending = pendingPromptRef.current;
        pendingPromptRef.current = undefined;
        restorePendingMessage(pending.message);
      }
      return;
    }

    if (event.command === "runtime.prompt" && event.requestId) {
      pendingRuntimePromptRef.current.delete(event.requestId);
      return;
    }

    if (isRuntimeLaunchCommand(event.command) && isRecord(event.data) && isRecord(event.data.runtime) && typeof event.data.runtime.id === "string") {
      const runtime = event.data.runtime as { id: string; projectId?: unknown };
      const runtimeId = runtime.id;
      const projectId = typeof runtime.projectId === "string" ? runtime.projectId : undefined;
      markRuntimeConversationStale(runtimeId);
      if (projectId) dispatch({ type: "select.runtime", projectId, runtimeId });
      if (pendingPromptRef.current && event.requestId === pendingPromptRef.current.requestId && projectId === pendingPromptRef.current.projectId) {
        const pending = pendingPromptRef.current;
        pendingPromptRef.current = undefined;
        const requestId = crypto.randomUUID();
        if (send({ type: "runtime.prompt", requestId, runtimeId, message: pending.message })) {
          pendingRuntimePromptRef.current.set(requestId, pending.message);
        } else {
          restorePendingMessage(pending.message);
        }
      }
    }
  }

  function reconcilePendingActionsAfterReconnect(event: Extract<ServerEvent, { type: "hello" }>) {
    const pendingPrompt = pendingPromptRef.current;
    pendingPromptRef.current = undefined;
    restorePendingMessage(pendingPrompt?.message);
    pendingRuntimePromptRef.current.clear();

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
      const requestId = crypto.randomUUID();
      if (send({ type: "runtime.prompt", requestId, runtimeId: activeRuntime.id, message, streamingBehavior: queuedBehavior })) {
        pendingRuntimePromptRef.current.set(requestId, message);
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
