import type { PiRpcCommand, Runtime, RuntimeConversationSummary, RuntimeQueue, ServerEvent, SlashCommand, SubagentRun } from "@pi-gui/shared";
import { AppDatabase } from "../db.js";
import type { ManagedRuntime, RuntimeConfigOptions } from "./managedRuntime.js";
import { applyManagedRuntimeConfiguration, requestRuntimeSlashCommands, runtimeWithConfiguredOptions, sendAbort, sendExtensionUiResponse, sendNativeRpcCommand, sendPrompt, type RuntimeConfigureOptions } from "./runtimeCommandSender.js";
import { reusableNewRuntimeForProject, unhandledNewRuntimeIdsToArchive } from "./newConversationPolicy.js";
import { buildRuntimeConversationSummaries, runtimeConversationPageBefore, runtimeConversationSnapshot } from "./runtimeConversationViews.js";
import { RuntimeEventSink } from "./runtimeEventSink.js";
import { RuntimeLauncher } from "./runtimeLauncher.js";
import { RuntimeLiveState } from "./runtimeLiveState.js";
import { RuntimeSessionLinker } from "./runtimeSessionLinker.js";
import { SubagentChildSessionCache } from "./subagent/childSessionParser.js";

type Broadcast = (event: ServerEvent) => void;

export class RuntimeSupervisor {
  private runtimes = new Map<string, ManagedRuntime>();
  private readonly events: RuntimeEventSink;
  private readonly liveState: RuntimeLiveState;
  private readonly sessionLinker: RuntimeSessionLinker;
  private readonly launcher: RuntimeLauncher;
  private readonly subagentChildSessions = new SubagentChildSessionCache();

  constructor(
    private readonly db: AppDatabase,
    private readonly broadcast: Broadcast,
  ) {
    this.events = new RuntimeEventSink(db, broadcast);
    this.liveState = new RuntimeLiveState(this.runtimes, broadcast);
    this.sessionLinker = new RuntimeSessionLinker(db, broadcast, this.runtimes);
    this.launcher = new RuntimeLauncher({
      db,
      broadcast,
      runtimes: this.runtimes,
      events: this.events,
      liveState: this.liveState,
      sessionLinker: this.sessionLinker,
    });
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
    return buildRuntimeConversationSummaries({
      db: this.db,
      liveRuntimes: this.runtimes.values(),
      orderedRuntimes: this.listRuntimes(),
      limit,
    });
  }

  listSubagentRuns(parentRuntimeId?: string, limit = 500): SubagentRun[] {
    return this.db.listSubagentRuns(parentRuntimeId, limit);
  }

  listActiveSubagentRuns(limit = 500): SubagentRun[] {
    return this.db.listActiveSubagentRuns(limit);
  }

  startRuntime(projectId: string, options: RuntimeConfigOptions = {}): Runtime {
    const runtimes = this.listRuntimes();
    const hasMessages = (runtimeId: string) => this.db.listConversationMessages(runtimeId, 1).length > 0;
    const reusable = reusableNewRuntimeForProject(runtimes, projectId, hasMessages);
    for (const runtimeId of unhandledNewRuntimeIdsToArchive(runtimes, reusable?.id, hasMessages)) {
      this.archiveRuntime(runtimeId);
    }
    if (reusable) return this.runtimes.get(reusable.id)?.runtime ?? reusable;
    return this.launcher.createRuntime(projectId, options);
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

    return this.launcher.createRuntime(sourceRuntime.projectId, options, {
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

    return this.launcher.createRuntime(sourceRuntime.projectId, {
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

    const runtime = this.launcher.createRuntime(session.projectId, options, { session: session.id });
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

  async prompt(runtimeId: string, message: string, streamingBehavior?: "steer" | "followUp"): Promise<void> {
    const managed = this.requireManaged(runtimeId);
    const project = this.db.getProject(managed.runtime.projectId);
    if (!project) throw new Error(`Project not found for runtime: ${managed.runtime.projectId}`);
    await sendPrompt(managed, message, streamingBehavior, project.cwd);
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
    return runtimeConversationSnapshot(this.db, this.runtimes, runtimeId, limit);
  }

  conversationPageBefore(runtimeId: string, beforeMessageId: string, limit?: number): ServerEvent | undefined {
    return runtimeConversationPageBefore(this.db, runtimeId, beforeMessageId, limit);
  }

  subagentDetail(runId: string, childRunId?: string, limit?: number): Extract<ServerEvent, { type: "subagent.detail" }> {
    const run = this.db.getSubagentRun(runId);
    if (!run) throw new Error(`Sub-agent run not found: ${runId}`);
    const detail = this.subagentChildSessions.parse(run, childRunId, limit);
    return { type: "subagent.detail", ...detail };
  }

  private requireManaged(runtimeId: string): ManagedRuntime {
    const managed = this.runtimes.get(runtimeId);
    if (!managed) {
      throw new Error(`Runtime is not running or not managed by this server: ${runtimeId}`);
    }
    return managed;
  }

}
