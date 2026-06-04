import type Database from "better-sqlite3";
import type { Project } from "@pi-gui/shared";
import { projectFromRow } from "./mappers.js";
import type { ProjectRow } from "./rows.js";

export class ProjectStore {
  constructor(private readonly db: Database.Database) {}

  listProjects(): Project[] {
    const rows = this.db.prepare("select * from projects order by last_opened_at desc").all() as ProjectRow[];
    return rows.map(projectFromRow);
  }

  getProject(id: string): Project | undefined {
    const row = this.db.prepare("select * from projects where id = ?").get(id) as ProjectRow | undefined;
    return row ? projectFromRow(row) : undefined;
  }

  createProject(project: Project): Project {
    this.db
      .prepare(
        `insert into projects (id, name, cwd, last_opened_at, default_model)
         values (@id, @name, @cwd, @lastOpenedAt, @defaultModel)`,
      )
      .run({ ...project, defaultModel: project.defaultModel ?? null });
    return project;
  }

  touchProject(id: string, timestamp = Date.now()): void {
    this.db.prepare("update projects set last_opened_at = ? where id = ?").run(timestamp, id);
  }
}
