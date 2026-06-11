import Database from "better-sqlite3";
import { mkdirSync } from "node:fs";
import { dirname } from "node:path";
import type { AppSettings, ConversationContextUsage, ConversationMessage, ExecutionHostRef, GuiEvent, GuiEventKind, GuiSession, Project, RewindCheckpointOperation, RewindCheckpointSummary, Runtime, RuntimeConversationSummary, SubagentRun } from "@pi-gui/shared";
import { ConversationStore } from "./db/conversations.js";
import { EventLogStore } from "./db/events.js";
import { ProjectStore } from "./db/projects.js";
import { RuntimeStore } from "./db/runtimes.js";
import { migrateDatabase } from "./db/schema.js";
import { RewindCheckpointLinkStore, type RewindCheckpointConversationLink } from "./db/rewindCheckpointLinks.js";
import { RewindCheckpointOperationStore } from "./db/rewindCheckpointOperations.js";
import { RewindCheckpointStore } from "./db/rewindCheckpoints.js";
import { RewindJumpHistoryStore, type RewindJumpHistoryEntry } from "./db/rewindJumpHistory.js";
import { SessionFileSummaryCacheStore, type SessionFileSummaryCacheContext, type SessionFileSummaryCacheEntry } from "./db/sessionFileSummaryCache.js";
import { SessionTokenUsageCacheStore, type SessionTokenUsageCacheContext, type SessionTokenUsageCacheEntry } from "./db/sessionTokenUsageCache.js";
import { sessionCursorFromSession, SessionStore, type SessionListPage } from "./db/sessions.js";
import { SettingsStore } from "./db/settings.js";
import { SubagentRunStore } from "./db/subagentRuns.js";
import { TokenUsageCacheStore, type TokenUsageCacheContext, type TokenUsageFileCacheEntry } from "./db/tokenUsageCache.js";
import { readExecutionHost } from "./services/executionHost.js";
import { importLegacyDesktopData } from "./services/legacyDesktopDataImport.js";
import { defaultDbPath } from "./serverPaths.js";

export class AppDatabase {
  private readonly db: Database.Database;
  private readonly conversations: ConversationStore;
  private readonly eventLog: EventLogStore;
  private readonly projects: ProjectStore;
  private readonly runtimes: RuntimeStore;
  private readonly sessions: SessionStore;
  private readonly settings: SettingsStore;
  private readonly rewindCheckpointLinks: RewindCheckpointLinkStore;
  private readonly rewindCheckpointOperations: RewindCheckpointOperationStore;
  private readonly rewindCheckpoints: RewindCheckpointStore;
  private readonly rewindJumpHistory: RewindJumpHistoryStore;
  private readonly subagentRuns: SubagentRunStore;
  private readonly tokenUsageCache: TokenUsageCacheStore;
  private readonly sessionFileSummaryCache: SessionFileSummaryCacheStore;
  private readonly sessionTokenUsageCache: SessionTokenUsageCacheStore;
  private readonly executionHost?: ExecutionHostRef;

  constructor(filePath = defaultDbPath(), executionHost = readExecutionHost()) {
    this.executionHost = executionHost;
    const shouldImportLegacyDesktopData = filePath === defaultDbPath();
    mkdirSync(dirname(filePath), { recursive: true });
    this.db = new Database(filePath);
    this.db.pragma("journal_mode = WAL");
    migrateDatabase(this.db);
    this.conversations = new ConversationStore(this.db);
    this.eventLog = new EventLogStore(this.db);
    this.projects = new ProjectStore(this.db, this.executionHost);
    this.runtimes = new RuntimeStore(this.db, this.executionHost);
    this.sessions = new SessionStore(this.db, this.executionHost);
    this.settings = new SettingsStore(this.db);
    this.rewindCheckpointLinks = new RewindCheckpointLinkStore(this.db);
    this.rewindCheckpointOperations = new RewindCheckpointOperationStore(this.db);
    this.rewindCheckpoints = new RewindCheckpointStore(this.db);
    this.rewindJumpHistory = new RewindJumpHistoryStore(this.db);
    this.subagentRuns = new SubagentRunStore(this.db);
    this.tokenUsageCache = new TokenUsageCacheStore(this.db);
    this.sessionFileSummaryCache = new SessionFileSummaryCacheStore(this.db);
    this.sessionTokenUsageCache = new SessionTokenUsageCacheStore(this.db);
    if (shouldImportLegacyDesktopData) importLegacyDesktopData(this);
    for (const runtime of this.runtimes.markOrphanedRuntimesCrashed()) {
      this.conversations.markStreamingMessagesInterrupted(runtime.id, runtime.projectId, "GUI 服务重启，工具未返回结果。");
    }
    this.runtimes.archiveStoppedRuntimesWithoutSessions();
    this.subagentRuns.markOrphanedSubagentRunsFailed();
  }

