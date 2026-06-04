import type Database from "better-sqlite3";

export function migrateDatabase(db: Database.Database): void {
  db.exec(`
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
      model text,
      thinking_level text,
      response_mode text,
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

    create table if not exists conversation_messages (
      runtime_id text not null,
      project_id text not null,
      message_id text not null,
      role text not null,
      text text not null,
      thinking text,
      title text,
      is_streaming integer not null default 0,
      timestamp integer,
      created_at integer not null,
      updated_at integer not null,
      primary key(runtime_id, message_id),
      foreign key(project_id) references projects(id)
    );

    create index if not exists conversation_messages_runtime_created_idx on conversation_messages(runtime_id, created_at);
    create index if not exists conversation_messages_project_created_idx on conversation_messages(project_id, created_at);

    create table if not exists runtime_conversation_state (
      runtime_id text primary key,
      project_id text not null,
      tokens integer,
      context_window integer,
      percent real,
      updated_at integer not null,
      busy integer not null default 0,
      foreign key(project_id) references projects(id)
    );

    create table if not exists settings (
      key text primary key,
      value text not null,
      updated_at integer not null
    );
  `);

  ensureColumn(db, "runtimes", "archived_at", "integer");
  ensureColumn(db, "runtimes", "ended_at", "integer");
  const addedRuntimeConfigColumns = [
    ensureColumn(db, "runtimes", "model", "text"),
    ensureColumn(db, "runtimes", "thinking_level", "text"),
    ensureColumn(db, "runtimes", "response_mode", "text"),
  ].some(Boolean);
  if (addedRuntimeConfigColumns) backfillRuntimeConfig(db);
}

function backfillRuntimeConfig(db: Database.Database): void {
  db.exec(`
    update runtimes
    set model = (select value from settings where key = 'defaultModel')
    where model is null and exists (select 1 from settings where key = 'defaultModel');

    update runtimes
    set thinking_level = coalesce((select value from settings where key = 'defaultThinkingLevel'), 'medium')
    where thinking_level is null;

    update runtimes
    set response_mode = coalesce((select value from settings where key = 'responseMode'), 'normal')
    where response_mode is null;
  `);
}

function ensureColumn(db: Database.Database, tableName: string, columnName: string, columnType: string): boolean {
  const columns = db.prepare(`pragma table_info(${tableName})`).all() as Array<{ name: string }>;
  if (columns.some((column) => column.name === columnName)) return false;
  db.prepare(`alter table ${tableName} add column ${columnName} ${columnType}`).run();
  return true;
}
