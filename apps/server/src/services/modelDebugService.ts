import { readFileSync } from "node:fs";
import type { AppSettings, GuiEvent, GuiSession, Project, ResponseMode, Runtime, ThinkingLevel } from "@pi-gui/shared";
import { isRecord } from "@pi-gui/shared";
import type { AppDatabase } from "../db.js";
import type { RuntimeSupervisor } from "../runtime/runtimeSupervisor.js";
import { modelKeyFromPiResponseData, thinkingLevelFromPiResponseData } from "../runtime/runtimePiPayload.js";

const MODEL_REQUEST_DEBUG_PREFIX = "PI_GUI_MODEL_REQUEST ";
const MAX_RECENT_MODEL_EVENTS_PER_RUNTIME = 12;

type ModelEvidenceSource = "provider_request" | "session_assistant_message" | "pi_state" | "runtime_config" | "session_model_change" | "settings_default" | "unknown";

type ModelDebugEvidence = {
  source: string;
  model?: string;
  thinkingLevel?: ThinkingLevel;
  timestamp?: number;
  eventId?: number;
  note?: string;
};

type ProviderRequestDebug = {
  model?: string;
  payloadModel?: string;
  contextModel?: string;
  provider?: string;
  modelId?: string;
  api?: string;
  serviceTier?: string;
  timestamp?: number;
  eventId?: number;
};

type SessionFileModelDebug = {
  model?: string;
  thinkingLevel?: ThinkingLevel;
  lastModelChangeModel?: string;
  lastModelChangeAt?: number;
  lastThinkingLevelChangeAt?: number;
  lastAssistantMessageModel?: string;
  lastAssistantMessageAt?: number;
  assistantModelCounts: Record<string, number>;
  entriesRead: number;
  error?: string;
};

type RuntimeEventModelDebug = {
  latestPiState?: ModelDebugEvidence;
  latestModelSwitch?: ModelDebugEvidence;
  latestThinkingSwitch?: ModelDebugEvidence;
  latestProviderRequest?: ProviderRequestDebug;
  recentModelEvents: ModelDebugEvidence[];
};

export type SessionModelDebugRow = {
  key: string;
  projectId: string;
  projectName?: string;
  cwd?: string;
  runtimeId?: string;
  runtimeStatus?: Runtime["status"];
  runtimeArchivedAt?: number;
  sessionId?: string;
  sessionTitle?: string;
  sessionFile?: string;
  sessionUpdatedAt?: number;
  guiConfiguredModel?: string;
  guiConfiguredThinkingLevel?: ThinkingLevel;
  guiConfiguredResponseMode?: ResponseMode;
  piReportedModel?: string;
  piReportedThinkingLevel?: ThinkingLevel;
  piReportedAt?: number;
  sessionFileModel?: string;
  sessionFileThinkingLevel?: ThinkingLevel;
  lastAssistantMessageModel?: string;
  lastAssistantMessageAt?: number;
  lastProviderRequestModel?: string;
  lastProviderRequestPayloadModel?: string;
  lastProviderRequestAt?: number;
  effectiveModel?: string;
  effectiveModelSource: ModelEvidenceSource;
  evidence: ModelDebugEvidence[];
  providerRequest?: ProviderRequestDebug;
  sessionFileScan?: SessionFileModelDebug;
  recentModelEvents: ModelDebugEvidence[];
};

export type SessionModelDebugSnapshot = {
  generatedAt: number;
  settings: AppSettings;
  rows: SessionModelDebugRow[];
  notes: string[];
};

