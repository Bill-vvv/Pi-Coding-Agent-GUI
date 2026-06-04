import assert from "node:assert/strict";
import test from "node:test";
import type { ExtensionUiRequest } from "@pi-gui/shared";
import { applyExtensionUiChromeRequest, extensionUiChromeRequestFromPayload } from "../src/domain/extensionUiChrome";

test("extension UI status requests are stored per runtime and cleared by undefined text", () => {
  const setStatus: ExtensionUiRequest = {
    type: "extension_ui_request",
    id: "status-1",
    method: "setStatus",
    statusKey: "trellis-goal",
    statusText: "goal: ship GUI",
  };
  const withStatus = applyExtensionUiChromeRequest({}, "runtime-1", setStatus);
  assert.equal(withStatus["runtime-1"]?.statuses["trellis-goal"], "goal: ship GUI");

  const otherRuntime = applyExtensionUiChromeRequest(withStatus, "runtime-2", { ...setStatus, id: "status-2", statusText: "goal: other" });
  assert.equal(otherRuntime["runtime-1"]?.statuses["trellis-goal"], "goal: ship GUI");
  assert.equal(otherRuntime["runtime-2"]?.statuses["trellis-goal"], "goal: other");

  const cleared = applyExtensionUiChromeRequest(otherRuntime, "runtime-1", {
    type: "extension_ui_request",
    id: "status-clear",
    method: "setStatus",
    statusKey: "trellis-goal",
  });
  assert.equal(cleared["runtime-1"], undefined);
  assert.equal(cleared["runtime-2"]?.statuses["trellis-goal"], "goal: other");
});

test("extension UI widget requests default above the editor and clear empty widgets", () => {
  const withWidget = applyExtensionUiChromeRequest({}, "runtime-1", {
    type: "extension_ui_request",
    id: "widget-1",
    method: "setWidget",
    widgetKey: "trellis-goal",
    widgetLines: ["🎯 Keep the goal visible", ""],
  });
  assert.deepEqual(withWidget["runtime-1"]?.widgets["trellis-goal"], {
    lines: ["🎯 Keep the goal visible"],
    placement: "aboveEditor",
  });

  const belowEditor = applyExtensionUiChromeRequest(withWidget, "runtime-1", {
    type: "extension_ui_request",
    id: "widget-2",
    method: "setWidget",
    widgetKey: "trellis-goal",
    widgetLines: ["done"],
    widgetPlacement: "belowEditor",
  });
  assert.equal(belowEditor["runtime-1"]?.widgets["trellis-goal"]?.placement, "belowEditor");

  const cleared = applyExtensionUiChromeRequest(belowEditor, "runtime-1", {
    type: "extension_ui_request",
    id: "widget-clear",
    method: "setWidget",
    widgetKey: "trellis-goal",
  });
  assert.equal(cleared["runtime-1"], undefined);
});

test("chrome requests can be reconstructed from replayed raw Pi payloads", () => {
  assert.deepEqual(
    extensionUiChromeRequestFromPayload({
      type: "extension_ui_request",
      id: "widget-1",
      method: "setWidget",
      widgetKey: "trellis-goal",
      widgetLines: ["🎯 replayed"],
      widgetPlacement: "belowEditor",
    }),
    {
      type: "extension_ui_request",
      id: "widget-1",
      method: "setWidget",
      widgetKey: "trellis-goal",
      widgetLines: ["🎯 replayed"],
      widgetPlacement: "belowEditor",
    },
  );
  assert.equal(extensionUiChromeRequestFromPayload({ type: "extension_ui_request", id: "bad", method: "setWidget", widgetKey: "x", widgetLines: [1] }), undefined);
});

test("non chrome extension UI requests do not change chrome state", () => {
  const current = applyExtensionUiChromeRequest({}, "runtime-1", {
    type: "extension_ui_request",
    id: "status-1",
    method: "setStatus",
    statusKey: "trellis-goal",
    statusText: "goal: existing",
  });

  const unchanged = applyExtensionUiChromeRequest(current, "runtime-1", {
    type: "extension_ui_request",
    id: "notice-1",
    method: "notify",
    message: "hello",
  });
  assert.equal(unchanged, current);
});
