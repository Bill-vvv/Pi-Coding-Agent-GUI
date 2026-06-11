import assert from "node:assert/strict";
import test from "node:test";
import { capabilitiesForRuntimeProfile, capabilityCounts, DEFAULT_RUNTIME_PROFILE_ID, PI_GUI_CAPABILITIES, RUNTIME_PROFILES } from "@pi-gui/shared";

test("runtime profiles default to user extensions while preserving isolated Safe Mode", () => {
  const vanilla = RUNTIME_PROFILES.find((profile) => profile.id === "vanilla-pi");
  const userExtensions = RUNTIME_PROFILES.find((profile) => profile.id === "pi-user-extensions");

  assert.equal(DEFAULT_RUNTIME_PROFILE_ID, "pi-user-extensions");
  assert.equal(RUNTIME_PROFILES[0]?.id, "pi-user-extensions");

  assert.ok(vanilla);
  assert.deepEqual(vanilla.defaultCapabilityIds, []);
  assert.equal(vanilla.inheritsUserExtensions, false);
  assert.deepEqual(capabilitiesForRuntimeProfile("vanilla-pi"), []);

  assert.ok(userExtensions);
  assert.equal(userExtensions.inheritsUserExtensions, true);
  assert.deepEqual(userExtensions.defaultCapabilityIds, []);
});

test("enhanced and Trellis profiles opt into GUI capabilities explicitly", () => {
  const enhanced = capabilitiesForRuntimeProfile("pi-gui-enhanced").map((capability) => capability.id);
  const trellis = capabilitiesForRuntimeProfile("trellis-workflow").map((capability) => capability.id);

  assert.ok(!enhanced.includes("pi-pet-companion"));
  assert.ok(!enhanced.includes("trellis-subagent"));
  assert.ok(!enhanced.includes("codex-transport-monitor"));
  assert.ok(!trellis.includes("pi-pet-companion"));
  assert.ok(trellis.includes("trellis-subagent"));
  assert.ok(!trellis.includes("codex-transport-monitor"));
});

test("capability registry classifies behavior-changing and mutating capabilities", () => {
  const counts = capabilityCounts();
  const piPet = PI_GUI_CAPABILITIES.find((capability) => capability.id === "pi-pet-companion");
  const trellisSubagent = PI_GUI_CAPABILITIES.find((capability) => capability.id === "trellis-subagent");

  assert.equal(counts.total, PI_GUI_CAPABILITIES.length);
  assert.ok(counts.total >= 10);
  assert.ok(counts.changesAgentBehavior >= 2);
  assert.ok(counts.mutating >= 2);

  assert.deepEqual(piPet?.risks, ["ui-only"]);
  assert.equal(piPet?.changesAgentBehavior, false);
  assert.equal(piPet?.supportsRemoteRuntime, true);
  assert.equal(piPet?.docsUrl, "docs/pi-pet-companion.md");
  assert.deepEqual(trellisSubagent?.providedTools, ["trellis_subagent"]);
  assert.equal(trellisSubagent?.startsProcesses, true);
});
