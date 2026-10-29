import { Router } from "express";
import { z } from "zod";
import { getAuthenticatedUser, readBearerToken, hashToken } from "../../helpers/auth/auth.helpers.js";
import { requireAuth } from "../../middleware/requireAuth.js";
import { createRateLimiter, createUserRateLimiter } from "../../middleware/rateLimiter.js";
import { rateLimiterRegistry } from "../../config/rateLimiterRegistry.js";
import { asyncHandler } from "../../utils/asyncHandler.js";
import { connectorService } from "../../services/connectors/connector.service.js";
import { createAppError } from "../../utils/AppError.js";

export function createConnectorRouter() {
  const router = Router();
  router.use((_request, response, next) => { response.setHeader("Cache-Control", "no-store"); next(); });
  router.use("/runtime", createRateLimiter({ ...rateLimiterRegistry.connectorRuntime, key: request => hashToken(readBearerToken(request)) }));
  router.post("/pair", createRateLimiter(rateLimiterRegistry.auth), asyncHandler(async (request, response) => {
    const input = z.object({ code: z.string().min(30).max(100), name: z.string().trim().min(1).max(80) }).strict().parse(request.body);
    response.json(await connectorService.pair(input.code, input.name));
  }));
  router.post("/runtime/poll", asyncHandler(async (request, response) => {
    const { models } = z.object({ models: z.array(z.string().min(1).max(150)).max(200) }).strict().parse(request.body);
    response.json(await connectorService.poll(readBearerToken(request), models));
  }));
  router.post("/runtime/results", asyncHandler(async (request, response) => {
    const input = z.object({ taskId: z.string().uuid(), result: z.record(z.unknown()).default({}), error: z.string().max(200).optional() }).strict().parse(request.body);
    await connectorService.complete(readBearerToken(request), input.taskId, input.result, input.error);
    response.status(204).end();
  }));
  router.post("/relay/api/chat", asyncHandler(async (request, response) => {
    if (!["127.0.0.1", "::1", "::ffff:127.0.0.1"].includes(request.socket.remoteAddress ?? "")) {
      throw createAppError(403, "CONNECTOR_INTERNAL_ONLY", "This endpoint is internal.");
    }
    const payload = z.object({ model: z.string().min(1), messages: z.array(z.unknown()), stream: z.literal(false), format: z.union([z.string(), z.record(z.unknown())]), options: z.record(z.unknown()) }).strict().parse(request.body);
    response.json(await connectorService.relay(readBearerToken(request), payload));
  }));
  router.use(requireAuth);
  const scope = (response: Parameters<typeof getAuthenticatedUser>[0]) => {
    const user = getAuthenticatedUser(response);
    return { tenantId: String(user.tenant_id), workspaceId: String(user.workspace_id), userId: String(user.id) };
  };
  router.get("/status", asyncHandler(async (_request, response) => { response.json(await connectorService.status(scope(response))); }));
  router.post("/pairings", createUserRateLimiter("connectorPair"), asyncHandler(async (_request, response) => { response.json(await connectorService.createPairing(scope(response))); }));
  router.delete("/connection", asyncHandler(async (_request, response) => { await connectorService.revoke(scope(response)); response.status(204).end(); }));
  return router;
}
