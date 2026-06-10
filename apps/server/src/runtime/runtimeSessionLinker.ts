import type { GuiSession, Runtime, ServerEvent } from "@pi-gui/shared";
import type { AppDatabase } from "../db.js";
import { findPiSessionFileById, readPiSessionConversationSummary } from "../services/sessionIndexService.js";
import type { ManagedRuntime } from "./managedRuntime.js";

type Broadcast = (event: ServerEvent) => void;

export class RuntimeSessionLinker {
  constructor(
    private readonly db: AppDatabase,
    private readonly broadcast: Broadcast,
    private readonly runtimes: Map<string, ManagedRuntime>,
  ) {}

  indexSessionFromPiResponse(managed: ManagedRuntime, data: Record<string, unknown>): void {
    const sessionId = typeof data.sessionId === "string" ? data.sessionId : managed.runtime.sessionId;
    const sessionFileFromResponse = typeof data.sessionFile === "string" ? data.sessionFile : typeof data.piSessionFile === "string" ? data.piSessionFile : undefined;
    const sessionFile = sessionFileFromResponse ?? (sessionId ? findPiSessionFileById(sessionId, managed.runtime.cwd) : undefined);
    if (!sessionId || !sessionFile) return;

    const existing = this.db.getSession(sessionId);
    const fileSummary = existing?.title ? undefined : readPiSessionConversationSummary(sessionFile);
    if (!existing && !fileSummary) return;
    const now = Date.now();
    const session: GuiSession = this.db.upsertSession({
      id: sessionId,
      projectId: managed.runtime.projectId,
      piSessionFile: sessionFile,
      host: existing?.host ?? managed.runtime.host ?? this.db.getExecutionHost(),
      title: existing?.title ?? fileSummary?.title,
      createdAt: existing?.createdAt ?? managed.runtime.startedAt ?? now,
      updatedAt: now,
      runtimeId: managed.runtime.id,
    });
    if (this.db.isSessionVisible(session)) {
      this.broadcast({ type: "session.updated", session });
    }
  }

  findRuntimeForSession(session: GuiSession): Runtime | undefined {
    if (session.runtimeId) {
      const managed = this.runtimes.get(session.runtimeId);
      if (managed && !managed.runtime.archivedAt) return managed.runtime;

      const sourceRuntime = this.db.getRuntime(session.runtimeId);
      if (sourceRuntime && !sourceRuntime.archivedAt && sourceRuntime.sessionId === session.id) return sourceRuntime;
    }

    for (const managed of this.runtimes.values()) {
      if (managed.runtime.sessionId === session.id && !managed.runtime.archivedAt) return managed.runtime;
    }

    return this.db.getLatestRuntimeBySessionId(session.id);
  }
}
