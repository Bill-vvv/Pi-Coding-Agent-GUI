import { randomUUID } from "node:crypto";
import type { PiRpcCommand, Runtime, RuntimeConversationSummary, RuntimeQueue, ServerEvent, SlashCommand } from "@pi-gui/shared";
import { AppDatabase } from "../db.js";
import { runtimeConversationSummaryFromMessages } from "../db/summaries.js";
import { ConversationProjection } from "./conversationProjection.js";
import type { ManagedRuntime, RuntimeConfigOptions } from "./managedRuntime.js";
import { createPiRuntimeClient } from "./piRuntimeFactory.js";
import { applyManagedRuntimeConfiguration, requestRuntimeSlashCommands, runtimeWithConfiguredOptions, sendAbort, sendExtensionUiResponse, sendNativeRpcCommand, sendPrompt, type RuntimeConfigureOptions } from "./runtimeCommandSender.js";
import { RuntimeEventSink } from "./runtimeEventSink.js";
import { RuntimeLiveState } from "./runtimeLiveState.js";
import { handleRuntimePayload } from "./runtimePayloadHandler.js";
import { RuntimeSessionLinker } from "./runtimeSessionLinker.js";
import { requestRuntimeMessages, requestRuntimeState, requestSessionStats } from "./runtimeStateRequester.js";
import { stripModelDebugStderrLines } from "./stderrFilters.js";

type Broadcast = (event: ServerEvent) => void;

export class RuntimeSupervisor {
  private runtimes = new Map<string, ManagedRuntime>();
  private readonly events: RuntimeEventSink;
  private readonly liveState: RuntimeLiveState;
  private readonly sessionLinker: RuntimeSessionLinker;

  constructor(
    private readonly db: AppDatabase,
    private readonly broadcast: Broadcast,
  ) {
    this.events = new RuntimeEventSink(db, broadcast);
    this.liveState = new RuntimeLiveState(this.runtimes, broadcast);
    this.sessionLinker = new RuntimeSessionLinker(db, broadcast, this.runtimes);
  }

  listRuntimes(): Runtime[] {
    const persisted = this.db.listRuntimes();
    const persistedIds = new Set(persisted.map((runtime) => runtime.id));
    const merged = persisted.map((runtime) => this.runtimes.get(runtime.id)?.runtime ?? runtime);

    for (const managed of this.runtimes.values()) {
      if (!persistedIds.has(managed.runtime.id)) {
        merged.unshift(managed.runtime);
      }
    }

    return merged;
  }

  listRuntimeQueues(): Array<{ runtimeId: string; projectId: string; queue: RuntimeQueue }> {
    return this.liveState.listQueues();
  }

  listRuntimeCommands(): Array<{ runtimeId: string; projectId: string; commands: SlashCommand[] }> {
    return this.liveState.listCommands();
  }

  listRuntimeConversationSummaries(limit = 100): RuntimeConversationSummary[] {
    const boundedLimit = Math.max(1, Math.min(limit, 500));
    const summaries = new Map(this.db.listRuntimeConversationSummaries(boundedLimit).map((summary) => [summary.runtimeId, summary]));

    for (const managed of this.runtimes.values()) {
      const snapshot = managed.projection.snapshot(120);
      if (snapshot?.type !== "conversation.snapshot") continue;

      const liveSummary = runtimeConversationSummaryFromMessages(managed.runtime.id, snapshot.messages);
      if (!liveSummary) continue;

      const persistedSummary = summaries.get(liveSummary.runtimeId);
      if (!persistedSummary) {
        summaries.set(liveSummary.runtimeId, liveSummary);
        continue;
      }

      summaries.set(liveSummary.runtimeId, {
        ...liveSummary,
        title: persistedSummary.title || liveSummary.title,
        detail: liveSummary.detail ?? (liveSummary.title !== persistedSummary.title ? liveSummary.title : persistedSummary.detail),
        updatedAt: Math.max(persistedSummary.updatedAt ?? 0, liveSummary.updatedAt ?? 0) || undefined,
        messageCount: Math.max(persistedSummary.messageCount, liveSummary.messageCount),
      });
    }

    const runtimeOrder = new Map(this.listRuntimes().map((runtime, index) => [runtime.id, index]));
    return [...summaries.values()]
      .sort((left, right) => {
        const leftOrder = runtimeOrder.get(left.runtimeId) ?? Number.MAX_SAFE_INTEGER;
        const rightOrder = runtimeOrder.get(right.runtimeId) ?? Number.MAX_SAFE_INTEGER;
        return leftOrder - rightOrder || (right.updatedAt ?? 0) - (left.updatedAt ?? 0);
      })
      .slice(0, boundedLimit);
  }

