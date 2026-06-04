import type { FastifyInstance } from "fastify";
import type { TokenUsageRange } from "@pi-gui/shared";
import type { AppDatabase } from "../db.js";
import { normalizeTokenUsageRange, TokenUsageService } from "../services/tokenUsageService.js";

type UsageRouteOptions = {
  db: AppDatabase;
  service?: TokenUsageService;
};

export async function registerUsageRoutes(fastify: FastifyInstance, { db, service = new TokenUsageService() }: UsageRouteOptions): Promise<void> {
  fastify.get("/api/usage/overview", async (request) => {
    const query = request.query && typeof request.query === "object" ? (request.query as Record<string, unknown>) : {};
    const range = normalizeTokenUsageRange(query.range) as TokenUsageRange;
    const projectId = typeof query.projectId === "string" && query.projectId.trim() ? query.projectId.trim() : undefined;
    return { usage: service.getOverview(db, { range, projectId }) };
  });
}
