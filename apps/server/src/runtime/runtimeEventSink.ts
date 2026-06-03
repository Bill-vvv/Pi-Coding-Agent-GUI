import type { GuiEvent, Runtime, ServerEvent } from "@pi-gui/shared";
import type { AppDatabase } from "../db.js";
import { compactPayloadForEventLog } from "./eventLogCompaction.js";

type Broadcast = (event: ServerEvent) => void;

export class RuntimeEventSink {
  constructor(
    private readonly db: AppDatabase,
    private readonly broadcast: Broadcast,
  ) {}

  publishRuntimeStatus(runtime: Runtime): void {
    this.db.upsertRuntime(runtime);
    this.broadcast({ type: "runtime.status", runtime });
    this.publishGuiEvent(runtime, "runtime_status", runtime);
  }

  publishGuiEvent(runtime: Runtime | undefined, kind: GuiEvent["kind"], payload: unknown): GuiEvent | undefined {
    if (!runtime) return undefined;

    const event = this.db.appendEvent({
      runtimeId: runtime.id,
      projectId: runtime.projectId,
      kind,
      payload: compactPayloadForEventLog(kind, payload),
    });

    if (process.env.PI_GUI_BROADCAST_RAW_EVENTS === "1") {
      this.broadcast({ type: "gui.event", event });
    }

    return event;
  }
}
