import type Database from "better-sqlite3";

export function migrateDatabase(db: Database.Database): void {
  db.exec(`
    create table if not exists projects (
      id text primary key,
      name text not null,
      cwd text not null unique,
      last_opened_at integer not null,
      default_model text,
      default_runtime_profile_id text,
      cwd_wsl text,
      cwd_windows text
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

    create index if not exists sessions_updated_id_idx on sessions(updated_at, id);
    create index if not exists sessions_project_updated_id_idx on sessions(project_id, updated_at, id);

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
    create index if not exists events_runtime_kind_id_idx on events(runtime_id, kind, id);
    create index if not exists events_project_kind_id_idx on events(project_id, kind, id);

    create table if not exists conversation_messages (
      runtime_id text not null,
      project_id text not null,
      message_id text not null,
      role text not null,
      text text not null,
      thinking text,
      title text,
      is_streaming integer not null default 0,
      tool_details_json text,
      timestamp integer,
      created_at integer not null,
      updated_at integer not null,
      primary key(runtime_id, message_id),
      foreign key(project_id) references projects(id)
    );

    create index if not exists conversation_messages_runtime_created_idx on conversation_messages(runtime_id, created_at);
    create index if not exists conversation_messages_project_created_idx on conversation_messages(project_id, created_at);
    create index if not exists conversation_messages_runtime_role_created_idx on conversation_messages(runtime_id, role, created_at);

    create table if not exists runtime_conversation_summaries (
      runtime_id text primary key,
      project_id text not null,
      first_user_text text,
      first_message_text text,
      latest_message_text text,
      latest_updated_at integer,
      latest_assistant_completed_at integer,
      message_count integer not null default 0,
      refreshed_at integer not null,
      foreign key(runtime_id) references runtimes(id),
      foreign key(project_id) references projects(id)
    );

    create index if not exists runtime_conversation_summaries_project_idx on runtime_conversation_summaries(project_id, latest_updated_at);

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

    create table if not exists subagent_runs (
      id text primary key,
      project_id text not null,
      parent_runtime_id text not null,
      parent_tool_call_id text not null,
      parent_tool_message_id text not null,
      agent text not null,
      mode text not null,
      context_mode text,
      status text not null,
      started_at integer not null,
      updated_at integer not null,
      finished_at integer,
      final_text text,
      error_message text,
      runs_json text not null,
      foreign key(project_id) references projects(id)
    );

    create index if not exists subagent_runs_parent_runtime_idx on subagent_runs(parent_runtime_id, updated_at);
    create index if not exists subagent_runs_status_idx on subagent_runs(status, updated_at);

    create table if not exists settings (
      key text primary key,
      value text not null,
      updated_at integer not null
    );

    create table if not exists token_usage_file_cache (
      file_path text primary key,
      parser_version integer not null,
      max_line_bytes integer not null,
      project_fingerprint text not null,
      mtime_ms real not null,
      size integer not null,
      contribution_json text not null,
      updated_at integer not null
    );

    create index if not exists token_usage_file_cache_context_idx
      on token_usage_file_cache(parser_version, max_line_bytes, project_fingerprint, updated_at);

    create table if not exists session_file_summary_cache (
      file_path text primary key,
      parser_version integer not null,
      mtime_ms real not null,
      size integer not null,
      session_id text,
      cwd text,
      timestamp text,
      title text,
      detail text,
      summary_updated_at integer,
      message_count integer not null default 0,
      latest_assistant_completed_at integer,
      cache_updated_at integer not null
    );

    create index if not exists session_file_summary_cache_context_idx
      on session_file_summary_cache(parser_version, cache_updated_at);

    create table if not exists session_token_usage_cache (
      file_path text primary key,
      parser_version integer not null,
      max_line_bytes integer not null,
      mtime_ms real not null,
      size integer not null,
      usage_json text not null,
      updated_at integer not null
    );

    create index if not exists session_token_usage_cache_context_idx
      on session_token_usage_cache(parser_version, max_line_bytes, updated_at);

    create table if not exists rewind_checkpoints (
      project_id text not null,
      snapshot_id text not null,
      root text not null,
      created_at integer not null,
      captured_files integer not null,
      captured_symlinks integer not null,
      deleted_entries integer not null,
      skipped integer not null,
      captured_bytes integer not null,
      new_bytes integer not null,
      indexed_at integer not null,
      primary key(project_id, snapshot_id),
      foreign key(project_id) references projects(id)
    );

    create index if not exists rewind_checkpoints_project_created_idx
      on rewind_checkpoints(project_id, created_at, snapshot_id);

    create table if not exists rewind_checkpoint_operations (
      id integer primary key autoincrement,
      project_id text not null,
      kind text not null,
      snapshot_id text not null,
      created_at integer not null,
      ok integer not null,
      rollback_snapshot_id text,
      error text,
      foreign key(project_id) references projects(id)
    );

    create index if not exists rewind_checkpoint_operations_created_idx
      on rewind_checkpoint_operations(created_at, id);

    create table if not exists rewind_checkpoint_conversation_links (
      project_id text not null,
      snapshot_id text not null,
      runtime_id text,
      session_id text,
      target_entry_id text,
      capture_source text not null,
      created_at integer not null,
      primary key(project_id, snapshot_id),
      foreign key(project_id) references projects(id)
    );

    create table if not exists rewind_jump_history (
      id integer primary key autoincrement,
      project_id text not null,
      snapshot_id text not null,
      runtime_id text not null,
      source_session_id text,
      target_entry_id text not null,
      result_session_id text,
      result_entry_id text,
      created_at integer not null,
      ok integer not null,
      rollback_snapshot_id text,
      error text,
      foreign key(project_id) references projects(id)
    );

    create index if not exists rewind_jump_history_project_created_idx
      on rewind_jump_history(project_id, created_at, id);
  `);

  const addedProjectHostCwdColumns = [
    ensureColumn(db, "projects", "cwd_wsl", "text"),
    ensureColumn(db, "projects", "cwd_windows", "text"),
  ].some(Boolean);
  ensureColumn(db, "projects", "default_runtime_profile_id", "text");
  ensureColumn(db, "projects", "host_kind", "text");
  ensureColumn(db, "projects", "host_id", "text");
  ensureColumn(db, "projects", "host_label", "text");
  ensureColumn(db, "runtimes", "archived_at", "integer");
  ensureColumn(db, "runtimes", "ended_at", "integer");
  ensureColumn(db, "runtimes", "host_kind", "text");
  ensureColumn(db, "runtimes", "host_id", "text");
  ensureColumn(db, "runtimes", "host_label", "text");
  ensureColumn(db, "rewind_checkpoint_conversation_links", "target_entry_id", "text");
  ensureColumn(db, "runtimes", "runtime_profile_id", "text");
  ensureColumn(db, "runtimes", "enabled_capability_ids_json", "text");
  ensureColumn(db, "sessions", "host_kind", "text");
  ensureColumn(db, "sessions", "host_id", "text");
  ensureColumn(db, "sessions", "host_label", "text");
  ensureColumn(db, "runtime_conversation_state", "session_tokens_json", "text");
  ensureColumn(db, "conversation_messages", "tool_details_json", "text");
  if (addedProjectHostCwdColumns) backfillProjectHostCwds(db);

  const addedRuntimeConfigColumns = [
    ensureColumn(db, "runtimes", "model", "text"),
    ensureColumn(db, "runtimes", "thinking_level", "text"),
    ensureColumn(db, "runtimes", "response_mode", "text"),
  ].some(Boolean);
  if (addedRuntimeConfigColumns) backfillRuntimeConfig(db);
  backfillRuntimeConversationSummaries(db);
}

