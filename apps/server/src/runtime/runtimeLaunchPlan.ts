import { randomUUID } from "node:crypto";
import type { Project, Runtime } from "@pi-gui/shared";
import type { AppDatabase } from "../db.js";
import type { RuntimeConfigOptions } from "./managedRuntime.js";

export type RuntimeResumeOptions = { session: string; runtime?: Runtime };

export type RuntimeLaunchPlan = {
  project: Project;
  runtime: Runtime;
  model?: string;
  thinkingLevel?: Runtime["thinkingLevel"];
  responseMode?: Runtime["responseMode"];
};

export function prepareRuntimeLaunchPlan(
  db: AppDatabase,
  projectId: string,
  config: RuntimeConfigOptions = {},
  resume?: RuntimeResumeOptions,
): RuntimeLaunchPlan {
  const project = db.getProject(projectId);
  if (!project) {
    throw new Error(`Project not found: ${projectId}`);
  }

  db.touchProject(projectId);

  const settings = db.getSettings();
  const isSessionResume = Boolean(resume?.session);
  const model = config.model ?? resume?.runtime?.model ?? (!isSessionResume ? project.defaultModel ?? settings.defaultModel : undefined);
  const thinkingLevel = config.thinkingLevel ?? resume?.runtime?.thinkingLevel ?? (!isSessionResume ? settings.defaultThinkingLevel : undefined);
  const responseMode = config.responseMode ?? resume?.runtime?.responseMode ?? (!isSessionResume ? settings.responseMode : undefined);

  return {
    project,
    runtime: {
      ...(resume?.runtime ?? {
        id: randomUUID(),
        projectId,
        cwd: project.cwd,
      }),
      status: "starting",
      pid: undefined,
      sessionId: resume?.session,
      startedAt: Date.now(),
      model,
      thinkingLevel,
      responseMode,
    },
    model,
    thinkingLevel,
    responseMode,
  };
}
