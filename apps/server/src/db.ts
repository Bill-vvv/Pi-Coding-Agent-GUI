import Database from "better-sqlite3";
import { mkdirSync } from "node:fs";
import { dirname, resolve } from "node:path";
import type { AppSettings, GuiEvent, GuiEventKind, Project, Runtime, RuntimeStatus } from "@pi-gui/shared";

type ProjectRow = {
  id: string;
  name: string;
  cwd: string;
  last_opened_at: number;
  default_model: string | null;
};

type RuntimeRow = {
  id: string;
  project_id: string;
  cwd: string;
  status: RuntimeStatus;
  pid: number | null;
  session_id: string | null;
  started_at: number | null;
  archived_at: number | null;
};

type EventRow = {
  id: number;
  runtime_id: string;
  project_id: string;
  timestamp: number;
  kind: GuiEventKind;
  payload: string;
};

export class AppDatabase {
  private db: Database.Database;

  constructor(filePath = defaultDbPath()) {
    mkdirSync(dirname(filePath), { recursive: true });
    this.db = new Database(filePath);
    this.db.pragma("journal_mode = WAL");
    this.migrate();
    this.markOrphanedRuntimesCrashed();
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

  appendEvent(input: Omit<GuiEvent, "id" | "timestamp"> & { timestamp?: number }): GuiEvent {
    const timestamp = input.timestamp ?? Date.now();
    const payload = JSON.stringify(input.payload);
    if (payload === undefined) {
      throw new Error("Event payload must be JSON-serializable");
    }

    const result = this.db
      .prepare(
        `insert into events (runtime_id, project_id, timestamp, kind, payload)
         values (?, ?, ?, ?, ?)`,
      )
      .run(input.runtimeId, input.projectId, timestamp, input.kind, payload);

    return {
      id: Number(result.lastInsertRowid),
      runtimeId: input.runtimeId,
      projectId: input.projectId,
      timestamp,
      kind: input.kind,
      payload: input.payload,
    };
  }

  listEvents(afterEventId = 0, limit = 500): GuiEvent[] {
    const boundedLimit = Math.max(1, Math.min(limit, 2000));
    const rows = this.db
      .prepare("select * from events where id > ? order by id asc limit ?")
      .all(afterEventId, boundedLimit) as EventRow[];
    return rows.map(eventFromRow);
  }

  recentEvents(limit = 200): GuiEvent[] {
    const rows = this.db
      .prepare("select * from events order by id desc limit ?")
      .all(limit) as EventRow[];
    return rows.reverse().map(eventFromRow);
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

  private migrate(): void {
    this.db.exec(`
      create table if not exists projects (
        id text primary key,
        name text not null,
        cwd text not null unique,
        last_opened_at integer not null,
        default_model text
      );

      create table if not exists runtimes (
        id text primary key,
        project_id text not null,
        cwd text not null,
        status text not null,
        pid integer,
        session_id text,
        started_at integer,
        archived_at integer,
        ended_at integer,
        created_at integer not null,
        updated_at integer not null,
        foreign key(project_id) references projects(id)
      );

      create index if not exists runtimes_project_id_idx on runtimes(project_id);
      create index if not exists runtimes_status_idx on runtimes(status);

      create table if not exists sessions (
        id text primary key,
        project_id text not null,
        pi_session_file text not null unique,
        title text,
        created_at integer not null,
        updated_at integer not null,
        runtime_id text,
        foreign key(project_id) references projects(id)
      );

      create table if not exists events (
        id integer primary key autoincrement,
        runtime_id text not null,
        project_id text not null,
        timestamp integer not null,
        kind text not null,
        payload text not null
      );

      create index if not exists events_runtime_id_idx on events(runtime_id, id);
      create index if not exists events_project_id_idx on events(project_id, id);

      create table if not exists settings (
        key text primary key,
        value text not null,
        updated_at integer not null
      );
    `);

    this.ensureColumn("runtimes", "archived_at", "integer");
    this.ensureColumn("runtimes", "ended_at", "integer");
  }

  private ensureColumn(tableName: string, columnName: string, columnType: string): void {
    const columns = this.db.prepare(`pragma table_info(${tableName})`).all() as Array<{ name: string }>;
    if (!columns.some((column) => column.name === columnName)) {
      this.db.prepare(`alter table ${tableName} add column ${columnName} ${columnType}`).run();
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

    this.db.transaction((rows: RuntimeRow[]) => {
      updateRuntimes.run(timestamp, timestamp);
      for (const row of rows) {
        const crashedRuntime = runtimeFromRow({ ...row, status: "crashed", pid: null });
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

function projectFromRow(row: ProjectRow): Project {
  return {
    id: row.id,
    name: row.name,
    cwd: row.cwd,
    lastOpenedAt: row.last_opened_at,
    defaultModel: row.default_model ?? undefined,
  };
}

function parseThinkingLevel(value: string): AppSettings["defaultThinkingLevel"] {
  return value === "off" || value === "minimal" || value === "low" || value === "medium" || value === "high" || value === "xhigh"
    ? value
    : undefined;
}

function runtimeFromRow(row: RuntimeRow): Runtime {
  return {
    id: row.id,
    projectId: row.project_id,
    cwd: row.cwd,
    status: row.status,
    pid: row.pid ?? undefined,
    sessionId: row.session_id ?? undefined,
    startedAt: row.started_at ?? undefined,
    archivedAt: row.archived_at ?? undefined,
  };
}

function eventFromRow(row: EventRow): GuiEvent {
  let payload: unknown;
  try {
    payload = JSON.parse(row.payload);
  } catch (error) {
    throw new Error(`Failed to parse event payload JSON for event ${row.id}: ${(error as Error).message}`);
  }
  return {
    id: row.id,
    runtimeId: row.runtime_id,
    projectId: row.project_id,
    timestamp: row.timestamp,
    kind: row.kind,
    payload,
  };
}
