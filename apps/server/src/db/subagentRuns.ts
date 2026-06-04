import type Database from "better-sqlite3";
import type { SubagentRun } from "@pi-gui/shared";
import { subagentRunFromRow } from "./mappers.js";
import type { SubagentRunRow } from "./rows.js";

const STALE_SUBAGENT_ERROR = "GUI server restarted while this sub-agent was running; the child process cannot be reattached.";

export class SubagentRunStore {
  constructor(private readonly db: Database.Database) {}

  upsertSubagentRun(run: SubagentRun): SubagentRun {
    this.db
      .prepare(
        `insert into subagent_runs (id, project_id, parent_runtime_id, parent_tool_call_id, parent_tool_message_id, agent, mode, context_mode, status, started_at, updated_at, finished_at, final_text, error_message, runs_json)
         values (@id, @projectId, @parentRuntimeId, @parentToolCallId, @parentToolMessageId, @agent, @mode, @contextMode, @status, @startedAt, @updatedAt, @finishedAt, @finalText, @errorMessage, @runsJson)
         on conflict(id) do update set
           project_id = excluded.project_id,
           parent_runtime_id = excluded.parent_runtime_id,
           parent_tool_call_id = excluded.parent_tool_call_id,
           parent_tool_message_id = excluded.parent_tool_message_id,
           agent = excluded.agent,
           mode = excluded.mode,
           context_mode = excluded.context_mode,
           status = excluded.status,
           started_at = excluded.started_at,
           updated_at = excluded.updated_at,
           finished_at = excluded.finished_at,
           final_text = excluded.final_text,
           error_message = excluded.error_message,
           runs_json = excluded.runs_json`,
      )
      .run(subagentRunParams(run));
    return this.getSubagentRun(run.id) ?? run;
  }

  getSubagentRun(id: string): SubagentRun | undefined {
    const row = this.db.prepare("select * from subagent_runs where id = ?").get(id) as SubagentRunRow | undefined;
    return row ? subagentRunFromRow(row) : undefined;
  }

  getSubagentRunByParentToolCall(parentRuntimeId: string, parentToolCallId: string): SubagentRun | undefined {
    const row = this.db
      .prepare("select * from subagent_runs where parent_runtime_id = ? and parent_tool_call_id = ? order by updated_at desc limit 1")
      .get(parentRuntimeId, parentToolCallId) as SubagentRunRow | undefined;
    return row ? subagentRunFromRow(row) : undefined;
  }

  listSubagentRuns(parentRuntimeId?: string, limit = 500): SubagentRun[] {
    const boundedLimit = Math.max(1, Math.min(limit, 1000));
    const rows = parentRuntimeId
      ? (this.db
          .prepare("select * from subagent_runs where parent_runtime_id = ? order by updated_at desc limit ?")
          .all(parentRuntimeId, boundedLimit) as SubagentRunRow[])
      : (this.db.prepare("select * from subagent_runs order by updated_at desc limit ?").all(boundedLimit) as SubagentRunRow[]);
    return rows.map(subagentRunFromRow);
  }

  listActiveSubagentRuns(limit = 500): SubagentRun[] {
    const boundedLimit = Math.max(1, Math.min(limit, 1000));
    const rows = this.db
      .prepare("select * from subagent_runs where status in ('pending', 'running') order by updated_at desc limit ?")
      .all(boundedLimit) as SubagentRunRow[];
    return rows.map(subagentRunFromRow);
  }

  markOrphanedSubagentRunsFailed(timestamp = Date.now()): void {
    const rows = this.db.prepare("select * from subagent_runs where status in ('pending', 'running')").all() as SubagentRunRow[];
    if (rows.length === 0) return;

    const update = this.db.prepare(
      `update subagent_runs
       set status = 'failed', finished_at = coalesce(finished_at, ?), updated_at = ?, error_message = coalesce(error_message, ?)
       where status in ('pending', 'running')`,
    );
    update.run(timestamp, timestamp, STALE_SUBAGENT_ERROR);
  }

  listChildSessionFiles(limit = 2000): Set<string> {
    const boundedLimit = Math.max(1, Math.min(limit, 5000));
    const rows = this.db.prepare("select runs_json from subagent_runs order by updated_at desc limit ?").all(boundedLimit) as Array<{ runs_json: string }>;
    const files = new Set<string>();
    for (const row of rows) {
      for (const child of parseRunsJson(row.runs_json)) {
        if (child.sessionFile) files.add(child.sessionFile);
      }
    }
    return files;
  }
}

function parseRunsJson(value: string): Array<{ sessionFile?: string }> {
  try {
    const parsed = JSON.parse(value) as unknown;
    if (!Array.isArray(parsed)) return [];
    return parsed.flatMap((item) => (isSessionFileRecord(item) ? [{ sessionFile: item.sessionFile }] : []));
  } catch {
    return [];
  }
}

function isSessionFileRecord(value: unknown): value is { sessionFile?: string } {
  return typeof value === "object" && value !== null && !Array.isArray(value) && (typeof (value as { sessionFile?: unknown }).sessionFile === "string" || (value as { sessionFile?: unknown }).sessionFile === undefined);
}

function subagentRunParams(run: SubagentRun): Record<string, unknown> {
  return {
    id: run.id,
    projectId: run.projectId,
    parentRuntimeId: run.parentRuntimeId,
    parentToolCallId: run.parentToolCallId,
    parentToolMessageId: run.parentToolMessageId,
    agent: run.agent,
    mode: run.mode,
    contextMode: run.contextMode ?? null,
    status: run.status,
    startedAt: run.startedAt,
    updatedAt: run.updatedAt,
    finishedAt: run.finishedAt ?? null,
    finalText: run.finalText ?? null,
    errorMessage: run.errorMessage ?? null,
    runsJson: JSON.stringify(run.runs),
  };
}