  startRuntime(projectId: string, options: RuntimeConfigOptions = {}): Runtime {
    return this.createRuntime(projectId, options);
  }

  getRuntime(runtimeId: string): Runtime | undefined {
    return this.runtimes.get(runtimeId)?.runtime ?? this.db.getRuntime(runtimeId);
  }

  resumeRuntime(runtimeId: string, options: RuntimeConfigOptions = {}): Runtime {
    const managed = this.runtimes.get(runtimeId);
    if (managed) return managed.runtime;

    const sourceRuntime = this.db.getRuntime(runtimeId);
    if (!sourceRuntime) {
      throw new Error(`Runtime not found: ${runtimeId}`);
    }
    if (sourceRuntime.archivedAt) {
      throw new Error(`Archived runtime cannot be resumed: ${runtimeId}`);
    }
    if (!sourceRuntime.sessionId) {
      throw new Error(`Runtime has no Pi session to resume: ${runtimeId}`);
    }

    return this.createRuntime(sourceRuntime.projectId, options, {
      session: sourceRuntime.sessionId,
      runtime: sourceRuntime,
    });
  }

  restartRuntime(runtimeId: string, options: RuntimeConfigOptions = {}): Runtime {
    const sourceRuntime = this.runtimes.get(runtimeId)?.runtime ?? this.db.getRuntime(runtimeId);
    if (!sourceRuntime) {
      throw new Error(`Runtime not found: ${runtimeId}`);
    }
    if (sourceRuntime.archivedAt) {
      throw new Error(`Archived runtime cannot be restarted: ${runtimeId}`);
    }
    if (sourceRuntime.status === "running" || sourceRuntime.status === "starting") {
      throw new Error(`Runtime is already running: ${runtimeId}`);
    }

    return this.createRuntime(sourceRuntime.projectId, {
      model: options.model ?? sourceRuntime.model,
      thinkingLevel: options.thinkingLevel ?? sourceRuntime.thinkingLevel,
      responseMode: options.responseMode ?? sourceRuntime.responseMode,
    });
  }

  resumeSession(sessionId: string, options: RuntimeConfigOptions = {}): Runtime {
    const session = this.db.getSession(sessionId);
    if (!session) {
      throw new Error(`Session not found: ${sessionId}`);
    }

    const linkedRuntime = this.sessionLinker.findRuntimeForSession(session);
    if (linkedRuntime) {
      if (!session.runtimeId || session.runtimeId !== linkedRuntime.id) {
        const updatedSession = this.db.upsertSession({ ...session, updatedAt: Date.now(), runtimeId: linkedRuntime.id });
        this.broadcast({ type: "session.updated", session: updatedSession });
      }
      const managed = this.runtimes.get(linkedRuntime.id);
      return managed ? managed.runtime : this.resumeRuntime(linkedRuntime.id, options);
    }

    const runtime = this.createRuntime(session.projectId, options, { session: session.id });
    const updatedSession = this.db.upsertSession({ ...session, updatedAt: Date.now(), runtimeId: runtime.id });
    this.broadcast({ type: "session.updated", session: updatedSession });
    return runtime;
  }

  stopRuntime(runtimeId: string): Runtime {
    const managed = this.requireManaged(runtimeId);
    managed.client.stop();
    return managed.runtime;
  }

