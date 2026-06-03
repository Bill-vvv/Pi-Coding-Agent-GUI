import type Database from "better-sqlite3";
import type { GuiEvent } from "@pi-gui/shared";
import { eventFromRow } from "./mappers.js";
import type { EventRow } from "./rows.js";

export class EventLogStore {
  private eventsSincePrune = 0;
  private readonly maxEventRows = boundedIntegerEnv("PI_GUI_EVENT_LOG_MAX_ROWS", 20_000, 1_000, 1_000_000);

  constructor(private readonly db: Database.Database) {}

  lastEventId(): number {
    const row = this.db.prepare("select coalesce(max(id), 0) as id from events").get() as { id: number };
    return row.id;
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

  listEvents(afterEventId = 0, limit = 500): GuiEvent[] {
    const boundedLimit = Math.max(1, Math.min(limit, 2000));
    const rows = this.db
      .prepare("select * from events where id > ? order by id asc limit ?")
      .all(afterEventId, boundedLimit) as EventRow[];
    return rows.map(eventFromRow);
  }

  recentEvents(limit = 200, maxPayloadBytes?: number): GuiEvent[] {
    const rows = this.db
      .prepare("select * from events order by id desc limit ?")
      .all(Math.max(1, limit)) as EventRow[];

    const selectedRows: EventRow[] = [];
    let selectedPayloadBytes = 0;
    const byteBudget = maxPayloadBytes && maxPayloadBytes > 0 ? maxPayloadBytes : undefined;

    for (const row of rows) {
      const rowPayloadBytes = Buffer.byteLength(row.payload, "utf8");
      if (byteBudget !== undefined && selectedRows.length > 0 && selectedPayloadBytes + rowPayloadBytes > byteBudget) break;
      selectedRows.push(row);
      selectedPayloadBytes += rowPayloadBytes;
      if (byteBudget !== undefined && selectedPayloadBytes >= byteBudget) break;
    }

    return selectedRows.reverse().map(eventFromRow);
  }

  private pruneEventLogEventually(): void {
    this.eventsSincePrune += 1;
    if (this.eventsSincePrune < 100) return;
    this.eventsSincePrune = 0;
    this.pruneEventLog();
  }

  private pruneEventLog(): void {
    this.db
      .prepare(
        `delete from events
         where id in (
           select id from events order by id desc limit -1 offset ?
         )`,
      )
      .run(this.maxEventRows);
  }
}

function boundedIntegerEnv(name: string, fallback: number, min: number, max: number): number {
  const rawValue = process.env[name];
  if (!rawValue) return fallback;
  const value = Number(rawValue);
  if (!Number.isInteger(value)) return fallback;
  return Math.max(min, Math.min(max, value));
}
