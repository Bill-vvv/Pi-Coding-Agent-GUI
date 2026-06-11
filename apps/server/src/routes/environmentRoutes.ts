import type { FastifyInstance } from "fastify";
import { getCachedEnvironmentDiagnostics } from "../services/environmentService.js";

export async function registerEnvironmentRoutes(fastify: FastifyInstance): Promise<void> {
  fastify.get("/api/environment", async () => ({ environment: await getCachedEnvironmentDiagnostics() }));
}