  archiveRuntime(runtimeId: string): Runtime {
    const archivedAt = Date.now();
    const managed = this.runtimes.get(runtimeId);
    if (managed) {
      managed.runtime = { ...managed.runtime, archivedAt };
      this.liveState.deleteRuntime(runtimeId);
      this.events.publishRuntimeStatus(managed.runtime);
      managed.client.stop();
      return managed.runtime;
    }

    const runtime = this.db.archiveRuntime(runtimeId, archivedAt);
    if (!runtime) {
      throw new Error(`Runtime not found: ${runtimeId}`);
    }
    this.events.publishRuntimeStatus(runtime);
    return runtime;
  }

  configureRuntime(runtimeId: string, options: RuntimeConfigureOptions): void {
    const managed = this.runtimes.get(runtimeId);
    const currentRuntime = managed?.runtime ?? this.db.getRuntime(runtimeId);
    if (!currentRuntime) {
      throw new Error(`Runtime not found: ${runtimeId}`);
    }

    const nextRuntime = runtimeWithConfiguredOptions(currentRuntime, options);
    if (managed) applyManagedRuntimeConfiguration(managed, options, nextRuntime);
    this.events.publishRuntimeStatus(nextRuntime);
  }

  prompt(runtimeId: string, message: string, streamingBehavior?: "steer" | "followUp"): void {
    sendPrompt(this.requireManaged(runtimeId), message, streamingBehavior);
  }

  executeRpcCommand(runtimeId: string, command: PiRpcCommand, label?: string): void {
    sendNativeRpcCommand(this.requireManaged(runtimeId), command, label);
  }

  abort(runtimeId: string): void {
    sendAbort(this.requireManaged(runtimeId));
  }

  respondExtensionUi(runtimeId: string, responseId: string, response: Record<string, unknown>): void {
    sendExtensionUiResponse(this.requireManaged(runtimeId), responseId, response);
  }

  requestSlashCommands(runtimeId: string): SlashCommand[] | undefined {
    return requestRuntimeSlashCommands(this.requireManaged(runtimeId), this.liveState, this.broadcast);
  }

  conversationSnapshot(runtimeId: string, limit?: number): ServerEvent | undefined {
    const managed = this.runtimes.get(runtimeId);
    if (managed) return managed.projection.snapshot(limit);

    const runtime = this.db.getRuntime(runtimeId);
    if (!runtime) return undefined;
    return {
      type: "conversation.snapshot",
      runtimeId: runtime.id,
      projectId: runtime.projectId,
      messages: this.db.listConversationMessages(runtime.id, limit ?? 100),
      contextUsage: this.db.getConversationContext(runtime.id),
      busy: this.db.getConversationBusy(runtime.id),
    };
  }

