import { useMemo } from "react";

export function useDebugRoutes(): { debugRoute: boolean; showThinkingPreview: boolean } {
  return useMemo(() => {
    const params = new URLSearchParams(window.location.search);
    return {
      debugRoute: window.location.pathname === "/debug/models" || params.has("modelDebug"),
      showThinkingPreview: params.has("thinkingPreview"),
    };
  }, []);
}
