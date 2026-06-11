import type { ExecutionHostKind, ExecutionHostRef } from "@pi-gui/shared";

export function readExecutionHost(env: NodeJS.ProcessEnv = process.env): ExecutionHostRef | undefined {
  const kind = parseExecutionHostKind(env.PI_GUI_EXECUTION_HOST_KIND ?? env.PI_GUI_DESKTOP_HOST ?? env.PI_GUI_DESKTOP_BACKEND_HOST);
  if (!kind) return undefined;

  const id = trimmed(env.PI_GUI_EXECUTION_HOST_ID) ?? defaultExecutionHostId(kind, env);
  return {
    kind,
    id,
    label: trimmed(env.PI_GUI_EXECUTION_HOST_LABEL) ?? defaultExecutionHostLabel(kind, env),
  };
}

function parseExecutionHostKind(value: string | undefined): ExecutionHostKind | undefined {
  const normalized = trimmed(value)?.toLowerCase();
  if (!normalized || normalized === "auto" || normalized === "choose") return undefined;
  if (normalized === "wsl") return "wsl";
  if (normalized === "windows" || normalized === "win32" || normalized === "native") return "windows";
  return "unknown";
}

function defaultExecutionHostId(kind: ExecutionHostKind, env: NodeJS.ProcessEnv): string {
  if (kind === "wsl") return `wsl:${trimmed(env.PI_GUI_DESKTOP_WSL_DISTRO) ?? "default"}`;
  if (kind === "windows") return "windows:local";
  return "unknown:local";
}

function defaultExecutionHostLabel(kind: ExecutionHostKind, env: NodeJS.ProcessEnv): string | undefined {
  if (kind === "wsl") return `WSL${trimmed(env.PI_GUI_DESKTOP_WSL_DISTRO) ? ` (${trimmed(env.PI_GUI_DESKTOP_WSL_DISTRO)})` : ""}`;
  if (kind === "windows") return "Windows native";
  return undefined;
}

function trimmed(value: string | undefined): string | undefined {
  return value?.trim() || undefined;
}