  close(): void {
    this.db.close();
  }

  getExecutionHost(): ExecutionHostRef | undefined {
    return this.executionHost;
  }

  listProjects(): Project[] {
    return this.projects.listProjects();
  }

  getProject(id: string): Project | undefined {
    return this.projects.getProject(id);
  }

  createProject(project: Project): Project {
    return this.projects.createProject(project);
  }

  updateProjectRuntimeProfile(projectId: string, defaultRuntimeProfileId: Project["defaultRuntimeProfileId"] | null): Project | undefined {
    return this.projects.updateProjectRuntimeProfile(projectId, defaultRuntimeProfileId);
  }

  touchProject(id: string, timestamp = Date.now()): void {
    this.projects.touchProject(id, timestamp);
  }

  getSettings(): AppSettings {
    return this.settings.getSettings();
  }

  updateSettings(settings: AppSettings): AppSettings {
    return this.settings.updateSettings(settings);
  }

  getSettingValue(key: string): string | undefined {
    return this.settings.getSettingValue(key);
  }

  setSettingValue(key: string, value: string | undefined, timestamp?: number): void {
    this.settings.setSettingValue(key, value, timestamp);
  }

  getTokenUsageFileCache(filePath: string, context: TokenUsageCacheContext): TokenUsageFileCacheEntry | undefined {
    return this.tokenUsageCache.getFileCache(filePath, context);
  }

  upsertTokenUsageFileCache(entry: TokenUsageFileCacheEntry): void {
    this.tokenUsageCache.upsertFileCache(entry);
  }

  deleteTokenUsageFileCache(filePath: string): void {
    this.tokenUsageCache.deleteFileCache(filePath);
  }

  getSessionFileSummaryCache(filePath: string, context: SessionFileSummaryCacheContext): SessionFileSummaryCacheEntry | undefined {
    return this.sessionFileSummaryCache.getFileSummary(filePath, context);
  }

  upsertSessionFileSummaryCache(entry: SessionFileSummaryCacheEntry): void {
    this.sessionFileSummaryCache.upsertFileSummary(entry);
  }

  deleteSessionFileSummaryCache(filePath: string): void {
    this.sessionFileSummaryCache.deleteFileSummary(filePath);
  }

  getSessionTokenUsageCache(filePath: string, context: SessionTokenUsageCacheContext): SessionTokenUsageCacheEntry | undefined {
    return this.sessionTokenUsageCache.getFileUsage(filePath, context);
  }

  upsertSessionTokenUsageCache(entry: SessionTokenUsageCacheEntry): void {
    this.sessionTokenUsageCache.upsertFileUsage(entry);
  }

  deleteSessionTokenUsageCache(filePath: string): void {
    this.sessionTokenUsageCache.deleteFileUsage(filePath);
  }

  upsertRuntime(runtime: Runtime): Runtime {
    return this.runtimes.upsertRuntime(runtime);
  }

  listRuntimes(limit = 100): Runtime[] {
    return this.runtimes.listRuntimes(limit);
  }

  getRuntime(id: string): Runtime | undefined {
    return this.runtimes.getRuntime(id);
  }

  getLatestRuntimeBySessionId(sessionId: string): Runtime | undefined {
    return this.runtimes.getLatestRuntimeBySessionId(sessionId);
  }

  archiveRuntime(id: string, timestamp = Date.now()): Runtime | undefined {
    return this.runtimes.archiveRuntime(id, timestamp);
  }