  private createRuntime(
    projectId: string,
    options: RuntimeConfigOptions = {},
    resume?: { session: string; runtime?: Runtime },
  ): Runtime {
    const project = this.db.getProject(projectId);
    if (!project) {
      throw new Error(`Project not found: ${projectId}`);
    }

    this.db.touchProject(projectId);

    const settings = this.db.getSettings();
    const isSessionResume = Boolean(resume?.session);
    const runtimeModel = options.model ?? resume?.runtime?.model ?? (!isSessionResume ? project.defaultModel ?? settings.defaultModel : undefined);
    const runtimeThinkingLevel = options.thinkingLevel ?? resume?.runtime?.thinkingLevel ?? (!isSessionResume ? settings.defaultThinkingLevel : undefined);
    const runtimeResponseMode = options.responseMode ?? resume?.runtime?.responseMode ?? (!isSessionResume ? settings.responseMode : undefined);

    let runtime: Runtime = {
      ...(resume?.runtime ?? {
        id: randomUUID(),
        projectId,
        cwd: project.cwd,
      }),
      status: "starting",
      pid: undefined,
      sessionId: resume?.session,
      startedAt: Date.now(),
      model: runtimeModel,
      thinkingLevel: runtimeThinkingLevel,
      responseMode: runtimeResponseMode,
    };

    this.events.publishRuntimeStatus(runtime);

    const { client, serviceTierConfigFile } = createPiRuntimeClient({
      runtimeId: runtime.id,
      cwd: project.cwd,
      session: resume?.session,
      model: runtimeModel,
      thinkingLevel: runtimeThinkingLevel,
      responseMode: runtimeResponseMode,
    });
    const projection = new ConversationProjection(this.db, () => this.runtimes.get(runtime.id)?.runtime ?? runtime, this.broadcast);
    const managed: ManagedRuntime = { runtime, client, serviceTierConfigFile, pendingNativeRpcCommands: new Map(), configRevision: 0, projection };
    this.runtimes.set(runtime.id, managed);

    client.on("event", (payload) => this.handlePiPayload(runtime.id, payload));
    client.on("stderr", (chunk) => {
      this.events.publishGuiEvent(managed.runtime, "stderr", chunk);
      const visibleChunk = stripModelDebugStderrLines(chunk);
      if (visibleChunk.trim()) managed.projection.appendLog("log", visibleChunk, "stderr");
    });
    client.on("error", (error) => {
      this.events.publishGuiEvent(managed.runtime, "error", { message: error.message });
      managed.projection.appendLog("error", error.message);
    });
    client.on("exit", (code, signal) => this.handleExit(runtime.id, code, signal));

    try {
      client.start();
      runtime = {
        ...runtime,
        status: "running",
        pid: client.pid,
      };
      managed.runtime = runtime;
      this.events.publishRuntimeStatus(runtime);
      if (resume) {
        this.events.publishGuiEvent(runtime, "runtime_status", {
          status: "resumed",
          sessionId: resume.session,
        });
      }
      requestRuntimeState(managed, this.events);
      requestRuntimeMessages(managed, this.events);
      requestSessionStats(managed, this.events);
      return runtime;
    } catch (error) {
      runtime = { ...runtime, status: "crashed", pid: undefined };
      managed.runtime = runtime;
      this.events.publishRuntimeStatus(runtime);
      this.events.publishGuiEvent(runtime, "error", { message: (error as Error).message });
      this.runtimes.delete(runtime.id);
      throw error;
    }
  }

  private handlePiPayload(runtimeId: string, payload: unknown): void {
    const managed = this.runtimes.get(runtimeId);
    if (!managed) return;
    handleRuntimePayload({
      runtimeId,
      managed,
      payload,
      events: this.events,
      liveState: this.liveState,
      sessionLinker: this.sessionLinker,
      broadcast: this.broadcast,
    });
  }

  private handleExit(runtimeId: string, code: number | null, signal: NodeJS.Signals | null): void {
    const managed = this.runtimes.get(runtimeId);
    if (!managed) return;

    const stoppedByUser = managed.client.isStopping;
    const status = stoppedByUser || code === 0 ? "stopped" : "crashed";
    managed.runtime = {
      ...managed.runtime,
      status,
      pid: undefined,
      archivedAt: status === "stopped" && !managed.runtime.sessionId ? Date.now() : managed.runtime.archivedAt,
    };

    const exitPayload = {
      exitCode: code,
      signal,
      status,
    };
    this.events.publishGuiEvent(managed.runtime, status === "crashed" ? "error" : "runtime_status", exitPayload);
    if (status === "crashed") managed.projection.appendLog("error", JSON.stringify(exitPayload, null, 2), "runtime crashed");
    this.db.setConversationBusy(runtimeId, managed.runtime.projectId, false);
    this.broadcast({ type: "conversation.busy", runtimeId, projectId: managed.runtime.projectId, busy: false });
    this.liveState.deleteRuntime(runtimeId);
    this.events.publishRuntimeStatus(managed.runtime);
    this.runtimes.delete(runtimeId);
  }

  private requireManaged(runtimeId: string): ManagedRuntime {
    const managed = this.runtimes.get(runtimeId);
    if (!managed) {
      throw new Error(`Runtime is not running or not managed by this server: ${runtimeId}`);
    }
    return managed;
  }

}
