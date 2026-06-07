import { useCallback, useEffect, useState } from "react";
import type { RemoteAccessPairingInfo, RemoteAccessRestartResponse, RemoteAccessStatus, RemoteAccessUpdateRequest, RemoteAccessUpdateResponse, RemoteAccessWindowsPortProxyResponse } from "@pi-gui/shared";
import { isRecord } from "@pi-gui/shared";
import { apiUrl } from "../domain/apiUrl";
import { authHeaders } from "../domain/runtimeConfig";
import { forgetRemoteAccessToken, saveRemoteAccessToken } from "../domain/remoteAuth";

export type RemoteAccessState = {
  status?: RemoteAccessStatus;
  pairing?: RemoteAccessPairingInfo;
  loading: boolean;
  updating: boolean;
  restarting: boolean;
  setupRunning: boolean;
  error?: string;
  refresh: () => Promise<void>;
  loadPairing: () => Promise<void>;
  update: (request: RemoteAccessUpdateRequest) => Promise<void>;
  restartServer: () => Promise<RemoteAccessRestartResponse | undefined>;
  configureWindowsPortProxy: () => Promise<string | undefined>;
  forgetSavedToken: () => void;
};

export function useRemoteAccess(enabled: boolean): RemoteAccessState {
  const [status, setStatus] = useState<RemoteAccessStatus | undefined>();
  const [pairing, setPairing] = useState<RemoteAccessPairingInfo | undefined>();
  const [loading, setLoading] = useState(false);
  const [updating, setUpdating] = useState(false);
  const [restarting, setRestarting] = useState(false);
  const [setupRunning, setSetupRunning] = useState(false);
  const [error, setError] = useState<string | undefined>();

  const refresh = useCallback(async () => {
    if (!enabled) return;
    setLoading(true);
    setError(undefined);
    try {
      const nextStatus = await fetchJson<RemoteAccessStatus>("/api/remote-access/status", isRemoteAccessStatus);
      setStatus(nextStatus);
    } catch (requestError) {
      setError(errorMessage(requestError));
    } finally {
      setLoading(false);
    }
  }, [enabled]);

  const loadPairing = useCallback(async () => {
    if (!enabled) return;
    setLoading(true);
    setError(undefined);
    try {
      const nextPairing = await fetchJson<RemoteAccessPairingInfo>("/api/remote-access/pairing", isRemoteAccessPairingInfo);
      saveRemoteAccessToken(nextPairing.token);
      setPairing(nextPairing);
      setStatus(nextPairing.status);
    } catch (requestError) {
      setError(errorMessage(requestError));
    } finally {
      setLoading(false);
    }
  }, [enabled]);

  const update = useCallback(async (request: RemoteAccessUpdateRequest) => {
    if (!enabled) return;
    setUpdating(true);
    setError(undefined);
    try {
      const response = await postJson<RemoteAccessUpdateResponse>("/api/remote-access", request, isRemoteAccessUpdateResponse);
      setStatus(response.status);
      if (response.pairing) {
        saveRemoteAccessToken(response.pairing.token);
        setPairing(response.pairing);
      } else if (request.clearToken) setPairing(undefined);
      if (request.clearToken) forgetRemoteAccessToken();
    } catch (requestError) {
      setError(errorMessage(requestError));
    } finally {
      setUpdating(false);
    }
  }, [enabled]);

  const restartServer = useCallback(async () => {
    if (!enabled) return undefined;
    setRestarting(true);
    setError(undefined);
    try {
      const response = await postJson<RemoteAccessRestartResponse>("/api/remote-access/restart", {}, isRemoteAccessRestartResponse);
      setStatus(response.status);
      window.setTimeout(() => {
        setRestarting(false);
        void refresh();
      }, Math.max(response.reconnectDelayMs, 1200));
      return response;
    } catch (requestError) {
      setError(errorMessage(requestError));
      setRestarting(false);
      return undefined;
    }
  }, [enabled, refresh]);

  const configureWindowsPortProxy = useCallback(async () => {
    if (!enabled) return undefined;
    setSetupRunning(true);
    setError(undefined);
    try {
      const response = await postJson<RemoteAccessWindowsPortProxyResponse>("/api/remote-access/windows-portproxy", undefined, isRemoteAccessWindowsPortProxyResponse);
      setStatus(response.status);
      return response.message;
    } catch (requestError) {
      setError(errorMessage(requestError));
      return undefined;
    } finally {
      setSetupRunning(false);
    }
  }, [enabled]);

  const forgetSavedToken = useCallback(() => {
    forgetRemoteAccessToken();
  }, []);

  useEffect(() => {
    if (!enabled) return;
    void refresh();
  }, [enabled, refresh]);

  return { status, pairing, loading, updating, restarting, setupRunning, error, refresh, loadPairing, update, restartServer, configureWindowsPortProxy, forgetSavedToken };
}

