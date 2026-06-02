import { randomUUID } from "node:crypto";
import { mkdirSync, writeFileSync } from "node:fs";
import { dirname, resolve } from "node:path";
import type { GuiEvent, ResponseMode, Runtime, ServerEvent, ThinkingLevel } from "@pi-gui/shared";
import { AppDatabase } from "../db.js";
import { PiRpcClient } from "./piRpcClient.js";

type ManagedRuntime = {
  runtime: Runtime;
  client: PiRpcClient;
  serviceTierConfigFile?: string;
  stateRequestId?: string;
  statsRequestId?: string;
};

type Broadcast = (event: ServerEvent) => void;

export class RuntimeSupervisor {
  private runtimes = new Map<string, ManagedRuntime>();

  constructor(
    private readonly db: AppDatabase,
    private readonly broadcast: Broadcast,
  ) {}

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
    const project = this.db.getProject(projectId);
    if (!project) {
      throw new Error(`Project not found: ${projectId}`);
    }

    this.db.touchProject(projectId);

    let runtime: Runtime = {
      id: randomUUID(),
      projectId,
      cwd: project.cwd,
      status: "starting",
      startedAt: Date.now(),
    };

    this.publishRuntimeStatus(runtime);

    const settings = this.db.getSettings();
    const responseMode = options.responseMode ?? settings.responseMode;
    const serviceTierConfigFile = serviceTierConfigPath(runtime.id);
    writeServiceTierConfig(serviceTierConfigFile, responseMode);
    const client = new PiRpcClient(project.cwd, {
      model: options.model ?? project.defaultModel ?? settings.defaultModel,
      thinkingLevel: options.thinkingLevel ?? settings.defaultThinkingLevel,
      serviceTierConfigFile,
    });
    const managed: ManagedRuntime = { runtime, client, serviceTierConfigFile };
    this.runtimes.set(runtime.id, managed);

    client.on("event", (payload) => this.handlePiPayload(runtime.id, payload));
    client.on("stderr", (chunk) => this.publishGuiEvent(runtime.id, "stderr", chunk));
    client.on("error", (error) => this.publishGuiEvent(runtime.id, "error", { message: error.message }));
    client.on("exit", (code, signal) => this.handleExit(runtime.id, code, signal));

    try {
      client.start();
      runtime = {
        ...runtime,
        status: "running",
        pid: client.pid,
      };
      managed.runtime = runtime;
      this.publishRuntimeStatus(runtime);
      this.requestRuntimeState(managed);
      this.requestSessionStats(managed);
      return runtime;
    } catch (error) {
      runtime = { ...runtime, status: "crashed", pid: undefined };
      managed.runtime = runtime;
      this.publishRuntimeStatus(runtime);
      this.publishGuiEvent(runtime.id, "error", { message: (error as Error).message });
      throw error;
    }
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
      this.publishRuntimeStatus(managed.runtime);
      managed.client.stop();
      return managed.runtime;
    }

    const runtime = this.db.archiveRuntime(runtimeId, archivedAt);
    if (!runtime) {
      throw new Error(`Runtime not found: ${runtimeId}`);
    }
    this.broadcast({ type: "runtime.status", runtime });
    this.publishGuiEvent(runtime.id, "runtime_status", runtime);
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

  private handlePiPayload(runtimeId: string, payload: unknown): void {
    const managed = this.runtimes.get(runtimeId);
    if (!managed) return;

    const maybeRecord = payload && typeof payload === "object" ? (payload as Record<string, unknown>) : undefined;
    if (maybeRecord?.type === "response") {
      if (managed.stateRequestId && maybeRecord.id === managed.stateRequestId) {
        managed.stateRequestId = undefined;
        if (maybeRecord.success === true) {
          const data = maybeRecord.data as Record<string, unknown> | undefined;
          const sessionId = typeof data?.sessionId === "string" ? data.sessionId : undefined;
          if (sessionId && managed.runtime.sessionId !== sessionId) {
            managed.runtime = { ...managed.runtime, sessionId };
            this.publishRuntimeStatus(managed.runtime);
          }
        }
      }

      if (managed.statsRequestId && maybeRecord.id === managed.statsRequestId) {
        managed.statsRequestId = undefined;
      }

      if (maybeRecord.command === "set_model" && maybeRecord.success === true) {
        this.requestSessionStats(managed);
      }
    }

    if (maybeRecord?.type === "agent_end" || maybeRecord?.type === "compaction_end") {
      this.requestSessionStats(managed);
    }

    this.publishGuiEvent(runtimeId, "pi_event", payload);
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

    this.publishGuiEvent(runtimeId, status === "crashed" ? "error" : "runtime_status", {
      exitCode: code,
      signal,
      status,
    });
    this.publishRuntimeStatus(managed.runtime);
    this.runtimes.delete(runtimeId);
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
      this.publishGuiEvent(managed.runtime.id, "error", { message: (error as Error).message });
    }
  }

  private requestSessionStats(managed: ManagedRuntime): void {
    if (managed.statsRequestId) return;
    managed.statsRequestId = `gui-stats-${randomUUID()}`;
    try {
      managed.client.send({ id: managed.statsRequestId, type: "get_session_stats" });
    } catch (error) {
      managed.statsRequestId = undefined;
      this.publishGuiEvent(managed.runtime.id, "error", { message: (error as Error).message });
    }
  }

  private publishRuntimeStatus(runtime: Runtime): void {
    this.db.upsertRuntime(runtime);
    this.broadcast({ type: "runtime.status", runtime });
    this.publishGuiEvent(runtime.id, "runtime_status", runtime);
  }

  private publishGuiEvent(runtimeId: string, kind: GuiEvent["kind"], payload: unknown): GuiEvent | undefined {
    const runtime = this.runtimes.get(runtimeId)?.runtime ?? this.db.getRuntime(runtimeId);
    if (!runtime) return undefined;

    const event = this.db.appendEvent({
      runtimeId,
      projectId: runtime.projectId,
      kind,
      payload,
    });
    this.broadcast({ type: "gui.event", event });
    return event;
  }
}

function responseModeToServiceTier(responseMode: ResponseMode | undefined): "priority" | undefined {
  return responseMode === "fast" ? "priority" : undefined;
}

function serviceTierConfigPath(runtimeId: string): string {
  return resolve(process.cwd(), ".pi-gui", "runtime-config", `${runtimeId}.json`);
}

function writeServiceTierConfig(filePath: string | undefined, responseMode: ResponseMode | undefined): void {
  if (!filePath) return;
  mkdirSync(dirname(filePath), { recursive: true });
  const serviceTier = responseModeToServiceTier(responseMode);
  writeFileSync(filePath, JSON.stringify(serviceTier ? { serviceTier } : {}), "utf8");
}
