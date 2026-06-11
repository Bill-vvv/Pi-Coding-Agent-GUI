import Database from "better-sqlite3";
import { existsSync } from "node:fs";
import type { GuiSession, Project } from "@pi-gui/shared";
import type { AppDatabase } from "../db.js";
import { projectFromRow, sessionFromRow } from "../db/mappers.js";
import type { ProjectRow, SessionRow } from "../db/rows.js";
import { defaultDbPath, legacyDesktopDbPath } from "../serverPaths.js";

export type LegacyDesktopImportResult = {
  importedProjects: number;
  importedSessions: number;
};

export function importLegacyDesktopData(target: AppDatabase, options: {
  env?: NodeJS.ProcessEnv;
  fromUrl?: string;
  log?: (message: string) => void;
} = {}): LegacyDesktopImportResult {
  const env = options.env ?? process.env;
  const fromUrl = options.fromUrl ?? import.meta.url;
  const log = options.log ?? console.warn;
  if (env.PI_GUI_DATA_DIR?.trim()) return { importedProjects: 0, importedSessions: 0 };

  const currentDbPath = defaultDbPath(env, fromUrl);
  const legacyDb = legacyDesktopDbPath(fromUrl);
  if (currentDbPath === legacyDb || !existsSync(legacyDb)) return { importedProjects: 0, importedSessions: 0 };

  let source: Database.Database | undefined;
  try {
    source = new Database(legacyDb, { readonly: true, fileMustExist: true });
    const currentProjects = new Map(target.listProjects().map((project) => [project.cwd, project]));
    const legacyProjects = source.prepare("select * from projects order by last_opened_at desc").all() as ProjectRow[];
    const projectIdMap = new Map<string, string>();
    let importedProjects = 0;

    for (const row of legacyProjects) {
      const project = projectFromRow(row);
      const existing = currentProjects.get(project.cwd);
      if (existing) {
        projectIdMap.set(project.id, existing.id);
        continue;
      }
      const created = target.createProject(project);
      currentProjects.set(created.cwd, created);
      projectIdMap.set(project.id, created.id);
      importedProjects += 1;
    }

    const legacySessions = source.prepare("select * from sessions order by updated_at desc").all() as SessionRow[];
    let importedSessions = 0;
    for (const row of legacySessions) {
      if (target.getSession(row.id)) continue;
      const projectId = projectIdMap.get(row.project_id);
      if (!projectId) continue;
      const session = sessionFromRow(row);
      target.upsertSession(migratedSession(session, projectId, target.getProject(projectId)));
      importedSessions += 1;
    }

    if (importedProjects || importedSessions) {
      log(`[pi-gui] Imported ${importedProjects} project(s) and ${importedSessions} session(s) from legacy desktop data at ${legacyDb}.`);
    }
    return { importedProjects, importedSessions };
  } catch (error) {
    log(`[pi-gui] Skipped legacy desktop data import from ${legacyDb}: ${error instanceof Error ? error.message : String(error)}`);
    return { importedProjects: 0, importedSessions: 0 };
  } finally {
    source?.close();
  }
}

function migratedSession(session: GuiSession, projectId: string, project: Project | undefined): GuiSession {
  return {
    ...session,
    projectId,
    runtimeId: undefined,
    host: session.host ?? project?.host,
  };
}
