import { existsSync } from "node:fs";

const DEFAULT_WINDOWS_POWERSHELL_PATHS = [
  "/mnt/c/Windows/System32/WindowsPowerShell/v1.0/powershell.exe",
  "/mnt/c/Windows/SysWOW64/WindowsPowerShell/v1.0/powershell.exe",
];

export function resolveWindowsPowerShellExecutable(env: NodeJS.ProcessEnv = process.env, pathExists: (path: string) => boolean = existsSync): string {
  const configured = env.PI_GUI_WINDOWS_POWERSHELL_PATH?.trim();
  if (configured) return configured;
  return DEFAULT_WINDOWS_POWERSHELL_PATHS.find((candidate) => pathExists(candidate)) ?? "powershell.exe";
}

export function windowsPowerShellUnavailableError(error: unknown): Error | undefined {
  if (!isMissingExecutableError(error)) return undefined;
  return new Error(
    "无法启动 Windows PowerShell。请确认 WSL interop 已启用，或设置 "
      + "PI_GUI_WINDOWS_POWERSHELL_PATH=/mnt/c/Windows/System32/WindowsPowerShell/v1.0/powershell.exe 后重启 Pi GUI。",
  );
}

function isMissingExecutableError(error: unknown): boolean {
  if (!error || typeof error !== "object") return false;
  const code = (error as { code?: unknown }).code;
  return code === "ENOENT";
}