async function fetchJson<T>(path: string, guard: (value: unknown) => value is T): Promise<T> {
  const response = await fetch(apiUrl(path), { headers: authHeaders() });
  return parseJsonResponse(response, guard);
}

async function postJson<T>(path: string, body: unknown, guard: (value: unknown) => value is T): Promise<T> {
  const init: RequestInit = {
    method: "POST",
    headers: body === undefined ? authHeaders() : authHeaders({ "Content-Type": "application/json" }),
  };
  if (body !== undefined) init.body = JSON.stringify(body);
  const response = await fetch(apiUrl(path), init);
  return parseJsonResponse(response, guard);
}

async function parseJsonResponse<T>(response: Response, guard: (value: unknown) => value is T): Promise<T> {
  const value = await response.json().catch(() => undefined);
  if (!response.ok) throw new Error(response.status === 401 ? "Remote Access token 无效或已过期，请重新配对。" : responseError(value) ?? `Remote Access 请求失败（${response.status}）`);
  if (!guard(value)) throw new Error("Remote Access 返回格式无效");
  return value;
}

function responseError(value: unknown): string | undefined {
  if (!isRecord(value)) return undefined;
  return typeof value.message === "string" ? value.message : typeof value.error === "string" ? value.error : undefined;
}

function errorMessage(error: unknown): string {
  return error instanceof Error ? error.message : String(error);
}

function isRemoteAccessStatus(value: unknown): value is RemoteAccessStatus {
  return isRecord(value)
    && typeof value.enabled === "boolean"
    && typeof value.active === "boolean"
    && typeof value.restartRequired === "boolean"
    && (value.mode === "local" || value.mode === "remote-lan")
    && typeof value.bindHost === "string"
    && typeof value.port === "number"
    && Array.isArray(value.candidateUrls)
    && typeof value.tokenConfigured === "boolean"
    && (value.setupHints === undefined || (Array.isArray(value.setupHints) && value.setupHints.every(isRemoteAccessSetupHint)));
}

function isRemoteAccessSetupHint(value: unknown): boolean {
  return isRecord(value)
    && typeof value.code === "string"
    && (value.severity === "info" || value.severity === "warning" || value.severity === "error")
    && typeof value.message === "string"
    && (value.commands === undefined || (Array.isArray(value.commands) && value.commands.every(isRemoteAccessSetupCommand)));
}

function isRemoteAccessSetupCommand(value: unknown): boolean {
  return isRecord(value)
    && typeof value.label === "string"
    && typeof value.command === "string"
    && (value.platform === "shell" || value.platform === "windows-powershell");
}

function isRemoteAccessPairingInfo(value: unknown): value is RemoteAccessPairingInfo {
  return isRecord(value)
    && isRemoteAccessStatus(value.status)
    && typeof value.token === "string"
    && typeof value.pairingUrl === "string"
    && Array.isArray(value.warnings)
    && value.warnings.every((warning) => typeof warning === "string");
}

function isRemoteAccessUpdateResponse(value: unknown): value is RemoteAccessUpdateResponse {
  return isRecord(value) && isRemoteAccessStatus(value.status) && (value.pairing === undefined || isRemoteAccessPairingInfo(value.pairing));
}

function isRemoteAccessRestartResponse(value: unknown): value is RemoteAccessRestartResponse {
  return isRecord(value)
    && value.accepted === true
    && typeof value.reconnectDelayMs === "number"
    && typeof value.message === "string"
    && isRemoteAccessStatus(value.status);
}

function isRemoteAccessWindowsPortProxyResponse(value: unknown): value is RemoteAccessWindowsPortProxyResponse {
  return isRecord(value)
    && value.accepted === true
    && isRemoteAccessStatus(value.status)
    && typeof value.targetHost === "string"
    && typeof value.listenPort === "number"
    && typeof value.requiresAdmin === "boolean"
    && typeof value.message === "string";
}
