import assert from "node:assert/strict";
import test from "node:test";
import type { ExtensionUiRequest, Project, Runtime, RuntimeConversationSummary } from "@pi-gui/shared";
import { requestBrowserNotificationPermission, showBrowserNotification } from "../src/domain/browserNotifications";
import { desktopNotificationPresentation, isPiReadyForInputNotification, PI_READY_FOR_INPUT_NOTIFICATION, shouldInterruptWithDesktopNotification } from "../src/domain/extensionNotifications";

const project: Project = {
  id: "project-1",
  name: "Demo",
  cwd: "/workspace/demo",
  lastOpenedAt: 1,
};

const runtime: Runtime = {
  id: "runtime-1234567890",
  projectId: project.id,
  cwd: project.cwd,
  status: "running",
};

const summary: RuntimeConversationSummary = {
  runtimeId: runtime.id,
  projectId: project.id,
  title: "Fix notifications",
  messageCount: 3,
};

const backgroundRuntime: Runtime = {
  id: "runtime-background",
  projectId: project.id,
  cwd: project.cwd,
  status: "running",
};

const otherProject: Project = {
  id: "project-2",
  name: "Other",
  cwd: "/workspace/other",
  lastOpenedAt: 2,
};

test("only Pi ready-for-input notify requests are treated as desktop completion notifications", () => {
  const genericNotice: Extract<ExtensionUiRequest, { method: "notify" }> = {
    type: "extension_ui_request",
    id: "notice-1",
    method: "notify",
    message: "Trellis project context is available.",
    notifyType: "info",
  };

  assert.equal(isPiReadyForInputNotification(genericNotice), false);
  assert.equal(
    desktopNotificationPresentation({
      runtimeId: runtime.id,
      projectId: project.id,
      request: genericNotice,
      projects: [project],
      runtimes: [runtime],
      conversationSummaries: { [runtime.id]: summary },
    }),
    undefined,
  );
});

test("desktop ready notification interrupts for hidden, unfocused, or background runtime targets", () => {
  const activeTarget = {
    activeProjectId: project.id,
    activeRuntimeId: runtime.id,
    targetProjectId: project.id,
    targetRuntimeId: runtime.id,
  };

  assert.equal(shouldInterruptWithDesktopNotification({ visibilityState: "visible", hidden: false, hasFocus: true, ...activeTarget }), false);
  assert.equal(shouldInterruptWithDesktopNotification({ visibilityState: "hidden", hidden: true, hasFocus: true, ...activeTarget }), true);
  assert.equal(shouldInterruptWithDesktopNotification({ visibilityState: "visible", hidden: false, hasFocus: false, ...activeTarget }), true);
  assert.equal(
    shouldInterruptWithDesktopNotification({
      visibilityState: "visible",
      hidden: false,
      hasFocus: true,
      activeProjectId: project.id,
      activeRuntimeId: runtime.id,
      targetProjectId: project.id,
      targetRuntimeId: backgroundRuntime.id,
    }),
    true,
  );
  assert.equal(
    shouldInterruptWithDesktopNotification({
      visibilityState: "visible",
      hidden: false,
      hasFocus: true,
      activeProjectId: project.id,
      activeRuntimeId: runtime.id,
      targetProjectId: otherProject.id,
      targetRuntimeId: "runtime-other",
    }),
    true,
  );
  assert.equal(
    shouldInterruptWithDesktopNotification({
      visibilityState: "visible",
      hidden: false,
      hasFocus: true,
      targetProjectId: project.id,
      targetRuntimeId: runtime.id,
    }),
    true,
  );
});

test("Pi ready-for-input notification uses non-misleading localized desktop copy and route target", () => {
  const readyNotice: Extract<ExtensionUiRequest, { method: "notify" }> = {
    type: "extension_ui_request",
    id: "notice-2",
    method: "notify",
    message: PI_READY_FOR_INPUT_NOTIFICATION,
    notifyType: "info",
  };

  const presentation = desktopNotificationPresentation({
    runtimeId: runtime.id,
    projectId: project.id,
    request: readyNotice,
    projects: [project],
    runtimes: [runtime],
    conversationSummaries: { [runtime.id]: summary },
  });

  assert.deepEqual(presentation, {
    title: "Pi 已可继续输入 · Demo",
    body: "Fix notifications\nPi 已可继续输入",
    tag: `pi-gui-ready-${runtime.id}`,
    target: { projectId: project.id, runtimeId: runtime.id },
  });
});

test("browser notification permission request falls back to the current permission when request throws", async () => {
  const originalWindow = globalThis.window;

  class MockNotification {
    static permission = "default" as NotificationPermission;
    static async requestPermission(): Promise<NotificationPermission> {
      throw new Error("permission prompt failed");
    }
  }

  Object.defineProperty(globalThis, "window", {
    configurable: true,
    value: {
      Notification: MockNotification,
    },
  });

  try {
    assert.equal(await requestBrowserNotificationPermission(), "default");
  } finally {
    Object.defineProperty(globalThis, "window", { configurable: true, value: originalWindow });
  }
});

test("browser desktop notification click focuses the GUI and invokes route callback", () => {
  const originalWindow = globalThis.window;
  let focused = false;
  let clicked = false;
  let closed = false;
  let createdNotification: { onclick?: () => void; close: () => void } | undefined;

  class MockNotification {
    static permission = "granted" as NotificationPermission;
    onclick?: () => void;

    constructor(public title: string, public options?: NotificationOptions) {
      createdNotification = this;
    }

    close() {
      closed = true;
    }
  }

  Object.defineProperty(globalThis, "window", {
    configurable: true,
    value: {
      Notification: MockNotification,
      focus: () => {
        focused = true;
      },
    },
  });

  try {
    assert.equal(showBrowserNotification("Pi 已可继续输入", { body: "Fix notifications", onClick: () => { clicked = true; } }), true);
    createdNotification?.onclick?.();
    assert.equal(focused, true);
    assert.equal(clicked, true);
    assert.equal(closed, true);
  } finally {
    Object.defineProperty(globalThis, "window", { configurable: true, value: originalWindow });
  }
});