  listSessions(projectId?: string, limit = 200, options: { childSessionFiles?: Set<string> } = {}): GuiSession[] {
    return this.listSessionsPage(projectId, limit, undefined, options).sessions;
  }

  listSessionsPage(projectId?: string, limit = 200, cursor?: string, options: { childSessionFiles?: Set<string> } = {}): SessionListPage {
    const childSessionFiles = options.childSessionFiles ?? this.subagentRuns.listChildSessionFiles();
    if (childSessionFiles.size === 0) return this.sessions.listSessionsPage(projectId, limit, cursor);

    const boundedLimit = Math.max(1, Math.min(limit, 1000));
    const sessions: GuiSession[] = [];
    let nextCursor = cursor;
    let hasMore = false;
    for (let pageCount = 0; pageCount < 20 && sessions.length < boundedLimit; pageCount += 1) {
      const page = this.sessions.listSessionsPage(projectId, boundedLimit, nextCursor);
      for (const [index, session] of page.sessions.entries()) {
        if (!childSessionFiles.has(session.piSessionFile)) sessions.push(session);
        if (sessions.length >= boundedLimit) {
          nextCursor = sessionCursorFromSession(session);
          hasMore = page.hasMore || index < page.sessions.length - 1;
          break;
        }
      }
      if (sessions.length >= boundedLimit) break;
      nextCursor = page.nextCursor;
      hasMore = page.hasMore;
      if (!page.hasMore || !nextCursor) break;
    }
    return { sessions: sessions.slice(0, boundedLimit), hasMore, nextCursor: hasMore ? nextCursor : undefined };
  }

  listChildSessionFiles(): Set<string> {
    return this.subagentRuns.listChildSessionFiles();
  }

  isSessionVisible(session: GuiSession): boolean {
    return !this.subagentRuns.isChildSessionFile(session.piSessionFile);
  }

  getSession(id: string): GuiSession | undefined {
    return this.sessions.getSession(id);
  }

  upsertSession(session: GuiSession): GuiSession {
    return this.sessions.upsertSession(session);
  }

  upsertConversationMessage(message: ConversationMessage): ConversationMessage {
    return this.conversations.upsertConversationMessage(message);
  }

  getConversationMessage(runtimeId: string, messageId: string): ConversationMessage | undefined {
    return this.conversations.getConversationMessage(runtimeId, messageId);
  }

  listConversationMessages(runtimeId: string, limit = 100): ConversationMessage[] {
    return this.conversations.listConversationMessages(runtimeId, limit);
  }

  hasConversationMessages(runtimeId: string): boolean {
    return this.conversations.hasConversationMessages(runtimeId);
  }

  listLatestConversationMessages(runtimeId: string, limit = 100): { messages: ConversationMessage[]; hasMoreBefore: boolean } {
    return this.conversations.listLatestConversationMessages(runtimeId, limit);
  }

  listConversationMessagesBefore(runtimeId: string, beforeMessageId: string, limit = 100): { messages: ConversationMessage[]; hasMoreBefore: boolean } {
    return this.conversations.listConversationMessagesBefore(runtimeId, beforeMessageId, limit);
  }

  listRuntimeConversationSummaries(limit = 100): RuntimeConversationSummary[] {
    return this.conversations.listRuntimeConversationSummaries(limit);
  }

  replaceConversationMessages(runtimeId: string, messages: ConversationMessage[]): void {
    this.conversations.replaceConversationMessages(runtimeId, messages);
  }

  getConversationContext(runtimeId: string): ConversationContextUsage | undefined {
    return this.conversations.getConversationContext(runtimeId);
  }

  updateConversationContext(runtimeId: string, projectId: string, usage: ConversationContextUsage): ConversationContextUsage {
    return this.conversations.updateConversationContext(runtimeId, projectId, usage);
  }

  getConversationBusy(runtimeId: string): boolean {
    return this.conversations.getConversationBusy(runtimeId);
  }

  setConversationBusy(runtimeId: string, projectId: string, busy: boolean, timestamp = Date.now()): boolean {
    return this.conversations.setConversationBusy(runtimeId, projectId, busy, timestamp);
  }

