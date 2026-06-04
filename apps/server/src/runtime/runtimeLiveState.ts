import type { RuntimeQueue, ServerEvent, SlashCommand } from "@pi-gui/shared";
import type { ManagedRuntime } from "./managedRuntime.js";

type Broadcast = (event: ServerEvent) => void;

export class RuntimeLiveState {
  private runtimeQueues = new Map<string, { projectId: string; queue: RuntimeQueue }>();
  private runtimeCommands = new Map<string, { projectId: string; commands: SlashCommand[] }>();

  constructor(
    private readonly runtimes: Map<string, ManagedRuntime>,
    private readonly broadcast: Broadcast,
  ) {}

  listQueues(): Array<{ runtimeId: string; projectId: string; queue: RuntimeQueue }> {
    return [...this.runtimeQueues.entries()].flatMap(([runtimeId, snapshot]) => {
      const managed = this.runtimes.get(runtimeId);
      if (!managed || managed.runtime.archivedAt) return [];
      return [{ runtimeId, projectId: snapshot.projectId, queue: snapshot.queue }];
    });
  }

  listCommands(): Array<{ runtimeId: string; projectId: string; commands: SlashCommand[] }> {
    return [...this.runtimeCommands.entries()].flatMap(([runtimeId, snapshot]) => {
      const managed = this.runtimes.get(runtimeId);
      if (!managed || managed.runtime.archivedAt) return [];
      return [{ runtimeId, projectId: snapshot.projectId, commands: snapshot.commands }];
    });
  }

  getCommands(runtimeId: string): SlashCommand[] | undefined {
    return this.runtimeCommands.get(runtimeId)?.commands;
  }

  publishQueue(managed: ManagedRuntime, queue: RuntimeQueue): void {
    this.runtimeQueues.set(managed.runtime.id, { projectId: managed.runtime.projectId, queue });
    this.broadcast({
      type: "runtime.queue",
      runtimeId: managed.runtime.id,
      projectId: managed.runtime.projectId,
      queue,
    });
  }

  publishCommands(managed: ManagedRuntime, commands: SlashCommand[]): void {
    this.runtimeCommands.set(managed.runtime.id, { projectId: managed.runtime.projectId, commands });
    this.broadcast({
      type: "runtime.commands",
      runtimeId: managed.runtime.id,
      projectId: managed.runtime.projectId,
      commands,
    });
  }

  deleteRuntime(runtimeId: string): void {
    this.runtimeQueues.delete(runtimeId);
    this.runtimeCommands.delete(runtimeId);
  }
}
