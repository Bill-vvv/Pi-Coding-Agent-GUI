import type Database from "better-sqlite3";
import type { ExecutionHostRef, Project } from "@pi-gui/shared";
import { projectFromRow } from "./mappers.js";
import type { ProjectRow } from "./rows.js";
import { projectIdentityKey } from "../services/projectIdentity.js";

export type EnsureProjectResult = { project: Project; created: boolean };

export class ProjectStore {
  constructor(
    private readonly db: Database.Database,
    private readonly executionHost?: ExecutionHostRef,
  ) {}

  listProjects(): Project[] {
    const rows = this.db.prepare("select * from projects order by last_opened_at desc").all() as ProjectRow[];
    return rows.map((row) => projectFromRow(row, preferredProjectCwd(row, this.executionHost)));
  }

  getProject(id: string): Project | undefined {
    const row = this.db.prepare("select * from projects where id = ?").get(id) as ProjectRow | undefined;
    return row ? projectFromRow(row, preferredProjectCwd(row, this.executionHost)) : undefined;
  }

  findProjectByCwdOrIdentity(cwd: string): Project | undefined {
    const targetKey = projectIdentityKey(cwd);
    const rows = this.db.prepare("select * from projects order by last_opened_at desc").all() as ProjectRow[];
    const matched = rows.find((row) => projectPathKeys(row).has(targetKey));
    return matched ? projectFromRow(matched, preferredProjectCwd(matched, this.executionHost)) : undefined;
  }

  ensureProject(project: Project): EnsureProjectResult {
    const host = project.host ?? this.executionHost;
    const nextProject = host ? { ...project, host } : project;
    const existing = this.findProjectByCwdOrIdentity(nextProject.cwd);
    if (!existing) return { project: this.createProject(nextProject), created: true };

    this.db
      .prepare(
        `update projects
         set last_opened_at = ?,
             cwd_wsl = coalesce(?, cwd_wsl),
             cwd_windows = coalesce(?, cwd_windows),
             host_kind = coalesce(?, host_kind),
             host_id = coalesce(?, host_id),
             host_label = coalesce(?, host_label)
         where id = ?`,
      )
      .run(
        nextProject.lastOpenedAt,
        host?.kind === "wsl" ? nextProject.cwd : null,
        host?.kind === "windows" ? nextProject.cwd : null,
        host?.kind ?? null,
        host?.id ?? null,
        host?.label ?? null,
        existing.id,
      );
    return { project: this.getProject(existing.id) ?? existing, created: false };
  }

  createProject(project: Project): Project {
    const host = project.host ?? this.executionHost;
    const nextProject = host ? { ...project, host } : project;
    this.db
      .prepare(
        `insert into projects (id, name, cwd, cwd_wsl, cwd_windows, last_opened_at, default_model, default_runtime_profile_id, host_kind, host_id, host_label)
         values (@id, @name, @cwd, @cwdWsl, @cwdWindows, @lastOpenedAt, @defaultModel, @defaultRuntimeProfileId, @hostKind, @hostId, @hostLabel)`,
      )
      .run({
        ...nextProject,
        cwdWsl: nextProject.host?.kind === "wsl" ? nextProject.cwd : null,
        cwdWindows: nextProject.host?.kind === "windows" ? nextProject.cwd : null,
        defaultModel: nextProject.defaultModel ?? null,
        defaultRuntimeProfileId: nextProject.defaultRuntimeProfileId ?? null,
        hostKind: nextProject.host?.kind ?? null,
        hostId: nextProject.host?.id ?? null,
        hostLabel: nextProject.host?.label ?? null,
      });
    return nextProject;
  }

  updateProjectRuntimeProfile(projectId: string, defaultRuntimeProfileId: Project["defaultRuntimeProfileId"] | null): Project | undefined {
    this.db.prepare("update projects set default_runtime_profile_id = ? where id = ?").run(defaultRuntimeProfileId ?? null, projectId);
    return this.getProject(projectId);
  }

  touchProject(id: string, timestamp = Date.now()): void {
    this.db.prepare("update projects set last_opened_at = ? where id = ?").run(timestamp, id);
  }
}

function preferredProjectCwd(row: ProjectRow, host?: ExecutionHostRef): string {
  if (host?.kind === "wsl") return row.cwd_wsl ?? row.cwd;
  if (host?.kind === "windows") return row.cwd_windows ?? row.cwd;
  return row.cwd;
}

function projectPathKeys(row: ProjectRow): Set<string> {
  return new Set([row.cwd, row.cwd_wsl ?? undefined, row.cwd_windows ?? undefined].filter((value): value is string => Boolean(value)).map(projectIdentityKey));
}
