import { useCallback, useState } from "react";

type SurfaceCleanup = {
  collapseSidebar?: boolean;
  closeUsageOverview?: boolean;
  closeSettings?: () => void;
  closeSessionHistory?: () => void;
  closeRuntimeLogs?: () => void;
  closeSubagentDrawer?: () => void;
};

export function useMainSurfaceMode() {
  const [usageOverviewOpen, setUsageOverviewOpen] = useState(false);
  const [compactSidebarExpanded, setCompactSidebarExpanded] = useState(false);

  const collapseCompactSidebar = useCallback(() => {
    setCompactSidebarExpanded(false);
  }, []);

  const toggleCompactSidebar = useCallback(() => {
    setCompactSidebarExpanded((expanded) => !expanded);
  }, []);

  const closeUsageOverview = useCallback(() => {
    setUsageOverviewOpen(false);
  }, []);

  const closeSurfaces = useCallback((cleanup: SurfaceCleanup = {}) => {
    if (cleanup.collapseSidebar !== false) setCompactSidebarExpanded(false);
    cleanup.closeSettings?.();
    cleanup.closeSessionHistory?.();
    cleanup.closeRuntimeLogs?.();
    cleanup.closeSubagentDrawer?.();
    if (cleanup.closeUsageOverview !== false) setUsageOverviewOpen(false);
  }, []);

  const openUsageOverview = useCallback((cleanup: Pick<SurfaceCleanup, "closeSettings" | "closeSessionHistory"> = {}) => {
    cleanup.closeSettings?.();
    cleanup.closeSessionHistory?.();
    setUsageOverviewOpen(true);
  }, []);

  return {
    compactSidebarExpanded,
    usageOverviewOpen,
    toggleCompactSidebar,
    collapseCompactSidebar,
    closeUsageOverview,
    closeSurfaces,
    openUsageOverview,
  };
}
