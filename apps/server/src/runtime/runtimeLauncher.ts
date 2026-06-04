import type { Runtime } from "@pi-gui/shared";
import { ConversationProjection } from "./conversationProjection.js";
import type { ManagedRuntime, RuntimeConfigOptions } from "./managedRuntime.js";
import { createPiRuntimeClient } from "./piRuntimeFactory.js";
import { attachRuntimeClientEventHandlers, handleRuntimeClientPayload, type RuntimeClientHandlerDependencies } from "./runtimeClientEventHandlers.js";
import { prepareRuntimeLaunchPlan, type RuntimeResumeOptions } from "./runtimeLaunchPlan.js";
import { requestRuntimeMessages, requestRuntimeState, requestSessionStats } from "./runtimeStateRequester.js";

export type { RuntimeResumeOptions } from "./runtimeLaunchPlan.js";

type RuntimeLauncherOptions = RuntimeClientHandlerDependencies;

export class RuntimeLauncher {
  constructor(private readonly options: RuntimeLauncherOptions) {}

  createRuntime(projectId: string, config: RuntimeConfigOptions = {}, resume?: RuntimeResumeOptions): Runtime {
    const { db, broadcast, runtimes, events } = this.options;
    const plan = prepareRuntimeLaunchPlan(db, projectId, config, resume);
    let runtime = plan.runtime;

    events.publishRuntimeStatus(runtime);

    const { client, serviceTierConfigFile } = createPiRuntimeClient({
      runtimeId: runtime.id,
      cwd: plan.project.cwd,
      session: resume?.session,
      model: plan.model,
      thinkingLevel: plan.thinkingLevel,
      responseMode: plan.responseMode,
    });
    const projection = new ConversationProjection(db, () => runtimes.get(runtime.id)?.runtime ?? runtime, broadcast);
    const managed: ManagedRuntime = { runtime, client, serviceTierConfigFile, pendingNativeRpcCommands: new Map(), configRevision: 0, projection };
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