  markStreamingConversationMessagesInterrupted(runtimeId: string, projectId: string, reasonText: string, timestamp = Date.now()): ConversationMessage[] {
    return this.conversations.markStreamingMessagesInterrupted(runtimeId, projectId, reasonText, timestamp);
  }

  lastEventId(): number {
    return this.eventLog.lastEventId();
  }

  firstEventId(): number {
    return this.eventLog.firstEventId();
  }

  appendEvent(input: Omit<GuiEvent, "id" | "timestamp"> & { timestamp?: number }): GuiEvent {
    return this.eventLog.appendEvent(input);
  }

  listEvents(afterEventId = 0, limit = 500, filters: { projectId?: string; runtimeId?: string; kinds?: GuiEventKind[] } = {}): GuiEvent[] {
    return this.eventLog.listEvents(afterEventId, limit, filters);
  }

  listEventsBudgeted(afterEventId = 0, limit = 500, maxPayloadBytes?: number, filters: { projectId?: string; runtimeId?: string; kinds?: GuiEventKind[] } = {}): { events: GuiEvent[]; truncated: boolean } {
    return this.eventLog.listEventsBudgeted(afterEventId, limit, maxPayloadBytes, filters);
  }

  listRecentEvents(limit = 500, filters: { projectId?: string; runtimeId?: string; kinds?: GuiEventKind[] } = {}): GuiEvent[] {
    return this.eventLog.listRecentEvents(limit, filters);
  }

  recentEvents(limit = 200, maxPayloadBytes?: number): GuiEvent[] {
    return this.eventLog.recentEvents(limit, maxPayloadBytes);
  }

  listRewindCheckpoints(projectId: string, limit = 200): RewindCheckpointSummary[] {
    return this.rewindCheckpoints.listCheckpoints(projectId, limit);
  }

  upsertRewindCheckpoint(checkpoint: RewindCheckpointSummary): void {
    this.rewindCheckpoints.upsertCheckpoint(checkpoint);
  }

  replaceProjectRewindCheckpoints(projectId: string, checkpoints: RewindCheckpointSummary[]): void {
    this.rewindCheckpoints.replaceProjectCheckpoints(projectId, checkpoints);
  }

  listRecentRewindCheckpointOperations(limit = 20): RewindCheckpointOperation[] {
    return this.rewindCheckpointOperations.listRecent(limit);
  }

  appendRewindCheckpointOperation(operation: Omit<RewindCheckpointOperation, "id">): RewindCheckpointOperation {
    return this.rewindCheckpointOperations.appendOperation(operation);
  }

  getRewindCheckpointConversationLink(projectId: string, snapshotId: string): RewindCheckpointConversationLink | undefined {
    return this.rewindCheckpointLinks.getConversationLink(projectId, snapshotId);
  }

  upsertRewindCheckpointConversationLink(link: RewindCheckpointConversationLink): void {
    this.rewindCheckpointLinks.upsertConversationLink(link);
  }

  listRecentRewindJumpHistory(limit = 50, projectId?: string): RewindJumpHistoryEntry[] {
    return this.rewindJumpHistory.listRecent(limit, projectId);
  }

  appendRewindJumpHistory(entry: Omit<RewindJumpHistoryEntry, "id">): RewindJumpHistoryEntry {
    return this.rewindJumpHistory.append(entry);
  }

  upsertSubagentRun(run: SubagentRun): SubagentRun {
    return this.subagentRuns.upsertSubagentRun(run);
  }

  getSubagentRun(id: string): SubagentRun | undefined {
    return this.subagentRuns.getSubagentRun(id);
  }

  getSubagentRunByParentToolCall(parentRuntimeId: string, parentToolCallId: string): SubagentRun | undefined {
    return this.subagentRuns.getSubagentRunByParentToolCall(parentRuntimeId, parentToolCallId);
  }

  listSubagentRuns(parentRuntimeId?: string, limit = 500): SubagentRun[] {
    return this.subagentRuns.listSubagentRuns(parentRuntimeId, limit);
  }

  listActiveSubagentRuns(limit = 500): SubagentRun[] {
    return this.subagentRuns.listActiveSubagentRuns(limit);
  }
}
