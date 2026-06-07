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

export function useEnvironmentDiagnostics(enabled: boolean): EnvironmentDiagnosticsState {
  const [diagnostics, setDiagnostics] = useState<EnvironmentDiagnostics | undefined>();
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | undefined>();

  const refresh = useCallback(async () => {
    if (!enabled) return;
    setLoading(true);
    setError(undefined);
    try {
      const response = await fetch(apiUrl("/api/environment"), { headers: authHeaders() });
      const data = (await response.json().catch(() => undefined)) as unknown;
      if (!response.ok) throw new Error(errorMessageFromResponse(data) ?? `环境诊断读取失败 (${response.status})`);
      if (!isRecord(data) || !isEnvironmentDiagnostics(data.environment)) throw new Error("环境诊断响应无效");
      setDiagnostics(data.environment);
    } catch (error) {
      setError(error instanceof Error ? error.message : String(error));
    } finally {
      setLoading(false);
    }
  }, [enabled]);

  useEffect(() => {
    if (!enabled || diagnostics || loading || error) return;
    void refresh();
  }, [diagnostics, enabled, error, loading, refresh]);

  return { diagnostics, loading, error, refresh };
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
