import type Database from "better-sqlite3";
import type { AppSettings } from "@pi-gui/shared";
import { parseThinkingLevel } from "./mappers.js";

export class SettingsStore {
  constructor(private readonly db: Database.Database) {}

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
}
