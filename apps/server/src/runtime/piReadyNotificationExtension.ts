type NotifyType = "info" | "warning" | "error";

type ReadyNotificationContext = {
  ui: {
    notify: (message: string, notifyType?: NotifyType) => void;
  };
};

type ReadyNotificationExtensionApi = {
  on: (event: "agent_end", handler: (event: unknown, context: ReadyNotificationContext) => unknown | Promise<unknown>) => void;
};

export default function readyNotificationExtension(pi: ReadyNotificationExtensionApi) {
  pi.on("agent_end", async (_event, ctx) => {
    ctx.ui.notify("Pi is ready for input", "info");
  });
}
