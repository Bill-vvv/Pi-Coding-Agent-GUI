import assert from "node:assert/strict";
import test from "node:test";
import { capabilityDisplayModel, confirmProjectExtension, projectExtensionDisplayModels, requiresUnknownExtensionConfirmation, userExtensionPlaceholderModel } from "../src/domain/capabilities";

test("capability display model exposes risks, surfaces, profiles, and compatibility", () => {
  const model = capabilityDisplayModel({
    id: "interactive-prompts",
    label: "Interactive Prompts",
    summary: "Clarification forms",
    origin: "builtin",
    integrationLevel: 3,
    implementationHost: "pi-extension",
    risks: ["ui-only"],
    releaseStance: "default-off",
    mutatesPiEnvironment: false,
    changesAgentBehavior: true,
    startsProcesses: false,
    extensionUiMethods: ["askBatch"],
    supportsLocalRuntime: true,
    supportsRemoteRuntime: false,
  });

  assert.equal(model.originLabel, "Built-in");
  assert.equal(model.integrationLevelLabel, "L3");
  assert.equal(model.implementationHostLabel, "Pi extension");
  assert.equal(model.releaseStanceLabel, "默认关闭");
  assert.deepEqual(model.riskLabels, ["UI-only"]);
  assert.equal(model.compatibilityLabel, "Local only");
  assert.deepEqual(model.surfaceLabels, ["UI: askBatch"]);
  assert.deepEqual(model.behaviorLabels, ["改 Agent 行为"]);
  assert.ok(model.profileLabels.includes("Pi GUI Enhanced"));
  assert.ok(model.profileLabels.includes("Trellis Workflow"));
});

test("runtime profile selection confirms first enable of inherited user extensions", () => {
  assert.equal(requiresUnknownExtensionConfirmation("pi-user-extensions", "vanilla-pi"), true);
  assert.equal(requiresUnknownExtensionConfirmation("pi-user-extensions", "pi-user-extensions"), false);
  assert.equal(requiresUnknownExtensionConfirmation("vanilla-pi", "pi-user-extensions"), false);
});

test("unknown user extension placeholder labels low-trust first-enable behavior", () => {
  const model = userExtensionPlaceholderModel();

  assert.equal(model.integrationLevelLabel, "L0");
  assert.equal(model.originLabel, "User");
  assert.ok(model.profileLabels.includes("Pi + User Extensions"));
  assert.ok(model.behaviorLabels.includes("Not inherited by Vanilla Pi"));
  assert.ok(model.behaviorLabels.includes("First enable requires confirmation"));
});

test("project extension display models track confirmation and matching capabilities", () => {
  const extension = {
    id: "project:/repo/.pi/extensions/trellis/index.ts",
    scope: "project" as const,
    source: "project-settings" as const,
    path: "/repo/.pi/extensions/trellis/index.ts",
    relativePath: "./.pi/extensions/trellis/index.ts",
    integrationLevel: 0 as const,
    capabilityIds: ["trellis-subagent"],
    warnings: ["No manifest"],
  };

  const [model] = projectExtensionDisplayModels([extension], { confirmedProjectExtensionIds: [extension.id] });

  assert.equal(model?.label, "Trellis project extension");
  assert.equal(model?.confirmed, true);
  assert.equal(model?.injectable, true);
  assert.deepEqual(model?.capabilityLabels, ["Trellis Sub-agent Workflow"]);
  assert.deepEqual(confirmProjectExtension({ confirmedProjectExtensionIds: [] }, extension.id).confirmedProjectExtensionIds, [extension.id]);
});
