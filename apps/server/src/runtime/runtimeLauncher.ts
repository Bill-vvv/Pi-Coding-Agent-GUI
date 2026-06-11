import type { Runtime } from "@pi-gui/shared";
import { ConversationProjection } from "./conversationProjection.js";
import type { ManagedRuntime, RuntimeConfigOptions } from "./managedRuntime.js";
import { createPiRuntimeClient } from "./piRuntimeFactory.js";
import { attachRuntimeClientEventHandlers, handleRuntimeClientPayload, type RuntimeClientHandlerDependencies } from "./runtimeClientEventHandlers.js";
import { prepareRuntimeLaunchPlan, type RuntimeResumeOptions } from "./runtimeLaunchPlan.js";
import { requestRuntimeMessages, requestRuntimeState, requestSessionStats } from "./runtimeStateRequester.js";
import { SubagentRunProjection } from "./subagent/subagentRunProjection.js";

export type { RuntimeResumeOptions } from "./runtimeLaunchPlan.js";

type RuntimeLauncherOptions = RuntimeClientHandlerDependencies;

export class RuntimeLauncher {
  constructor(private readonly options: RuntimeLauncherOptions) {}

  createRuntime(projectId: string, config: RuntimeConfigOptions = {}, resume?: RuntimeResumeOptions): Runtime {
    const { db, broadcast, runtimes, events } = this.options;
    const plan = prepareRuntimeLaunchPlan(db, projectId, config, resume);
    let runtime = plan.runtime;

    const settings = db.getSettings();
    const { client, serviceTierConfigFile, capabilityPlan } = createPiRuntimeClient({
      runtimeId: runtime.id,
      cwd: plan.project.cwd,
      session: resume?.session,
      model: plan.model,
      thinkingLevel: plan.thinkingLevel,
      responseMode: plan.responseMode,
      runtimeProfileId: config.runtimeProfileId,
      savedRuntimeProfileId: resume?.runtime?.runtimeProfileId,
      defaultRuntimeProfileId: plan.project.defaultRuntimeProfileId ?? settings.defaultRuntimeProfileId,
      customRuntimeCapabilityIds: settings.customRuntimeCapabilityIds,
      confirmedProjectExtensionIds: settings.confirmedProjectExtensionIds,
    });
    runtime = { ...runtime, runtimeProfileId: capabilityPlan.runtimeProfileId, enabledCapabilityIds: capabilityPlan.enabledCapabilityIds };

    events.publishRuntimeStatus(runtime);
    const getRuntime = () => runtimes.get(runtime.id)?.runtime ?? runtime;
    let managed: ManagedRuntime;
    const projection = new ConversationProjection(db, getRuntime, broadcast, (message) => {
      const pending = managed.pendingRewindPromptCheckpoint;
      if (!pending || message.role !== "user") return;
      if (normalizePromptText(message.text) !== normalizePromptText(pending.promptText)) return;
      db.upsertRewindCheckpointConversationLink({
        projectId: pending.projectId,
        snapshotId: pending.snapshotId,
        runtimeId: runtime.id,
        sessionId: pending.sessionId ?? managed.runtime.sessionId,
        targetEntryId: message.id,
        captureSource: "prompt",
        createdAt: pending.createdAt,
      });
      managed.pendingRewindPromptCheckpoint = undefined;
    });
    const subagents = new SubagentRunProjection(db, getRuntime, broadcast);
    managed = { runtime, client, serviceTierConfigFile, enabledCapabilityIds: capabilityPlan.enabledCapabilityIds, pendingNativeRpcCommands: new Map(), configRevision: 0, projection, subagents };
    runtimes.set(runtime.id, managed);
    attachRuntimeClientEventHandlers(this.options, runtime.id, managed);

    try {
      client.start();
      runtime = {
        ...runtime,
        status: "running",
        pid: client.pid,
      };
      managed.runtime = runtime;
      events.publishRuntimeStatus(runtime);
      if (resume) {
        events.publishGuiEvent(runtime, "runtime_status", {
          status: "resumed",
          sessionId: resume.session,
        });
      }
      requestRuntimeState(managed, events);
      requestRuntimeMessages(managed, events);
      requestSessionStats(managed, events);
      return runtime;
    } catch (error) {
      runtime = { ...runtime, status: "crashed", pid: undefined };
      managed.runtime = runtime;
      events.publishRuntimeStatus(runtime);
      events.publishGuiEvent(runtime, "error", { message: (error as Error).message });
      runtimes.delete(runtime.id);
      throw error;
    }
  }

  handlePiPayload(runtimeId: string, payload: unknown): void {
    handleRuntimeClientPayload(this.options, runtimeId, payload);
  }
}

function normalizePromptText(text: string): string {
  return text.trim().replace(/\s+/g, " ");
}
