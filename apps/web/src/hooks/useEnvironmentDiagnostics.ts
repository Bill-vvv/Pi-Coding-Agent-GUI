import { useCallback, useEffect, useState } from "react";
import type { EnvironmentDiagnostics } from "@pi-gui/shared";
import { isRecord } from "@pi-gui/shared";
import { apiUrl } from "../domain/apiUrl";
import { authHeaders } from "../domain/runtimeConfig";

type EnvironmentDiagnosticsState = {
  diagnostics?: EnvironmentDiagnostics;
  loading: boolean;
  error?: string;
  refresh: () => Promise<void>;
};

const ENVIRONMENT_DIAGNOSTICS_CACHE_TTL_MS = 30_000;
let environmentDiagnosticsCache: { diagnostics: EnvironmentDiagnostics; expiresAt: number } | undefined;
let environmentDiagnosticsInFlight: Promise<EnvironmentDiagnostics> | undefined;

export function useEnvironmentDiagnostics(enabled: boolean): EnvironmentDiagnosticsState {
  const [diagnostics, setDiagnostics] = useState<EnvironmentDiagnostics | undefined>(() => {
    const cached = environmentDiagnosticsCache;
    return cached && cached.expiresAt > Date.now() ? cached.diagnostics : undefined;
  });
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | undefined>();

  const refresh = useCallback(async () => {
    if (!enabled) return;
    setLoading(true);
    setError(undefined);
    try {
      const diagnostics = await (environmentDiagnosticsInFlight ?? fetchEnvironmentDiagnostics());
      environmentDiagnosticsCache = { diagnostics, expiresAt: Date.now() + ENVIRONMENT_DIAGNOSTICS_CACHE_TTL_MS };
      setDiagnostics(diagnostics);
    } catch (error) {
      setError(error instanceof Error ? error.message : String(error));
    } finally {
      environmentDiagnosticsInFlight = undefined;
      setLoading(false);
    }
  }, [enabled]);

  useEffect(() => {
    if (!enabled || diagnostics || loading || error) return;
    void refresh();
  }, [diagnostics, enabled, error, loading, refresh]);

  return { diagnostics, loading, error, refresh };
}

async function fetchEnvironmentDiagnostics(): Promise<EnvironmentDiagnostics> {
  environmentDiagnosticsInFlight = fetch(apiUrl("/api/environment"), { headers: authHeaders() })
    .then(async (response) => {
      const data = (await response.json().catch(() => undefined)) as unknown;
      if (!response.ok) throw new Error(errorMessageFromResponse(data) ?? `环境诊断读取失败 (${response.status})`);
      if (!isRecord(data) || !isEnvironmentDiagnostics(data.environment)) throw new Error("环境诊断响应无效");
      return data.environment;
    })
    .finally(() => {
      environmentDiagnosticsInFlight = undefined;
    });
  return environmentDiagnosticsInFlight;
}

function isEnvironmentDiagnostics(value: unknown): value is EnvironmentDiagnostics {
  return Boolean(
    isRecord(value) &&
      typeof value.checkedAt === "number" &&
      typeof value.platform === "string" &&
      typeof value.arch === "string" &&
      typeof value.nodeVersion === "string" &&
      isRecord(value.wsl) &&
      typeof value.wsl.isWsl === "boolean" &&
      isRecord(value.pi) &&
      typeof value.pi.installed === "boolean",
  );
}

function errorMessageFromResponse(data: unknown): string | undefined {
  return isRecord(data) && typeof data.error === "string" ? data.error : undefined;
}