export function buildSessionModelDebugSnapshot(db: AppDatabase, supervisor: RuntimeSupervisor): SessionModelDebugSnapshot {
  const generatedAt = Date.now();
  const settings = db.getSettings();
  const projects = db.listProjects();
  const sessions = db.listSessions();
  const runtimes = supervisor.listRuntimes();
  const events = db.recentEvents(20_000);

  const projectsById = new Map(projects.map((project) => [project.id, project]));
  const sessionsById = new Map(sessions.map((session) => [session.id, session]));
  const sessionsByRuntimeId = new Map(sessions.flatMap((session) => (session.runtimeId ? [[session.runtimeId, session] as const] : [])));
  const eventDebugByRuntime = modelDebugFromEvents(events);
  const sessionFileDebugBySessionId = new Map<string, SessionFileModelDebug>();

  const rows: SessionModelDebugRow[] = [];
  const coveredSessionIds = new Set<string>();

  for (const runtime of runtimes) {
    const session = (runtime.sessionId ? sessionsById.get(runtime.sessionId) : undefined) ?? sessionsByRuntimeId.get(runtime.id);
    if (session?.id) coveredSessionIds.add(session.id);
    rows.push(buildRow({
      generatedAt,
      runtime,
      session,
      project: projectsById.get(runtime.projectId),
      settings,
      eventDebug: eventDebugByRuntime.get(runtime.id),
      sessionFileDebug: session ? sessionFileDebug(session, sessionFileDebugBySessionId) : undefined,
    }));
  }

  for (const session of sessions) {
    if (coveredSessionIds.has(session.id)) continue;
    rows.push(buildRow({
      generatedAt,
      session,
      project: projectsById.get(session.projectId),
      settings,
      sessionFileDebug: sessionFileDebug(session, sessionFileDebugBySessionId),
    }));
  }

  rows.sort((left, right) => {
    const leftTime = left.lastProviderRequestAt ?? left.lastAssistantMessageAt ?? left.piReportedAt ?? left.sessionUpdatedAt ?? 0;
    const rightTime = right.lastProviderRequestAt ?? right.lastAssistantMessageAt ?? right.piReportedAt ?? right.sessionUpdatedAt ?? 0;
    return rightTime - leftTime;
  });

  return {
    generatedAt,
    settings,
    rows,
    notes: [
      "lastProviderRequestModel 来自 Pi extension 的 before_provider_request，代表最近一次实际发给 provider 前 GUI 看到的模型。",
      "lastAssistantMessageModel 来自 Pi session 文件中 assistant message 的 provider/model，代表已经完成并写入 session 的真实回复模型。",
      "piReportedModel 来自 Pi RPC get_state/set_model 响应，代表 Pi 进程报告的当前模型。",
      "guiConfiguredModel 是 GUI runtime 表保存的预期模型；如果它为空，右下角可能显示 fallback，但不代表 Pi 一定实际调用该模型。",
    ],
  };
}

function buildRow(input: {
  generatedAt: number;
  runtime?: Runtime;
  session?: GuiSession;
  project?: Project;
  settings: AppSettings;
  eventDebug?: RuntimeEventModelDebug;
  sessionFileDebug?: SessionFileModelDebug;
}): SessionModelDebugRow {
  const { runtime, session, project, settings, eventDebug, sessionFileDebug } = input;
  const evidence: ModelDebugEvidence[] = [];

  if (eventDebug?.latestProviderRequest?.model) {
    evidence.push({
      source: "provider_request",
      model: eventDebug.latestProviderRequest.model,
      timestamp: eventDebug.latestProviderRequest.timestamp,
      eventId: eventDebug.latestProviderRequest.eventId,
      note: eventDebug.latestProviderRequest.payloadModel ? `payload.model=${eventDebug.latestProviderRequest.payloadModel}` : undefined,
    });
  }
  if (sessionFileDebug?.lastAssistantMessageModel) {
    evidence.push({ source: "session_assistant_message", model: sessionFileDebug.lastAssistantMessageModel, timestamp: sessionFileDebug.lastAssistantMessageAt });
  }
  if (eventDebug?.latestPiState?.model || eventDebug?.latestPiState?.thinkingLevel) evidence.push(eventDebug.latestPiState);
  if (runtime?.model || runtime?.thinkingLevel) {
    evidence.push({ source: "runtime_config", model: runtime.model, thinkingLevel: runtime.thinkingLevel });
  }
  if (sessionFileDebug?.lastModelChangeModel || sessionFileDebug?.thinkingLevel) {
    evidence.push({ source: "session_model_change", model: sessionFileDebug.lastModelChangeModel, thinkingLevel: sessionFileDebug.thinkingLevel, timestamp: sessionFileDebug.lastModelChangeAt });
  }
  if (settings.defaultModel || settings.defaultThinkingLevel) {
    evidence.push({ source: "settings_default", model: settings.defaultModel, thinkingLevel: settings.defaultThinkingLevel });
  }

  const effective = firstModelEvidence(evidence) ?? { source: "unknown" as const };

  return {
    key: runtime?.id ?? session?.id ?? `${project?.id ?? "unknown"}-${input.generatedAt}`,
    projectId: runtime?.projectId ?? session?.projectId ?? project?.id ?? "unknown",
    projectName: project?.name,
    cwd: runtime?.cwd ?? project?.cwd,
    runtimeId: runtime?.id,
    runtimeStatus: runtime?.status,
    runtimeArchivedAt: runtime?.archivedAt,
    sessionId: runtime?.sessionId ?? session?.id,
    sessionTitle: session?.title,
    sessionFile: session?.piSessionFile,
    sessionUpdatedAt: session?.updatedAt,
    guiConfiguredModel: runtime?.model,
    guiConfiguredThinkingLevel: runtime?.thinkingLevel,
    guiConfiguredResponseMode: runtime?.responseMode,
    piReportedModel: eventDebug?.latestPiState?.model,
    piReportedThinkingLevel: eventDebug?.latestPiState?.thinkingLevel,
    piReportedAt: eventDebug?.latestPiState?.timestamp,
    sessionFileModel: sessionFileDebug?.model,
    sessionFileThinkingLevel: sessionFileDebug?.thinkingLevel,
    lastAssistantMessageModel: sessionFileDebug?.lastAssistantMessageModel,
    lastAssistantMessageAt: sessionFileDebug?.lastAssistantMessageAt,
    lastProviderRequestModel: eventDebug?.latestProviderRequest?.model,
    lastProviderRequestPayloadModel: eventDebug?.latestProviderRequest?.payloadModel,
    lastProviderRequestAt: eventDebug?.latestProviderRequest?.timestamp,
    effectiveModel: effective.model,
    effectiveModelSource: effective.source as ModelEvidenceSource,
    evidence,
    providerRequest: eventDebug?.latestProviderRequest,
    sessionFileScan: sessionFileDebug,
    recentModelEvents: eventDebug?.recentModelEvents ?? [],
  };
}

