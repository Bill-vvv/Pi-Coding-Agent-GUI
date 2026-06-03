import Database from "better-sqlite3";
import { mkdirSync } from "node:fs";
import { dirname, resolve } from "node:path";
import type { AppSettings, ConversationContextUsage, ConversationMessage, GuiEvent, GuiSession, Project, Runtime, RuntimeConversationSummary } from "@pi-gui/shared";
import { ConversationStore } from "./db/conversations.js";
import { EventLogStore } from "./db/events.js";
import { parseThinkingLevel, projectFromRow, runtimeFromRow, sessionFromRow } from "./db/mappers.js";
import type { ProjectRow, RuntimeRow, SessionRow } from "./db/rows.js";
import { migrateDatabase } from "./db/schema.js";

export class AppDatabase {
  private readonly db: Database.Database;
  private readonly conversations: ConversationStore;
  private readonly eventLog: EventLogStore;

  constructor(filePath = defaultDbPath()) {
    mkdirSync(dirname(filePath), { recursive: true });
    this.db = new Database(filePath);
    this.db.pragma("journal_mode = WAL");
    migrateDatabase(this.db);
    this.conversations = new ConversationStore(this.db);
    this.eventLog = new EventLogStore(this.db);
    this.markOrphanedRuntimesCrashed();
  }

  close(): void {
    this.db.close();
  }

  listProjects(): Project[] {
    const rows = this.db.prepare("select * from projects order by last_opened_at desc").all() as ProjectRow[];
    return rows.map(projectFromRow);
  }

  getProject(id: string): Project | undefined {
    const row = this.db.prepare("select * from projects where id = ?").get(id) as ProjectRow | undefined;
    return row ? projectFromRow(row) : undefined;
  }

  createProject(project: Project): Project {
    this.db
      .prepare(
        `insert into projects (id, name, cwd, last_opened_at, default_model)
         values (@id, @name, @cwd, @lastOpenedAt, @defaultModel)`,
      )
      .run({ ...project, defaultModel: project.defaultModel ?? null });
    return project;
  }

  touchProject(id: string, timestamp = Date.now()): void {
    this.db.prepare("update projects set last_opened_at = ? where id = ?").run(timestamp, id);
  }

  getSettings(): AppSettings {
    const rows = this.db.prepare("select key, value from settings").all() as Array<{ key: string; value: string }>;
    const settings: AppSettings = {};
    for (const row of rows) {
      if (row.key === "defaultModel") settings.defaultModel = row.value;
      if (row.key === "defaultThinkingLevel") settings.defaultThinkingLevel = parseThinkingLevel(row.value);
      if (row.key === "responseMode") settings.responseMode = row.value === "fast" ? "fast" : "normal";
    }
    return settings;
  }

  updateSettings(settings: AppSettings): AppSettings {
    const now = Date.now();
    if (settings.defaultModel !== undefined) {
      this.upsertSetting("defaultModel", settings.defaultModel.trim(), now);
    }
    if (settings.defaultThinkingLevel !== undefined) {
      this.upsertSetting("defaultThinkingLevel", settings.defaultThinkingLevel, now);
    }
    if (settings.responseMode !== undefined) {
      this.upsertSetting("responseMode", settings.responseMode, now);
    }
    return this.getSettings();
  }

  upsertRuntime(runtime: Runtime): Runtime {
    const now = Date.now();
    this.db
      .prepare(
        `insert into runtimes (id, project_id, cwd, status, pid, session_id, started_at, archived_at, created_at, updated_at)
         values (@id, @projectId, @cwd, @status, @pid, @sessionId, @startedAt, @archivedAt, @createdAt, @updatedAt)
         on conflict(id) do update set
           status = excluded.status,
           pid = excluded.pid,
           session_id = excluded.session_id,
           started_at = excluded.started_at,
           archived_at = coalesce(excluded.archived_at, runtimes.archived_at),
           updated_at = excluded.updated_at`,
      )
      .run({
        id: runtime.id,
        projectId: runtime.projectId,
        cwd: runtime.cwd,
        status: runtime.status,
        pid: runtime.pid ?? null,
        sessionId: runtime.sessionId ?? null,
        startedAt: runtime.startedAt ?? null,
        archivedAt: runtime.archivedAt ?? null,
        createdAt: now,
        updatedAt: now,
      });
    return runtime;
  }

  listRuntimes(limit = 100): Runtime[] {
    const rows = this.db
      .prepare("select * from runtimes order by updated_at desc limit ?")
      .all(limit) as RuntimeRow[];
    return rows.map(runtimeFromRow);
  }

  getRuntime(id: string): Runtime | undefined {
    const row = this.db.prepare("select * from runtimes where id = ?").get(id) as RuntimeRow | undefined;
    return row ? runtimeFromRow(row) : undefined;
  }

  archiveRuntime(id: string, timestamp = Date.now()): Runtime | undefined {
    this.db
      .prepare("update runtimes set archived_at = coalesce(archived_at, ?), updated_at = ? where id = ?")
      .run(timestamp, timestamp, id);
    return this.getRuntime(id);
  }

  listSessions(projectId?: string, limit = 200): GuiSession[] {
    const boundedLimit = Math.max(1, Math.min(limit, 1000));
    const rows = projectId
      ? (this.db
          .prepare("select * from sessions where project_id = ? order by updated_at desc limit ?")
          .all(projectId, boundedLimit) as SessionRow[])
      : (this.db.prepare("select * from sessions order by updated_at desc limit ?").all(boundedLimit) as SessionRow[]);
    return rows.map(sessionFromRow);
  }

