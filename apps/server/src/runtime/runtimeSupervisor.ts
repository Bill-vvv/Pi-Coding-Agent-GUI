import { randomUUID } from "node:crypto";
import type { GuiSession, ResponseMode, Runtime, ServerEvent, ThinkingLevel } from "@pi-gui/shared";
import { AppDatabase } from "../db.js";
import { ConversationProjection } from "./conversationProjection.js";
import { PiRpcClient } from "./piRpcClient.js";
import { RuntimeEventSink } from "./runtimeEventSink.js";
import { responseModeToServiceTier, serviceTierConfigPath, writeServiceTierConfig } from "./serviceTierConfig.js";

type ManagedRuntime = {
  runtime: Runtime;
  client: PiRpcClient;
  serviceTierConfigFile?: string;
  stateRequestId?: string;
  statsRequestId?: string;
  messageRequestId?: string;
  projection: ConversationProjection;
};

type Broadcast = (event: ServerEvent) => void;

export class RuntimeSupervisor {
  private runtimes = new Map<string, ManagedRuntime>();
  private readonly events: RuntimeEventSink;

  constructor(
    private readonly db: AppDatabase,
    private readonly broadcast: Broadcast,
  ) {
    this.events = new RuntimeEventSink(db, broadcast);
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

  startRuntime(projectId: string, options: { model?: string; thinkingLevel?: ThinkingLevel; responseMode?: ResponseMode } = {}): Runtime {
    return this.createRuntime(projectId, options);
  }

  getRuntime(runtimeId: string): Runtime | undefined {
    return this.runtimes.get(runtimeId)?.runtime ?? this.db.getRuntime(runtimeId);
  }

  resumeRuntime(runtimeId: string, options: { model?: string; thinkingLevel?: ThinkingLevel; responseMode?: ResponseMode } = {}): Runtime {
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

  configureRuntime(runtimeId: string, options: { modelProvider?: string; modelId?: string; thinkingLevel?: ThinkingLevel; responseMode?: ResponseMode }): void {
    const managed = this.requireManaged(runtimeId);
    if (options.modelProvider && options.modelId) {
      managed.client.send({
        id: `gui-${randomUUID()}`,
        type: "set_model",
        provider: options.modelProvider,
        modelId: options.modelId,
      });
    }
    if (options.thinkingLevel) {
      managed.client.send({ id: `gui-${randomUUID()}`, type: "set_thinking_level", level: options.thinkingLevel });
    }
    if (options.responseMode) {
      managed.client.send({ id: `gui-${randomUUID()}`, type: "set_service_tier", serviceTier: responseModeToServiceTier(options.responseMode) });
    }
  }

  prompt(runtimeId: string, message: string, streamingBehavior?: "steer" | "followUp"): void {
    const managed = this.requireManaged(runtimeId);
    const command: Record<string, unknown> = {
      id: `gui-${randomUUID()}`,
      type: "prompt",
      message,
    };
    if (streamingBehavior) command.streamingBehavior = streamingBehavior;
    managed.client.send(command);
  }

  abort(runtimeId: string): void {
    const managed = this.requireManaged(runtimeId);
    managed.client.send({ id: `gui-${randomUUID()}`, type: "abort" });
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
    options: { model?: string; thinkingLevel?: ThinkingLevel; responseMode?: ResponseMode } = {},
    resume?: { session: string; runtime: Runtime },
  ): Runtime {
    const project = this.db.getProject(projectId);
    if (!project) {
      throw new Error(`Project not found: ${projectId}`);
    }

    this.db.touchProject(projectId);

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
    };

    this.events.publishRuntimeStatus(runtime);

    const settings = this.db.getSettings();
    const responseMode = options.responseMode ?? settings.responseMode;
    const serviceTierConfigFile = serviceTierConfigPath(runtime.id);
    writeServiceTierConfig(serviceTierConfigFile, responseMode);
    const client = new PiRpcClient(project.cwd, {
      session: resume?.session,
      model: options.model ?? project.defaultModel ?? settings.defaultModel,
      thinkingLevel: options.thinkingLevel ?? settings.defaultThinkingLevel,
      serviceTierConfigFile,
    });
    const projection = new ConversationProjection(this.db, () => this.runtimes.get(runtime.id)?.runtime ?? runtime, this.broadcast);
    const managed: ManagedRuntime = { runtime, client, serviceTierConfigFile, projection };
    this.runtimes.set(runtime.id, managed);

    client.on("event", (payload) => this.handlePiPayload(runtime.id, payload));
    client.on("stderr", (chunk) => {
      this.events.publishGuiEvent(managed.runtime, "stderr", chunk);
      managed.projection.appendLog("log", chunk, "stderr");
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
      this.requestRuntimeState(managed);
      this.requestRuntimeMessages(managed);
      this.requestSessionStats(managed);
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

    const maybeRecord = payload && typeof payload === "object" ? (payload as Record<string, unknown>) : undefined;
    if (maybeRecord?.type === "response") {
      const data = maybeRecord.success === true && maybeRecord.data && typeof maybeRecord.data === "object" ? (maybeRecord.data as Record<string, unknown>) : undefined;

      if (managed.stateRequestId && maybeRecord.id === managed.stateRequestId) {
        managed.stateRequestId = undefined;
        if (data) {
          const sessionId = typeof data.sessionId === "string" ? data.sessionId : undefined;
          if (sessionId && managed.runtime.sessionId !== sessionId) {
            managed.runtime = { ...managed.runtime, sessionId };
            this.events.publishRuntimeStatus(managed.runtime);
          }
        }
      }

      if (managed.statsRequestId && maybeRecord.id === managed.statsRequestId) {
        managed.statsRequestId = undefined;
      }

      if (managed.messageRequestId && maybeRecord.id === managed.messageRequestId) {
        managed.messageRequestId = undefined;
      }

      if (data && (maybeRecord.command === "get_state" || maybeRecord.command === "get_session_stats")) {
        this.indexSessionFromPiResponse(managed, data);
      }

      if (maybeRecord.command === "set_model" && maybeRecord.success === true) {
        this.requestSessionStats(managed);
      }
    }

    managed.projection.handlePiPayload(payload);

    if (maybeRecord?.type === "agent_end" || maybeRecord?.type === "compaction_end") {
      this.requestSessionStats(managed);
    }

    this.events.publishGuiEvent(managed.runtime, "pi_event", payload);
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
    this.events.publishRuntimeStatus(managed.runtime);
    this.runtimes.delete(runtimeId);
  }

  private indexSessionFromPiResponse(managed: ManagedRuntime, data: Record<string, unknown>): void {
    const sessionId = typeof data.sessionId === "string" ? data.sessionId : managed.runtime.sessionId;
    const sessionFile = typeof data.sessionFile === "string" ? data.sessionFile : typeof data.piSessionFile === "string" ? data.piSessionFile : undefined;
    if (!sessionId || !sessionFile) return;

    const existing = this.db.getSession(sessionId);
    const now = Date.now();
    const session: GuiSession = this.db.upsertSession({
      id: sessionId,
      projectId: managed.runtime.projectId,
      piSessionFile: sessionFile,
      title: existing?.title,
      createdAt: existing?.createdAt ?? managed.runtime.startedAt ?? now,
      updatedAt: now,
      runtimeId: managed.runtime.id,
    });
    this.broadcast({ type: "session.updated", session });
  }

  private requireManaged(runtimeId: string): ManagedRuntime {
    const managed = this.runtimes.get(runtimeId);
    if (!managed) {
      throw new Error(`Runtime is not running or not managed by this server: ${runtimeId}`);
    }
    return managed;
  }

  private requestRuntimeState(managed: ManagedRuntime): void {
    if (managed.stateRequestId) return;
    managed.stateRequestId = `gui-state-${randomUUID()}`;
    try {
      managed.client.send({ id: managed.stateRequestId, type: "get_state" });
    } catch (error) {
      managed.stateRequestId = undefined;
      this.events.publishGuiEvent(managed.runtime, "error", { message: (error as Error).message });
    }
  }

  private requestSessionStats(managed: ManagedRuntime): void {
    if (managed.statsRequestId) return;
    managed.statsRequestId = `gui-stats-${randomUUID()}`;
    try {
      managed.client.send({ id: managed.statsRequestId, type: "get_session_stats" });
    } catch (error) {
      managed.statsRequestId = undefined;
      this.events.publishGuiEvent(managed.runtime, "error", { message: (error as Error).message });
    }
  }

  private requestRuntimeMessages(managed: ManagedRuntime): void {
    if (managed.messageRequestId) return;
    managed.messageRequestId = `gui-messages-${randomUUID()}`;
    try {
      managed.client.send({ id: managed.messageRequestId, type: "get_messages" });
    } catch (error) {
      managed.messageRequestId = undefined;
      this.events.publishGuiEvent(managed.runtime, "error", { message: (error as Error).message });
    }
  }
}
