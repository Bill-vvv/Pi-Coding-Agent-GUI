import type { Runtime } from "@pi-gui/shared";

export function firstVisibleRuntime(runtimes: Runtime[]): Runtime | undefined {
  const visible = runtimes.filter((runtime) => !runtime.archivedAt);
  return visible.find((runtime) => runtime.status === "running") ?? visible[0];
}
