import type { Runtime } from "@pi-gui/shared";

export type RuntimeHasConversationActivity = (runtimeId: string) => boolean;

export function isUnhandledNewRuntime(runtime: Runtime, hasConversationActivity: RuntimeHasConversationActivity): boolean {
  return !runtime.archivedAt && !hasConversationActivity(runtime.id);
}

export function reusableNewRuntimeForProject(runtimes: Runtime[], projectId: string, hasConversationActivity: RuntimeHasConversationActivity): Runtime | undefined {
  return runtimes
    .filter((runtime) => runtime.projectId === projectId && runtimeIsReusable(runtime) && isUnhandledNewRuntime(runtime, hasConversationActivity))
    .sort(compareNewestRuntime)[0];
}

export function unhandledNewRuntimeIdsToArchive(runtimes: Runtime[], keepRuntimeId: string | undefined, hasConversationActivity: RuntimeHasConversationActivity): string[] {
  return runtimes
    .filter((runtime) => runtime.id !== keepRuntimeId && runtimeIsReusable(runtime) && isUnhandledNewRuntime(runtime, hasConversationActivity))
    .map((runtime) => runtime.id);
}

function runtimeIsReusable(runtime: Runtime): boolean {
  return runtime.status === "running" || runtime.status === "starting";
}

function compareNewestRuntime(left: Runtime, right: Runtime): number {
  return (right.startedAt ?? 0) - (left.startedAt ?? 0);
}
