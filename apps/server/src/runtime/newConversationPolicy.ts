import type { Runtime } from "@pi-gui/shared";

export type RuntimeHasMessages = (runtimeId: string) => boolean;

export function isUnhandledNewRuntime(runtime: Runtime, hasMessages: RuntimeHasMessages): boolean {
  return !runtime.archivedAt && !runtime.sessionId && !hasMessages(runtime.id);
}

export function reusableNewRuntimeForProject(runtimes: Runtime[], projectId: string, hasMessages: RuntimeHasMessages): Runtime | undefined {
  return runtimes
    .filter((runtime) => runtime.projectId === projectId && runtimeIsReusable(runtime) && isUnhandledNewRuntime(runtime, hasMessages))
    .sort(compareNewestRuntime)[0];
}

export function unhandledNewRuntimeIdsToArchive(runtimes: Runtime[], keepRuntimeId: string | undefined, hasMessages: RuntimeHasMessages): string[] {
  return runtimes.filter((runtime) => runtime.id !== keepRuntimeId && isUnhandledNewRuntime(runtime, hasMessages)).map((runtime) => runtime.id);
}

function runtimeIsReusable(runtime: Runtime): boolean {
  return runtime.status === "running" || runtime.status === "starting";
}

function compareNewestRuntime(left: Runtime, right: Runtime): number {
  return (right.startedAt ?? 0) - (left.startedAt ?? 0);
}