function backfillProjectHostCwds(db: Database.Database): void {
  db.exec(`
    update projects
    set cwd_wsl = cwd
    where cwd_wsl is null and host_kind = 'wsl';

    update projects
    set cwd_windows = cwd
    where cwd_windows is null and host_kind = 'windows';
  `);
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

function backfillRuntimeConversationSummaries(db: Database.Database): void {
  const row = db.prepare("select count(*) as count from runtime_conversation_summaries").get() as { count: number };
  const messageRow = db.prepare("select count(*) as count from conversation_messages").get() as { count: number };
  if (row.count > 0 || messageRow.count === 0) return;

  db.exec(`
    insert or replace into runtime_conversation_summaries (
      runtime_id,
      project_id,
      first_user_text,
      first_message_text,
      latest_message_text,
      latest_updated_at,
      latest_assistant_completed_at,
      message_count,
      refreshed_at
    )
    select
      r.id as runtime_id,
      r.project_id,
      (
        select m.text from conversation_messages m
        where m.runtime_id = r.id and m.role = 'user' and trim(m.text) != ''
        order by m.created_at asc, m.rowid asc limit 1
      ) as first_user_text,
      (
        select m.text from conversation_messages m
        where m.runtime_id = r.id and m.role in ('user', 'assistant') and trim(m.text) != ''
        order by m.created_at asc, m.rowid asc limit 1
      ) as first_message_text,
      (
        select m.text from conversation_messages m
        where m.runtime_id = r.id and m.role in ('user', 'assistant') and trim(m.text) != ''
        order by m.created_at desc, m.rowid desc limit 1
      ) as latest_message_text,
      (
        select m.updated_at from conversation_messages m
        where m.runtime_id = r.id and m.role in ('user', 'assistant') and trim(m.text) != ''
        order by m.created_at desc, m.rowid desc limit 1
      ) as latest_updated_at,
      (
        select m.updated_at from conversation_messages m
        where m.runtime_id = r.id and m.role = 'assistant' and trim(m.text) != '' and m.is_streaming = 0
        order by m.created_at desc, m.rowid desc limit 1
      ) as latest_assistant_completed_at,
      (
        select count(*) from conversation_messages m
        where m.runtime_id = r.id and m.role in ('user', 'assistant') and trim(m.text) != ''
      ) as message_count,
      cast(strftime('%s', 'now') as integer) * 1000 as refreshed_at
    from runtimes r
    where exists (select 1 from conversation_messages m where m.runtime_id = r.id and m.role in ('user', 'assistant') and trim(m.text) != '');
  `);
}

function ensureColumn(db: Database.Database, tableName: string, columnName: string, columnType: string): boolean {
  const columns = db.prepare(`pragma table_info(${tableName})`).all() as Array<{ name: string }>;
  if (columns.some((column) => column.name === columnName)) return false;
  db.prepare(`alter table ${tableName} add column ${columnName} ${columnType}`).run();
  return true;
}
