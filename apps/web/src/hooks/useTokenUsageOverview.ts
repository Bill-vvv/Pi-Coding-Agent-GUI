import { useEffect, useMemo, useState } from "react";
import type { TokenUsageOverview, TokenUsageRange } from "@pi-gui/shared";

export type UseTokenUsageOverviewResult = {
  usage?: TokenUsageOverview;
  loading: boolean;
  error?: string;
  refresh: () => void;
};

export function useTokenUsageOverview(range: TokenUsageRange, projectId?: string): UseTokenUsageOverviewResult {
  const [usage, setUsage] = useState<TokenUsageOverview | undefined>();
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | undefined>();
  const [refreshIndex, setRefreshIndex] = useState(0);

  const url = useMemo(() => {
    const params = new URLSearchParams({ range });
    if (projectId) params.set("projectId", projectId);
    return `/api/usage/overview?${params.toString()}`;
  }, [range, projectId]);

  useEffect(() => {
    const controller = new AbortController();
    setLoading(true);
    setError(undefined);
    void fetch(url, { signal: controller.signal })
      .then((response) => (response.ok ? response.json() : Promise.reject(new Error("读取用量失败"))))
      .then((data: { usage?: TokenUsageOverview }) => {
        if (!data.usage) throw new Error("用量响应为空");
        setUsage(data.usage);
      })
      .catch((caught: unknown) => {
        if (controller.signal.aborted) return;
        setError(caught instanceof Error ? caught.message : "读取用量失败");
      })
      .finally(() => {
        if (!controller.signal.aborted) setLoading(false);
      });
    return () => controller.abort();
  }, [url, refreshIndex]);

  return { usage, loading, error, refresh: () => setRefreshIndex((value) => value + 1) };
}
