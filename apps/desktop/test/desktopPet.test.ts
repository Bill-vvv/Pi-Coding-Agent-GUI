import assert from "node:assert/strict";
import { mkdtempSync, mkdirSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import test from "node:test";
import { codexPetAnimationRow, compactDesktopPetText, normalizeCodexPetAnimation, normalizeDesktopPetDisplay } from "../src/services/desktopPet/desktopPetState.js";
import { readWebpDimensions, safeResolveBundleAsset, validateCodexPetManifest } from "../src/services/desktopPet/codexPetBundles.js";
import { normalizeDesktopPetPreferences, normalizeDesktopPetScale } from "../src/services/desktopPet/desktopPetPreferences.js";


test("desktop PET text compaction trims, collapses, and ellipsizes", () => {
  assert.equal(compactDesktopPetText("  Pi\n PET   running ", 80), "Pi PET running");
  assert.equal(compactDesktopPetText("abcdef", 4), "abc…");
});

test("desktop PET display normalization bounds unsafe payloads", () => {
  assert.equal(normalizeDesktopPetDisplay(undefined), undefined);
  const normalized = normalizeDesktopPetDisplay({
    mood: "tool",
    tone: "active",
    title: "  Tool running  ",
    detail: "x".repeat(300),
    badges: ["a", "b", "c", "d", 1],
    animation: "not-real",
  });
  assert.equal(normalized?.status, "running");
  assert.equal(normalized?.animation, "idle");
  assert.equal(normalized?.title, "Tool running");
  assert.equal(normalized?.badges.length, 3);
  assert.equal(normalized?.detail.length, 220);
});

test("CodexPet animation rows follow the 8x9 atlas contract", () => {
  assert.equal(codexPetAnimationRow("idle"), 0);
  assert.equal(codexPetAnimationRow("running-right"), 1);
  assert.equal(codexPetAnimationRow("running-left"), 2);
  assert.equal(codexPetAnimationRow("waving"), 3);
  assert.equal(codexPetAnimationRow("jumping"), 4);
  assert.equal(codexPetAnimationRow("failed"), 5);
  assert.equal(codexPetAnimationRow("waiting"), 6);
  assert.equal(codexPetAnimationRow("running"), 7);
  assert.equal(codexPetAnimationRow("review"), 8);
  assert.equal(normalizeCodexPetAnimation("bogus"), "idle");
});

test("CodexPet bundle validation keeps spritesheets inside bundle directory", () => {
  const root = mkdtempSync(join(tmpdir(), "pi-gui-pet-"));
  const bundleDir = join(root, "pet");
  mkdirSync(bundleDir);
  writeFileSync(join(bundleDir, "spritesheet.webp"), minimalVp8xWebp(768, 864));
  assert.equal(safeResolveBundleAsset(bundleDir, "../outside.webp"), undefined);
  const bundle = validateCodexPetManifest({ id: "demo", displayName: "Demo", spritesheetPath: "spritesheet.webp" }, bundleDir, "codex");
  assert.equal(bundle?.id, "demo");
  assert.equal(bundle?.displayName, "Demo");
  assert.equal(bundle?.source, "codex");
});

test("WebP dimension parser reads VP8X dimensions for atlas validation", () => {
  assert.deepEqual(readWebpDimensions(minimalVp8xWebp(768, 864)), { width: 768, height: 864 });
  assert.equal(validateCodexPetManifest({ id: "bad", displayName: "Bad", spritesheetPath: "missing.webp" }, mkdtempSync(join(tmpdir(), "pi-gui-pet-bad-")), "codex"), undefined);
});

test("desktop PET preferences normalize scale, pin, and position", () => {
  assert.equal(normalizeDesktopPetScale(3), 2);
  assert.equal(normalizeDesktopPetScale(0.2), 0.5);
  assert.deepEqual(normalizeDesktopPetPreferences({ scale: 1.234, pin: "free", position: { x: 1.2, y: 9.8 } }), {
    selectedPetId: undefined,
    scale: 1.23,
    pin: "free",
    position: { x: 1, y: 10 },
  });
});

function minimalVp8xWebp(width: number, height: number): Buffer {
  const buffer = Buffer.alloc(30);
  buffer.write("RIFF", 0, "ascii");
  buffer.writeUInt32LE(22, 4);
  buffer.write("WEBP", 8, "ascii");
  buffer.write("VP8X", 12, "ascii");
  buffer.writeUInt32LE(10, 16);
  buffer.writeUIntLE(width - 1, 24, 3);
  buffer.writeUIntLE(height - 1, 27, 3);
  return buffer;
}
