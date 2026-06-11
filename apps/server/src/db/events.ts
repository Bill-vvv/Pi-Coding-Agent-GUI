import type Database from "better-sqlite3";
import type { GuiEvent, GuiEventKind } from "@pi-gui/shared";
import { eventFromRow } from "./mappers.js";
import type { EventRow } from "./rows.js";

export class EventLogStore {
  private eventsSincePrune = 0;
  private readonly maxEventRows = boundedIntegerEnv("PI_GUI_EVENT_LOG_MAX_ROWS", 20_000, 1_000, 1_000_000);
  private readonly lastEventIdStatement: Database.Statement;
  private readonly firstEventIdStatement: Database.Statement;
  private readonly insertEventStatement: Database.Statement;
  private readonly pruneEventLogStatement: Database.Statement;

  constructor(private readonly db: Database.Database) {
    this.lastEventIdStatement = this.db.prepare("select coalesce(max(id), 0) as id from events");
    this.firstEventIdStatement = this.db.prepare("select coalesce(min(id), 0) as id from events");
    this.insertEventStatement = this.db.prepare(
      `insert into events (runtime_id, project_id, timestamp, kind, payload)
       values (?, ?, ?, ?, ?)`,
    );
    this.pruneEventLogStatement = this.db.prepare(
      `delete from events
       where id in (
         select id from events order by id desc limit -1 offset ?
       )`,
    );
  }

  lastEventId(): number {
    const row = this.lastEventIdStatement.get() as { id: number };
    return row.id;
  }

  firstEventId(): number {
    const row = this.firstEventIdStatement.get() as { id: number };
    return row.id;
  }

  appendEvent(input: Omit<GuiEvent, "id" | "timestamp"> & { timestamp?: number }): GuiEvent {
    const timestamp = input.timestamp ?? Date.now();
    const payload = JSON.stringify(input.payload);
    if (payload === undefined) {
      throw new Error("Event payload must be JSON-serializable");
    }

    const result = this.insertEventStatement.run(input.runtimeId, input.projectId, timestamp, input.kind, payload);
    this.pruneEventLogEventually();

    return {
      id: Number(result.lastInsertRowid),
      runtimeId: input.runtimeId,
      projectId: input.projectId,
      timestamp,
      kind: input.kind,
      payload: input.payload,
    };
  }

  listEvents(afterEventId = 0, limit = 500, filters: { projectId?: string; runtimeId?: string; kinds?: GuiEventKind[] } = {}): GuiEvent[] {
    const boundedLimit = Math.max(1, Math.min(limit, 2000));
    const { conditions, params } = eventFilterQuery("id > ?", [afterEventId], filters);

    const rows = this.db
      .prepare(`select * from events where ${conditions.join(" and ")} order by id asc limit ?`)
      .all(...params, boundedLimit) as EventRow[];
    return rows.map(eventFromRow);
  }

  listRecentEvents(limit = 500, filters: { projectId?: string; runtimeId?: string; kinds?: GuiEventKind[] } = {}): GuiEvent[] {
    const boundedLimit = Math.max(1, Math.min(limit, 2000));
    const { conditions, params } = eventFilterQuery(undefined, [], filters);
    const whereClause = conditions.length > 0 ? `where ${conditions.join(" and ")}` : "";

    const rows = this.db
      .prepare(`select * from events ${whereClause} order by id desc limit ?`)
      .all(...params, boundedLimit) as EventRow[];
    return rows.reverse().map(eventFromRow);
  }

  listEventsBudgeted(afterEventId = 0, limit = 500, maxPayloadBytes?: number, filters: { projectId?: string; runtimeId?: string; kinds?: GuiEventKind[] } = {}): { events: GuiEvent[]; truncated: boolean } {
    const boundedLimit = Math.max(1, Math.min(limit, 2000));
    const { conditions, params } = eventFilterQuery("id > ?", [afterEventId], filters);
    const rows = this.db
      .prepare(`select * from events where ${conditions.join(" and ")} order by id asc limit ?`)
      .all(...params, boundedLimit) as EventRow[];
    const selectedRows = rowsWithinPayloadBudget(rows, maxPayloadBytes);
    return { events: selectedRows.map(eventFromRow), truncated: selectedRows.length < rows.length };
  }

  recentEvents(limit = 200, maxPayloadBytes?: number): GuiEvent[] {
    const rows = this.db
      .prepare("select * from events order by id desc limit ?")
      .all(Math.max(1, limit)) as EventRow[];

    return rowsWithinPayloadBudget(rows, maxPayloadBytes).reverse().map(eventFromRow);
  }

  private pruneEventLogEventually(): void {
    this.eventsSincePrune += 1;
    if (this.eventsSincePrune < 100) return;
    this.eventsSincePrune = 0;
    this.pruneEventLog();
  }

  private pruneEventLog(): void {
    this.pruneEventLogStatement.run(this.maxEventRows);
  }
}

function eventFilterQuery(
  initialCondition: string | undefined,
  initialParams: Array<string | number>,
  filters: { projectId?: string; runtimeId?: string; kinds?: GuiEventKind[] },
): { conditions: string[]; params: Array<string | number> } {
  const conditions = initialCondition ? [initialCondition] : [];
  const params = [...initialParams];

  if (filters.projectId) {
    conditions.push("project_id = ?");
    params.push(filters.projectId);
  }
  if (filters.runtimeId) {
    conditions.push("runtime_id = ?");
    params.push(filters.runtimeId);
  }
  const kinds = filters.kinds?.filter((kind, index, values) => values.indexOf(kind) === index);
  if (kinds && kinds.length > 0) {
    conditions.push(`kind in (${kinds.map(() => "?").join(", ")})`);
    params.push(...kinds);
  }

  return { conditions, params };
}

function rowsWithinPayloadBudget(rows: EventRow[], maxPayloadBytes: number | undefined): EventRow[] {
  const byteBudget = maxPayloadBytes && maxPayloadBytes > 0 ? maxPayloadBytes : undefined;
  if (byteBudget === undefined) return rows;

  const selectedRows: EventRow[] = [];
  let selectedPayloadBytes = 0;
  for (const row of rows) {
    const rowPayloadBytes = Buffer.byteLength(row.payload, "utf8");
    if (selectedRows.length > 0 && selectedPayloadBytes + rowPayloadBytes > byteBudget) break;
    selectedRows.push(row);
    selectedPayloadBytes += rowPayloadBytes;
    if (selectedPayloadBytes >= byteBudget) break;
  }
  return selectedRows;
}

function boundedIntegerEnv(name: string, fallback: number, min: number, max: number): number {
  const rawValue = process.env[name];
  if (!rawValue) return fallback;
  const value = Number(rawValue);
  if (!Number.isInteger(value)) return fallback;
  return Math.max(min, Math.min(max, value));
}