function firstModelEvidence(evidence: ModelDebugEvidence[]): ModelDebugEvidence | undefined {
  return evidence.find((item) => item.model);
}

function modelDebugFromEvents(events: GuiEvent[]): Map<string, RuntimeEventModelDebug> {
  const byRuntime = new Map<string, RuntimeEventModelDebug>();

  for (const event of events) {
    const debug = byRuntime.get(event.runtimeId) ?? { recentModelEvents: [] };
    byRuntime.set(event.runtimeId, debug);

    if (event.kind === "stderr" && typeof event.payload === "string") {
      for (const request of providerRequestDebugFromStderr(event.payload)) {
        const timestamp = request.timestamp ?? event.timestamp;
        const nextRequest: ProviderRequestDebug = { ...request, timestamp, eventId: event.id };
        debug.latestProviderRequest = nextRequest;
        appendRecent(debug, { source: "provider_request", model: nextRequest.model, timestamp, eventId: event.id, note: nextRequest.payloadModel ? `payload.model=${nextRequest.payloadModel}` : undefined });
      }
      continue;
    }

    if (event.kind !== "pi_event" || !isRecord(event.payload) || event.payload.type !== "response") continue;
    const command = typeof event.payload.command === "string" ? event.payload.command : undefined;
    const data = isRecord(event.payload.data) ? event.payload.data : undefined;
    if (!command || !data) continue;

    const model = modelKeyFromPiResponseData(data);
    const thinkingLevel = thinkingLevelFromPiResponseData(data);
    if (!model && !thinkingLevel) continue;

    const evidence: ModelDebugEvidence = { source: `pi_${command}`, model, thinkingLevel, timestamp: event.timestamp, eventId: event.id };
    appendRecent(debug, evidence);

    if (command === "get_state") {
      debug.latestPiState = { ...evidence, source: "pi_state" };
    } else if (command === "set_model" || command === "cycle_model") {
      debug.latestModelSwitch = evidence;
    } else if (command === "set_thinking_level" || command === "cycle_thinking_level") {
      debug.latestThinkingSwitch = evidence;
    }
  }

  return byRuntime;
}

function appendRecent(debug: RuntimeEventModelDebug, evidence: ModelDebugEvidence): void {
  debug.recentModelEvents.push(evidence);
  if (debug.recentModelEvents.length > MAX_RECENT_MODEL_EVENTS_PER_RUNTIME) {
    debug.recentModelEvents.splice(0, debug.recentModelEvents.length - MAX_RECENT_MODEL_EVENTS_PER_RUNTIME);
  }
}

