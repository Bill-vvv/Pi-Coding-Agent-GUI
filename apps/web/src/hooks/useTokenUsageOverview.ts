import { useEffect, useMemo, useState } from "react";
import type { TokenUsageOverview, TokenUsageRange } from "@pi-gui/shared";
import { apiUrlCandidates } from "../domain/apiUrl";
import { authHeaders } from "../domain/runtimeConfig";

export type UseTokenUsageOverviewResult = {
  usage?: TokenUsageOverview;
  loading: boolean;
  error?: string;
  refresh: () => void;
};

const TOKEN_USAGE_CACHE_TTL_MS = 60_000;
const tokenUsageCache = new Map<string, { usage: TokenUsageOverview; expiresAt: number }>();
const tokenUsageInFlight = new Map<string, Promise<TokenUsageOverview>>();

export function useTokenUsageOverview(range: TokenUsageRange, projectId?: string): UseTokenUsageOverviewResult {
  const cacheKey = tokenUsageCacheKey(range, projectId);
  const [usage, setUsage] = useState<TokenUsageOverview | undefined>(() => tokenUsageCache.get(cacheKey)?.usage);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | undefined>();
  const [refreshIndex, setRefreshIndex] = useState(0);

  const urls = useMemo(() => {
    const params = new URLSearchParams({ range });
    if (projectId) params.set("projectId", projectId);
    return apiUrlCandidates(`/api/usage/overview?${params.toString()}`);
  }, [range, projectId]);

  useEffect(() => {
    const cached = tokenUsageCache.get(cacheKey);
    if (cached) setUsage(cached.usage);
    if (cached && cached.expiresAt > Date.now() && refreshIndex === 0) return;

    const controller = new AbortController();
    setLoading(!cached);
    setError(undefined);
    const inFlight = tokenUsageInFlight.get(cacheKey) ?? fetchTokenUsageOverview(urls, controller.signal);
    tokenUsageInFlight.set(cacheKey, inFlight);
    void inFlight
      .then((usage) => {
        tokenUsageCache.set(cacheKey, { usage, expiresAt: Date.now() + TOKEN_USAGE_CACHE_TTL_MS });
        setUsage(usage);
      })
      .catch((caught: unknown) => {
        if (controller.signal.aborted) return;
        setError(caught instanceof Error ? caught.message : "读取用量失败");
      })
      .finally(() => {
        if (tokenUsageInFlight.get(cacheKey) === inFlight) tokenUsageInFlight.delete(cacheKey);
        if (!controller.signal.aborted) setLoading(false);
      });
    return () => controller.abort();
  }, [cacheKey, refreshIndex, urls]);

  return { usage, loading, error, refresh: () => setRefreshIndex((value) => value + 1) };
}

function tokenUsageCacheKey(range: TokenUsageRange, projectId: string | undefined): string {
  return `${range}\0${projectId ?? ""}`;
}

async function fetchTokenUsageOverview(urls: string[], signal: AbortSignal): Promise<TokenUsageOverview> {
  let lastError: unknown;
  for (const url of urls) {
    try {
      const response = await fetch(url, { signal, headers: authHeaders() });
      if (!response.ok) {
        lastError = new Error(await usageErrorMessage(response));
        continue;
      }
      const data = (await response.json()) as { usage?: TokenUsageOverview };
      if (!data.usage) throw new Error("用量响应为空");
      return data.usage;
    } catch (error) {
      if (signal.aborted) throw error;
      lastError = error;
    }
  }
  throw lastError instanceof Error ? lastError : new Error("读取用量失败");
}

async function usageErrorMessage(response: Response): Promise<string> {
  const body = await response.text().catch(() => "");
  if (!body.trim()) return `读取用量失败 (${response.status})`;
  try {
    const parsed = JSON.parse(body) as unknown;
    if (parsed && typeof parsed === "object" && "error" in parsed && typeof parsed.error === "string") return parsed.error;
  } catch {
    // Fall through to the compact text body.
  }
  return `读取用量失败 (${response.status})`;
}
