type NotifyType = "info" | "warning" | "error";

type ReadyNotificationContext = {
  ui: {
    notify: (message: string, notifyType?: NotifyType) => void;
  };
};

type ReadyNotificationExtensionApi = {
  on: (event: "agent_end", handler: (event: unknown, context: ReadyNotificationContext) => unknown | Promise<unknown>) => void;
};

// GUI-managed temporary Pi-extension shim. It converts Pi's agent_end hook into
// the compatibility notify string consumed by the web ready-notification
// adapter. This is launch-scoped and non-mutating; do not move ready semantics
// into the GUI server while this remains a Pi extension bridge.
export default function readyNotificationExtension(pi: ReadyNotificationExtensionApi) {
  pi.on("agent_end", async (_event, ctx) => {
    ctx.ui.notify("Pi is ready for input", "info");
  });
}
