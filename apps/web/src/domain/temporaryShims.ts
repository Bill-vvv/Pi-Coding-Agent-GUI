import type { TemporaryShimImplementationHost, TemporaryShimReleaseStance } from "@pi-gui/shared";
export { TEMPORARY_SHIMS, temporaryShimCounts } from "@pi-gui/shared";
export type { TemporaryShimDescriptor, TemporaryShimImplementationHost, TemporaryShimReleaseStance, TemporaryShimRisk } from "@pi-gui/shared";

export function releaseStanceLabel(stance: TemporaryShimReleaseStance): string {
  switch (stance) {
    case "default-on": return "默认可见";
    case "default-off": return "默认关闭";
    case "explicit-setup": return "显式设置";
    case "private-or-deferred": return "暂缓公开";
  }
}

export function implementationHostLabel(host: TemporaryShimImplementationHost): string {
  switch (host) {
    case "pi-gui": return "GUI";
    case "pi-extension": return "Pi extension";
    case "external-wrapper": return "外部 wrapper";
    case "user-local-pi-wrapper": return "本地 Pi shim";
  }
}
