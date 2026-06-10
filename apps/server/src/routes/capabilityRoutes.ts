import type { FastifyInstance, FastifyRequest } from "fastify";
import type { AppDatabase } from "../db.js";
import { discoverProjectPiExtensions } from "../runtime/piExtensionDiscovery.js";

type ProjectParams = { projectId?: string };

export async function registerCapabilityRoutes(fastify: FastifyInstance, { db }: { db: AppDatabase }): Promise<void> {
  fastify.get("/api/projects/:projectId/extensions", async (request: FastifyRequest<{ Params: ProjectParams }>) => {
    const projectId = request.params.projectId;
    if (!projectId) throw new Error("Project id is required");
    const project = db.getProject(projectId);
    if (!project) throw new Error(`Project not found: ${projectId}`);
    return { extensions: discoverProjectPiExtensions(project.cwd) };
  });
}
