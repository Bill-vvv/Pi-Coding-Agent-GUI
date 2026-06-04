import { useEffect, useState } from "react";
import type { UiPreferences } from "../types";

const UI_PREFERENCES_STORAGE_KEY = "pi-gui.uiPreferences";

const DEFAULT_UI_PREFERENCES: UiPreferences = {
  uiFontSize: "medium",
  chatFontSize: "medium",
  theme: "dark",
  accentColor: "amber",
  desktopNotificationsEnabled: false,
};

export function useUiPreferences() {
  const [uiPreferences, setUiPreferences] = useState<UiPreferences>(() => readUiPreferences());

  useEffect(() => {
    applyUiPreferences(uiPreferences);
    writeUiPreferences(uiPreferences);
  }, [uiPreferences]);

  return { uiPreferences, setUiPreferences };
}

function readUiPreferences(): UiPreferences {
  try {
    const raw = window.localStorage.getItem(UI_PREFERENCES_STORAGE_KEY);
    if (!raw) return DEFAULT_UI_PREFERENCES;
    const parsed = JSON.parse(raw) as Partial<UiPreferences>;
    return {
      uiFontSize: isUiFontSize(parsed.uiFontSize) ? parsed.uiFontSize : DEFAULT_UI_PREFERENCES.uiFontSize,
      chatFontSize: isChatFontSize(parsed.chatFontSize) ? parsed.chatFontSize : DEFAULT_UI_PREFERENCES.chatFontSize,
      theme: isThemeMode(parsed.theme) ? parsed.theme : DEFAULT_UI_PREFERENCES.theme,
      accentColor: isAccentColor(parsed.accentColor) ? parsed.accentColor : DEFAULT_UI_PREFERENCES.accentColor,
      desktopNotificationsEnabled: typeof parsed.desktopNotificationsEnabled === "boolean" ? parsed.desktopNotificationsEnabled : DEFAULT_UI_PREFERENCES.desktopNotificationsEnabled,
    };
  } catch {
    return DEFAULT_UI_PREFERENCES;
  }
}

function writeUiPreferences(preferences: UiPreferences) {
  try {
    window.localStorage.setItem(UI_PREFERENCES_STORAGE_KEY, JSON.stringify(preferences));
  } catch {
    // Ignore unavailable localStorage; preferences still apply for the current page lifetime.
  }
}

function applyUiPreferences(preferences: UiPreferences) {
  const root = document.documentElement;
  root.dataset.uiFontSize = preferences.uiFontSize;
  root.dataset.chatFontSize = preferences.chatFontSize;
  root.dataset.theme = preferences.theme;
  root.dataset.accentColor = preferences.accentColor;
}

function isUiFontSize(value: unknown): value is UiPreferences["uiFontSize"] {
  return value === "small" || value === "medium" || value === "large";
}

function isChatFontSize(value: unknown): value is UiPreferences["chatFontSize"] {
  return value === "small" || value === "medium" || value === "large";
}

function isThemeMode(value: unknown): value is UiPreferences["theme"] {
  return value === "dark" || value === "light" || value === "system";
}

function isAccentColor(value: unknown): value is UiPreferences["accentColor"] {
  return value === "amber" || value === "blue" || value === "green" || value === "rose";
}
