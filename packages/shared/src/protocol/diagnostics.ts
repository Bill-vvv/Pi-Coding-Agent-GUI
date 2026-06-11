import type { ClientCommand } from "./commands.js";

// Diagnostics-adjacent protocol events describe command lifecycle outcomes.
// Developer-facing transport diagnostics are derived client-side from these
// events plus WebSocket close metadata; no credential values belong here.
export type CommandResultEvent = {
  type: "command.result";
  requestId?: string;
  command: ClientCommand["type"] | "unknown";
  success: boolean;
  error?: string;
  data?: unknown;
};
