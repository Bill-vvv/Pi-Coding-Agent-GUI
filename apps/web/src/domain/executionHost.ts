import type { ExecutionHostRef } from "@pi-gui/shared";

export function executionHostLabel(host: ExecutionHostRef | undefined): string | undefined {
  if (!host) return undefined;
  if (host.label) return host.label;
  if (host.kind === "wsl") return host.id.startsWith("wsl:") ? `WSL (${host.id.slice(4) || "default"})` : "WSL";
  if (host.kind === "windows") return "Windows native";
  return host.id || "Unknown host";
}
