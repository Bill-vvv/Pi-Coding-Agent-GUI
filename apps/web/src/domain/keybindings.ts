export type GuiKeybindingActionId = "app.commandMenu.open" | "app.settings.open" | "composer.submit" | "composer.newLine" | "composer.followUp" | "composer.dequeue";
export type GuiKeybindingMap = Partial<Record<GuiKeybindingActionId, string[]>>;

export type GuiKeybindingDefinition = { id: GuiKeybindingActionId; label: string; defaultKeys: string[]; editable: boolean };

export const GUI_KEYBINDING_DEFINITIONS: GuiKeybindingDefinition[] = [
  { id: "app.commandMenu.open", label: "打开命令栏", defaultKeys: ["Ctrl/Cmd+K"], editable: true },
  { id: "app.settings.open", label: "打开设置", defaultKeys: ["Ctrl/Cmd+,"], editable: true },
  { id: "composer.submit", label: "发送/执行", defaultKeys: ["Enter"], editable: false },
  { id: "composer.newLine", label: "换行", defaultKeys: ["Shift+Enter"], editable: false },
  { id: "composer.followUp", label: "Follow up", defaultKeys: ["Alt+Enter"], editable: false },
  { id: "composer.dequeue", label: "取回排队消息", defaultKeys: ["Alt+↑"], editable: false },
];

export function normalizeGuiKeybindings(value: unknown): GuiKeybindingMap {
  if (!value || typeof value !== "object" || Array.isArray(value)) return {};
  const raw = value as Record<string, unknown>;
  const normalized: GuiKeybindingMap = {};
  for (const definition of GUI_KEYBINDING_DEFINITIONS) {
    const keys = raw[definition.id];
    if (!Array.isArray(keys)) continue;
    const combos = keys
      .filter((item): item is string => typeof item === "string")
      .map((item) => normalizeKeyCombo(item))
      .filter((item): item is string => Boolean(item));
    if (combos.length > 0) normalized[definition.id] = [...new Set(combos)];
  }
  return normalized;
}

export function effectiveGuiKeybindings(overrides: GuiKeybindingMap | undefined): Record<GuiKeybindingActionId, string[]> {
  return Object.fromEntries(GUI_KEYBINDING_DEFINITIONS.map((definition) => [definition.id, overrides?.[definition.id]?.length ? overrides[definition.id] : definition.defaultKeys])) as Record<GuiKeybindingActionId, string[]>;
}

export function eventMatchesKeyCombos(event: Pick<KeyboardEvent, "key" | "ctrlKey" | "metaKey" | "altKey" | "shiftKey">, combos: string[] | undefined): boolean {
  return Boolean(combos?.some((combo) => eventMatchesKeyCombo(event, combo)));
}

export function eventMatchesKeyCombo(event: Pick<KeyboardEvent, "key" | "ctrlKey" | "metaKey" | "altKey" | "shiftKey">, combo: string): boolean {
  const parsed = parseKeyCombo(combo);
  if (!parsed) return false;
  if (parsed.ctrlOrMeta !== (event.ctrlKey || event.metaKey)) return false;
  if (parsed.alt !== event.altKey) return false;
  if (parsed.shift !== event.shiftKey) return false;
  return normalizedEventKey(event.key) === parsed.key;
}

export function normalizeKeyCombo(value: string): string | undefined {
  const parsed = parseKeyCombo(value);
  if (!parsed) return undefined;
  return [...(parsed.ctrlOrMeta ? ["Ctrl/Cmd"] : []), ...(parsed.alt ? ["Alt"] : []), ...(parsed.shift ? ["Shift"] : []), displayKey(parsed.key)].join("+");
}

function parseKeyCombo(value: string): { ctrlOrMeta: boolean; alt: boolean; shift: boolean; key: string } | undefined {
  const parts = value.split("+").map((part) => part.trim()).filter(Boolean);
  if (parts.length === 0) return undefined;
  let ctrlOrMeta = false;
  let alt = false;
  let shift = false;
  let key: string | undefined;
  for (const part of parts) {
    const lower = part.toLowerCase();
    if (lower === "ctrl" || lower === "cmd" || lower === "meta" || lower === "ctrl/cmd") ctrlOrMeta = true;
    else if (lower === "alt" || lower === "option") alt = true;
    else if (lower === "shift") shift = true;
    else key = normalizedEventKey(part);
  }
  return key ? { ctrlOrMeta, alt, shift, key } : undefined;
}

function normalizedEventKey(key: string): string {
  if (key === "↑") return "arrowup";
  if (key === "↓") return "arrowdown";
  if (key === "←") return "arrowleft";
  if (key === "→") return "arrowright";
  return key.toLowerCase() === " " ? "space" : key.toLowerCase();
}

function displayKey(key: string): string {
  if (key === "arrowup") return "↑";
  if (key === "arrowdown") return "↓";
  if (key === "arrowleft") return "←";
  if (key === "arrowright") return "→";
  if (key === "enter") return "Enter";
  return key.length === 1 ? key.toUpperCase() : key;
}
