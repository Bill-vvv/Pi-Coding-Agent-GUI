import { existsSync } from "node:fs";
import type { PiRpcCommand, Runtime, RuntimeConversationSummary, RuntimeQueue, ServerEvent, SlashCommand, SubagentRun } from "@pi-gui/shared";
import { AppDatabase } from "../db.js";
import { findPiSessionFileById, readPiSessionConversationSummary } from "../services/sessionIndexService.js";
import { parseSshProjectCwd } from "../services/sshProjectService.js";
import type { ManagedRuntime, RuntimeConfigOptions } from "./managedRuntime.js";
import { applyManagedRuntimeConfiguration, dequeueQueuedPrompts, replaceQueuedPrompts, requestRuntimeSlashCommands, runtimeWithConfiguredOptions, sendAbort, sendExtensionUiResponse, sendNativeRpcCommand, sendPrompt, type RuntimeConfigureOptions } from "./runtimeCommandSender.js";
import { reusableNewRuntimeForProject, unhandledNewRuntimeIdsToArchive } from "./newConversationPolicy.js";
import { buildRuntimeConversationSummaries, runtimeConversationPageBefore, runtimeConversationSnapshot } from "./runtimeConversationViews.js";
import { RuntimeEventSink } from "./runtimeEventSink.js";
import { RuntimeLauncher } from "./runtimeLauncher.js";
import { RuntimeLiveState } from "./runtimeLiveState.js";
import { RuntimeSessionLinker } from "./runtimeSessionLinker.js";
import { SubagentChildSessionCache } from "./subagent/childSessionParser.js";
import { subagentRunsForWire } from "./subagent/subagentWire.js";

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
    return subagentRunsForWire(this.db.listSubagentRuns(parentRuntimeId, limit));
  }

  listActiveSubagentRuns(limit = 500): SubagentRun[] {
    return subagentRunsForWire(this.db.listActiveSubagentRuns(limit));
  }

  startRuntime(projectId: string, options: RuntimeConfigOptions = {}): Runtime {
    const runtimes = this.listRuntimes();
    const reusable = reusableNewRuntimeForProject(runtimes, projectId, (runtimeId) => this.runtimeHasConversationActivity(runtimeId));
    for (const runtimeId of unhandledNewRuntimeIdsToArchive(runtimes, reusable?.id, (runtimeId) => this.runtimeHasConversationActivity(runtimeId))) {
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
    this.assertLocalPiSessionAvailable(sourceRuntime.sessionId, sourceRuntime.cwd);

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
    this.assertLocalPiSessionAvailable(sessionId, session.piSessionFile, session.piSessionFile);

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

  archiveBlankRuntime(runtimeId: string): Runtime {
    const runtime = this.getRuntime(runtimeId);
    if (!runtime) {
      throw new Error(`Runtime not found: ${runtimeId}`);
    }
    if (!isBlankRuntimeSafeToArchive(runtime, (id) => this.runtimeHasConversationActivity(id))) {
      return runtime;
    }
    return this.archiveRuntime(runtimeId);
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

  async prompt(runtimeId: string, message: string, streamingBehavior?: "steer" | "followUp", displayMessage?: string): Promise<void> {
    const managed = this.requireManaged(runtimeId);
    const project = this.db.getProject(managed.runtime.projectId);
    if (!project) throw new Error(`Project not found for runtime: ${managed.runtime.projectId}`);
    appendDisplayUserInput(managed, displayMessage);
    managed.projection.markBusy(true);
    try {
      await sendPrompt(managed, message, streamingBehavior, project.cwd);
    } catch (error) {
      managed.projection.markBusy(false);
      throw error;
    }
  }

  async dequeueQueue(runtimeId: string): Promise<RuntimeQueue> {
    const managed = this.requireManaged(runtimeId);
    const queue = await dequeueQueuedPrompts(managed);
    this.liveState.publishQueue(managed, { steering: [], followUp: [] });
    return queue;
  }

  async reorderQueue(runtimeId: string, queue: RuntimeQueue): Promise<void> {
    const managed = this.requireManaged(runtimeId);
    const project = this.db.getProject(managed.runtime.projectId);
    if (!project) throw new Error(`Project not found for runtime: ${managed.runtime.projectId}`);
    await replaceQueuedPrompts(managed, queue, project.cwd);
    this.liveState.publishQueue(managed, queue);
  }

  executeRpcCommand(runtimeId: string, command: PiRpcCommand, label?: string, displayMessage?: string): void {
    const managed = this.requireManaged(runtimeId);
    appendDisplayUserInput(managed, displayMessage);
    sendNativeRpcCommand(managed, command, label);
  }

  abort(runtimeId: string): void {
    sendAbort(this.requireManaged(runtimeId));
  }

  respondExtensionUi(runtimeId: string, responseId: string, response: Record<string, unknown>): void {
    sendExtensionUiResponse(this.requireManaged(runtimeId), responseId, response);
  }

  private assertLocalPiSessionAvailable(sessionId: string, cwd: string, directSessionFile?: string): void {
    if (parseSshProjectCwd(cwd) || (directSessionFile && parseSshProjectCwd(directSessionFile))) return;

    const indexedSessionFile = this.db.getSession(sessionId)?.piSessionFile;
    if (directSessionFile && existsSync(directSessionFile)) return;
    if (indexedSessionFile && existsSync(indexedSessionFile)) return;
    if (findPiSessionFileById(sessionId, cwd)) return;

    throw new Error(
      `Pi session file not found for '${sessionId}'. This can happen if the GUI server restarted before Pi persisted the session. Start a new conversation instead of resuming this runtime.`,
    );
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

  private runtimeHasConversationActivity(runtimeId: string): boolean {
    if (this.db.listConversationMessages(runtimeId, 1).length > 0 || this.db.getConversationBusy(runtimeId)) return true;
    const runtime = this.getRuntime(runtimeId);
    if (!runtime?.sessionId) return false;
    const session = this.db.getSession(runtime.sessionId);
    if (!session) return false;
    if (session.title?.trim()) return true;
    return (readPiSessionConversationSummary(session.piSessionFile)?.messageCount ?? 0) > 0;
  }

  private requireManaged(runtimeId: string): ManagedRuntime {
    const managed = this.runtimes.get(runtimeId);
    if (!managed) {
      throw new Error(`Runtime is not running or not managed by this server: ${runtimeId}`);
    }
    return managed;
  }

}

function isBlankRuntimeSafeToArchive(runtime: Runtime, hasConversationActivity: (runtimeId: string) => boolean): boolean {
  if (runtime.archivedAt || runtime.sessionId) return false;
  if (runtime.status !== "running" && runtime.status !== "starting") return false;
  return !hasConversationActivity(runtime.id);
}

function appendDisplayUserInput(managed: ManagedRuntime, displayMessage?: string): void {
  if (!displayMessage?.trim()) return;
  managed.projection.appendUserInput(displayMessage);
}
