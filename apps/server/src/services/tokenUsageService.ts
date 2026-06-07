import { resolve } from "node:path";
import type { Project, TokenUsageOverview, TokenUsageRange } from "@pi-gui/shared";
import { isRecord } from "@pi-gui/shared";
import type { AppDatabase } from "../db.js";
import {
  addDailyUsage,
  addModelUsage,
  cloneContribution,
  createEmptyContribution,
  DEFAULT_MAX_USAGE_LINE_BYTES,
  DEFAULT_MAX_USAGE_SCAN_FILES,
  emptyTokenUsageOverview,
  findSessionMetadata,
  listSessionFiles,
  localDayKey,
  mergeContribution,
  modelContextFromRecord,
  overviewFromContribution,
  parseJsonRecord,
  piSessionRoot,
  processJsonlLines,
  safeMtimeMs,
  safeStat,
  sessionRootExists,
  stringField,
  timestampFromValue,
  usageFromRecord,
  type CachedFileUsage,
  type FileContribution,
  type ModelContext,
  type OverviewInput,
  type TokenUsageServiceOptions,
} from "./tokenUsage/index.js";

export type { TokenUsageServiceOptions } from "./tokenUsage/index.js";
export { emptyTokenUsageOverview } from "./tokenUsage/index.js";

export class TokenUsageService {
  private readonly cache = new Map<string, CachedFileUsage>();
  private readonly maxScanFiles: number;
  private readonly maxLineBytes: number;
  private readonly now: () => number;

  constructor(options: TokenUsageServiceOptions = {}) {
    this.maxScanFiles = options.maxScanFiles ?? DEFAULT_MAX_USAGE_SCAN_FILES;
    this.maxLineBytes = options.maxLineBytes ?? DEFAULT_MAX_USAGE_LINE_BYTES;
    this.now = options.now ?? (() => Date.now());
  }

  getOverview(db: AppDatabase, input: OverviewInput = {}): TokenUsageOverview {
    const range = normalizeTokenUsageRange(input.range);
    const projects = db.listProjects();
    const projectByCwd = new Map(projects.map((project) => [resolve(project.cwd), project]));
    const knownProjectIds = new Set(projects.map((project) => project.id));

    if (input.projectId && !knownProjectIds.has(input.projectId)) {
      return emptyOverview(range, input.projectId, this.now());
    }

    const root = piSessionRoot();
    if (!sessionRootExists(root) || projects.length === 0) return emptyOverview(range, input.projectId, this.now());

    const listedFiles = listSessionFiles(root)
      .map((filePath) => ({ filePath, mtimeMs: safeMtimeMs(filePath) }))
      .sort((left, right) => right.mtimeMs - left.mtimeMs);
    const scanLimited = listedFiles.length > this.maxScanFiles;
    const files = listedFiles.slice(0, this.maxScanFiles);
    const seenFiles = new Set(files.map((file) => file.filePath));
    for (const filePath of this.cache.keys()) {
      if (!seenFiles.has(filePath)) this.cache.delete(filePath);
    }

    const combined = createEmptyContribution();
    combined.coverage.scanLimited = scanLimited;

    for (const { filePath } of files) {
      const contribution = this.parseFile(filePath, projectByCwd);
      if (!contribution.projectId) continue;
      if (input.projectId && contribution.projectId !== input.projectId) continue;
      mergeContribution(combined, contribution);
    }

    return overviewFromContribution(combined, range, input.projectId, this.now());
  }

  private parseFile(filePath: string, projectByCwd: Map<string, Project>): FileContribution {
    const stats = safeStat(filePath);
    const cached = stats ? this.cache.get(filePath) : undefined;
    if (cached && cached.mtimeMs === stats?.mtimeMs && cached.size === stats.size) {
      const contribution = cloneContribution(cached.contribution);
      contribution.coverage.cachedFiles += 1;
      return contribution;
    }

    const contribution = createEmptyContribution();
    contribution.coverage.scannedFiles = 1;
    let modelContext: ModelContext = {};

    const metadata = findSessionMetadata(filePath, this.maxLineBytes);
    contribution.sessionId = metadata?.id;
    contribution.sessionStartedAt = metadata?.timestamp;
    if (metadata?.cwd) contribution.projectId = projectByCwd.get(resolve(metadata.cwd))?.id;
    if (!contribution.projectId) return contribution;

    const readOk = processJsonlLines(filePath, this.maxLineBytes, (line, truncated) => {
      if (truncated) {
        contribution.coverage.truncatedLines += 1;
        return;
      }
      const trimmed = line.trim();
      if (!trimmed) return;

      const record = parseJsonRecord(trimmed);
      if (!record) {
        contribution.coverage.malformedLines += 1;
        return;
      }

      if (record.type === "model_change") {
        modelContext = modelContextFromRecord(record, modelContext);
        return;
      }

      if (record.type !== "message") return;
      const message = isRecord(record.message) ? record.message : undefined;
      if (!message || message.role !== "assistant") return;
      contribution.coverage.assistantMessages += 1;

      const usage = isRecord(message.usage) ? usageFromRecord(message.usage) : undefined;
      if (!usage || usage.total === undefined || usage.total <= 0) {
        contribution.coverage.missingUsageMessages += 1;
        return;
      }

      const timestamp = timestampFromValue(message.timestamp) ?? timestampFromValue(record.timestamp);
      if (!timestamp) {
        contribution.coverage.skippedMissingTimestamp += 1;
        return;
      }

      contribution.coverage.recordedUsageMessages += 1;
      const day = localDayKey(timestamp);
      const hour = new Date(timestamp).getHours();
      contribution.peakHours.set(hour, (contribution.peakHours.get(hour) ?? 0) + usage.total);
      const provider = stringField(message.provider) ?? stringField(record.provider) ?? modelContext.provider;
      const model = stringField(message.model) ?? stringField(record.model) ?? stringField(message.modelId) ?? stringField(record.modelId) ?? modelContext.model ?? "unknown";
      addDailyUsage(contribution.days, day, usage, contribution.sessionId, model, provider);
      addModelUsage(contribution.models, day, usage.total, model, provider);
    });

    if (!readOk) return contribution;
    if (stats) this.cache.set(filePath, { mtimeMs: stats.mtimeMs, size: stats.size, contribution: cloneContribution(contribution) });
    return contribution;
  }
}

export function normalizeTokenUsageRange(value: unknown): TokenUsageRange {
  return value === "all" || value === "7d" || value === "30d" ? value : "30d";
}

function emptyOverview(range: TokenUsageRange, projectId: string | undefined, generatedAt: number): TokenUsageOverview {
  return emptyTokenUsageOverview(range, projectId, generatedAt);
}