function providerRequestDebugFromStderr(stderr: string): ProviderRequestDebug[] {
  return stderr
    .split(/\r?\n/)
    .flatMap((line) => {
      const index = line.indexOf(MODEL_REQUEST_DEBUG_PREFIX);
      if (index === -1) return [];
      const raw = line.slice(index + MODEL_REQUEST_DEBUG_PREFIX.length).trim();
      try {
        const parsed = JSON.parse(raw) as unknown;
        if (!isRecord(parsed)) return [];
        const payloadModel = typeof parsed.payloadModel === "string" ? parsed.payloadModel : undefined;
        const contextModel = typeof parsed.contextModel === "string" ? parsed.contextModel : undefined;
        const provider = typeof parsed.provider === "string" ? parsed.provider : undefined;
        const modelId = typeof parsed.modelId === "string" ? parsed.modelId : undefined;
        return [{
          model: typeof parsed.model === "string" ? parsed.model : contextModel ?? payloadModel ?? (provider && modelId ? `${provider}/${modelId}` : undefined),
          payloadModel,
          contextModel,
          provider,
          modelId,
          api: typeof parsed.api === "string" ? parsed.api : undefined,
          serviceTier: typeof parsed.serviceTier === "string" ? parsed.serviceTier : undefined,
          timestamp: typeof parsed.timestamp === "number" ? parsed.timestamp : undefined,
        }];
      } catch {
        return [];
      }
    });
}

function sessionFileDebug(session: GuiSession, cache: Map<string, SessionFileModelDebug>): SessionFileModelDebug | undefined {
  const existing = cache.get(session.id);
  if (existing) return existing;
  const debug = readSessionFileModelDebug(session.piSessionFile);
  cache.set(session.id, debug);
  return debug;
}

function readSessionFileModelDebug(filePath: string): SessionFileModelDebug {
  const result: SessionFileModelDebug = { assistantModelCounts: {}, entriesRead: 0 };

  let text: string;
  try {
    text = readFileSync(filePath, "utf8");
  } catch (error) {
    return { ...result, error: (error as Error).message };
  }

  for (const line of text.split("\n")) {
    const trimmed = line.trim();
    if (!trimmed) continue;
    result.entriesRead += 1;

    let entry: unknown;
    try {
      entry = JSON.parse(trimmed);
    } catch {
      continue;
    }
    if (!isRecord(entry)) continue;

    const timestamp = timestampFromEntry(entry);
    if (entry.type === "model_change") {
      const model = modelKeyFromProviderAndId(entry.provider, entry.modelId);
      if (model) {
        result.lastModelChangeModel = model;
        result.model = model;
        result.lastModelChangeAt = timestamp;
      }
      continue;
    }

    if (entry.type === "thinking_level_change") {
      const thinkingLevel = thinkingLevelFromValue(entry.thinkingLevel);
      if (thinkingLevel) {
        result.thinkingLevel = thinkingLevel;
        result.lastThinkingLevelChangeAt = timestamp;
      }
      continue;
    }

    if (entry.type === "message" && isRecord(entry.message) && entry.message.role === "assistant") {
      const model = modelKeyFromProviderAndId(entry.message.provider, entry.message.model);
      if (model) {
        result.lastAssistantMessageModel = model;
        result.lastAssistantMessageAt = timestamp;
        result.model = model;
        result.assistantModelCounts[model] = (result.assistantModelCounts[model] ?? 0) + 1;
      }
    }
  }

  return result;
}

function modelKeyFromProviderAndId(provider: unknown, modelId: unknown): string | undefined {
  if (typeof modelId !== "string" || !modelId.trim()) return undefined;
  const normalizedModelId = modelId.trim();
  if (typeof provider !== "string" || !provider.trim()) return normalizedModelId;
  const normalizedProvider = provider.trim();
  return normalizedModelId.startsWith(`${normalizedProvider}/`) ? normalizedModelId : `${normalizedProvider}/${normalizedModelId}`;
}

function thinkingLevelFromValue(value: unknown): ThinkingLevel | undefined {
  return value === "off" || value === "minimal" || value === "low" || value === "medium" || value === "high" || value === "xhigh" ? value : undefined;
}

function timestampFromEntry(entry: Record<string, unknown>): number | undefined {
  if (typeof entry.timestamp === "number" && Number.isFinite(entry.timestamp)) return entry.timestamp;
  if (typeof entry.timestamp !== "string") return undefined;
  const timestamp = Date.parse(entry.timestamp);
  return Number.isFinite(timestamp) ? timestamp : undefined;
}
