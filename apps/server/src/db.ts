import Database from "better-sqlite3";
import { mkdirSync } from "node:fs";
import { dirname, resolve } from "node:path";
import type { AppSettings, ConversationContextUsage, ConversationMessage, GuiEvent, GuiSession, Project, Runtime, RuntimeConversationSummary, SubagentRun } from "@pi-gui/shared";
import { ConversationStore } from "./db/conversations.js";
import { EventLogStore } from "./db/events.js";
import { ProjectStore } from "./db/projects.js";
import { RuntimeStore } from "./db/runtimes.js";
import { migrateDatabase } from "./db/schema.js";
import { SessionStore } from "./db/sessions.js";
import { SettingsStore } from "./db/settings.js";
import { SubagentRunStore } from "./db/subagentRuns.js";

export class AppDatabase {
  private readonly db: Database.Database;
  private readonly conversations: ConversationStore;
  private readonly eventLog: EventLogStore;
  private readonly projects: ProjectStore;
  private readonly runtimes: RuntimeStore;
  private readonly sessions: SessionStore;
  private readonly settings: SettingsStore;
  private readonly subagentRuns: SubagentRunStore;

  constructor(filePath = defaultDbPath()) {
    mkdirSync(dirname(filePath), { recursive: true });
    this.db = new Database(filePath);
    this.db.pragma("journal_mode = WAL");
    migrateDatabase(this.db);
    this.conversations = new ConversationStore(this.db);
    this.eventLog = new EventLogStore(this.db);
    this.projects = new ProjectStore(this.db);
    this.runtimes = new RuntimeStore(this.db);
    this.sessions = new SessionStore(this.db);
    this.settings = new SettingsStore(this.db);
    this.subagentRuns = new SubagentRunStore(this.db);
    this.runtimes.markOrphanedRuntimesCrashed();
    this.runtimes.archiveStoppedRuntimesWithoutSessions();
    this.subagentRuns.markOrphanedSubagentRunsFailed();
  }

  close(): void {
    this.db.close();
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

  touchProject(id: string, timestamp = Date.now()): void {
    this.projects.touchProject(id, timestamp);
  }

  getSettings(): AppSettings {
    return this.settings.getSettings();
  }

  updateSettings(settings: AppSettings): AppSettings {
    return this.settings.updateSettings(settings);
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

  listSessions(projectId?: string, limit = 200): GuiSession[] {
    const childSessionFiles = this.subagentRuns.listChildSessionFiles();
    if (childSessionFiles.size === 0) return this.sessions.listSessions(projectId, limit);
    return this.sessions.listSessions(projectId, limit).filter((session) => !childSessionFiles.has(session.piSessionFile));
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

  lastEventId(): number {
    return this.eventLog.lastEventId();
  }

  appendEvent(input: Omit<GuiEvent, "id" | "timestamp"> & { timestamp?: number }): GuiEvent {
    return this.eventLog.appendEvent(input);
  }

  listEvents(afterEventId = 0, limit = 500, filters: { projectId?: string; runtimeId?: string } = {}): GuiEvent[] {
    return this.eventLog.listEvents(afterEventId, limit, filters);
  }

  recentEvents(limit = 200, maxPayloadBytes?: number): GuiEvent[] {
    return this.eventLog.recentEvents(limit, maxPayloadBytes);
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

function defaultDbPath(): string {
  return resolve(process.env.PI_GUI_DATA_DIR ?? ".pi-gui", "pi-gui.sqlite");
}
