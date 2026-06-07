import assert from "node:assert/strict";
import test from "node:test";
import { effectiveGuiKeybindings, eventMatchesKeyCombos, normalizeGuiKeybindings, normalizeKeyCombo } from "../src/domain/keybindings";

test("normalizeKeyCombo accepts browser-style GUI combos", () => {
  assert.equal(normalizeKeyCombo("ctrl+shift+m"), "Ctrl/Cmd+Shift+M");
  assert.equal(normalizeKeyCombo("Cmd+,"), "Ctrl/Cmd+,");
  assert.equal(normalizeKeyCombo("bad+"), "bad");
});

test("normalizeGuiKeybindings keeps known action bindings", () => {
  assert.deepEqual(normalizeGuiKeybindings({ "app.commandMenu.open": ["ctrl+j"], unknown: ["ctrl+x"] }), { "app.commandMenu.open": ["Ctrl/Cmd+J"] });
});

test("effectiveGuiKeybindings overlays defaults", () => {
  const effective = effectiveGuiKeybindings({ "app.settings.open": ["Ctrl/Cmd+S"] });
  assert.deepEqual(effective["app.settings.open"], ["Ctrl/Cmd+S"]);
  assert.deepEqual(effective["composer.submit"], ["Enter"]);
});

test("eventMatchesKeyCombos matches ctrl or cmd aliases", () => {
  assert.equal(eventMatchesKeyCombos({ key: "k", ctrlKey: true, metaKey: false, altKey: false, shiftKey: false }, ["Ctrl/Cmd+K"]), true);
  assert.equal(eventMatchesKeyCombos({ key: "m", ctrlKey: false, metaKey: true, altKey: false, shiftKey: true }, ["Ctrl/Cmd+Shift+M"]), true);
  assert.equal(eventMatchesKeyCombos({ key: "m", ctrlKey: false, metaKey: true, altKey: true, shiftKey: true }, ["Ctrl/Cmd+Shift+M"]), false);
});
