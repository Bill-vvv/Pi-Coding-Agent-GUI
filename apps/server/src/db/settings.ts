import type Database from "better-sqlite3";
import { isRuntimeProfileId, type AppSettings } from "@pi-gui/shared";
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
      if (row.key === "defaultRuntimeProfileId" && isRuntimeProfileId(row.value)) settings.defaultRuntimeProfileId = row.value;
      if (row.key === "confirmedProjectExtensionIds") settings.confirmedProjectExtensionIds = parseStringArray(row.value);
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
    if (settings.defaultRuntimeProfileId !== undefined) {
      this.upsertSetting("defaultRuntimeProfileId", settings.defaultRuntimeProfileId, now);
    }
    if (settings.confirmedProjectExtensionIds !== undefined) {
      this.upsertSetting("confirmedProjectExtensionIds", JSON.stringify([...new Set(settings.confirmedProjectExtensionIds)].sort()), now);
    }
    return this.getSettings();
  }

  getSettingValue(key: string): string | undefined {
    const row = this.db.prepare("select value from settings where key = ?").get(key) as { value: string } | undefined;
    return row?.value;
  }

  setSettingValue(key: string, value: string | undefined, timestamp = Date.now()): void {
    this.upsertSetting(key, value?.trim() ?? "", timestamp);
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

function parseStringArray(value: string): string[] {
  try {
    const parsed = JSON.parse(value);
    if (!Array.isArray(parsed)) return [];
    return [...new Set(parsed.filter((item): item is string => typeof item === "string" && item.trim().length > 0).map((item) => item.trim()))].sort();
  } catch {
    return [];
  }
}
