export function stripModelDebugStderrLines(chunk: string): string {
  return chunk
    .split(/\r?\n/)
    .filter((line) => !line.includes("PI_GUI_MODEL_REQUEST "))
    .join("\n");
}