  getSession(id: string): GuiSession | undefined {
    const row = this.db.prepare("select * from sessions where id = ?").get(id) as SessionRow | undefined;
    return row ? sessionFromRow(row) : undefined;
  }

  upsertSession(session: GuiSession): GuiSession {
    this.db
      .prepare(
        `insert into sessions (id, project_id, pi_session_file, title, created_at, updated_at, runtime_id)
         values (@id, @projectId, @piSessionFile, @title, @createdAt, @updatedAt, @runtimeId)
         on conflict(id) do update set
           project_id = excluded.project_id,
           pi_session_file = excluded.pi_session_file,
           title = coalesce(excluded.title, sessions.title),
           updated_at = excluded.updated_at,
           runtime_id = excluded.runtime_id`,
      )
      .run({
        id: session.id,
        projectId: session.projectId,
        piSessionFile: session.piSessionFile,
        title: session.title ?? null,
        createdAt: session.createdAt,
        updatedAt: session.updatedAt,
        runtimeId: session.runtimeId ?? null,
      });
    return this.getSession(session.id) ?? session;
  }

  upsertConversationMessage(message: ConversationMessage): ConversationMessage {
    return this.conversations.upsertConversationMessage(message);
  }

  getConversationMessage(runtimeId: string, messageId: string): ConversationMessage | undefined {
    return this.conversations.getConversationMessage(runtimeId, messageId);
  }

  listConversationMessages(runtimeId: string, limit = 100): ConversationMessage[] {
    return this.conversations.listConversationMessages(runtimeId, limit);
  }

  listRuntimeConversationSummaries(limit = 100): RuntimeConversationSummary[] {
    return this.conversations.listRuntimeConversationSummaries(limit);
  }

  replaceConversationMessages(runtimeId: string, messages: ConversationMessage[]): void {
    this.conversations.replaceConversationMessages(runtimeId, messages);
  }

  getConversationContext(runtimeId: string): ConversationContextUsage | undefined {
    return this.conversations.getConversationContext(runtimeId);
  }

  updateConversationContext(runtimeId: string, projectId: string, usage: ConversationContextUsage): ConversationContextUsage {
    return this.conversations.updateConversationContext(runtimeId, projectId, usage);
  }

  getConversationBusy(runtimeId: string): boolean {
    return this.conversations.getConversationBusy(runtimeId);
  }

  setConversationBusy(runtimeId: string, projectId: string, busy: boolean, timestamp = Date.now()): boolean {
    return this.conversations.setConversationBusy(runtimeId, projectId, busy, timestamp);
  }

  lastEventId(): number {
    return this.eventLog.lastEventId();
  }

  appendEvent(input: Omit<GuiEvent, "id" | "timestamp"> & { timestamp?: number }): GuiEvent {
    return this.eventLog.appendEvent(input);
  }

  listEvents(afterEventId = 0, limit = 500): GuiEvent[] {
    return this.eventLog.listEvents(afterEventId, limit);
  }

  recentEvents(limit = 200, maxPayloadBytes?: number): GuiEvent[] {
    return this.eventLog.recentEvents(limit, maxPayloadBytes);
  }

  private upsertSetting(key: string, value: string, timestamp: number): void {
    if (value) {
      this.db
        .prepare(
          `insert into settings (key, value, updated_at)
           values (?, ?, ?)
           on conflict(key) do update set value = excluded.value, updated_at = excluded.updated_at`,
        )
        .run(key, value, timestamp);
    } else {
      this.db.prepare("delete from settings where key = ?").run(key);
    }
  }

  private markOrphanedRuntimesCrashed(): void {
    const orphaned = this.db
      .prepare("select * from runtimes where status in ('starting', 'running')")
      .all() as RuntimeRow[];
    if (orphaned.length === 0) return;

    const timestamp = Date.now();
    const updateRuntimes = this.db.prepare(
      `update runtimes
       set status = 'crashed', pid = null, ended_at = coalesce(ended_at, ?), updated_at = ?
       where status in ('starting', 'running')`,
    );
    const insertEvent = this.db.prepare(
      `insert into events (runtime_id, project_id, timestamp, kind, payload)
       values (?, ?, ?, ?, ?)`,
    );
    const clearBusy = this.db.prepare(
      `update runtime_conversation_state
       set busy = 0, updated_at = ?
       where runtime_id = ?`,
    );

    this.db.transaction((rows: RuntimeRow[]) => {
      updateRuntimes.run(timestamp, timestamp);
      for (const row of rows) {
        const crashedRuntime = runtimeFromRow({ ...row, status: "crashed", pid: null });
        clearBusy.run(timestamp, row.id);
        insertEvent.run(row.id, row.project_id, timestamp, "runtime_status", JSON.stringify(crashedRuntime));
        insertEvent.run(
          row.id,
          row.project_id,
          timestamp,
          "error",
          JSON.stringify({
            message: "GUI server restarted while this runtime was running; the previous Pi RPC process cannot be reattached.",
            reason: "orphaned_runtime_on_startup",
            previousStatus: row.status,
            previousPid: row.pid,
            status: "crashed",
          }),
        );
      }
    })(orphaned);
  }
}

function defaultDbPath(): string {
  return resolve(process.env.PI_GUI_DATA_DIR ?? ".pi-gui", "pi-gui.sqlite");
}
