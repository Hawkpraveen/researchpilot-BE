import { Router } from "express";
import type { ResearchJobsService } from "../../services/research-jobs/researchJobs.service.js";
import { requireAuth } from "../../middleware/requireAuth.js";
import { createUserRateLimiter } from "../../middleware/rateLimiter.js";
import { asyncHandler } from "../../utils/asyncHandler.js";
import { createResearchJobsController } from "./researchJobs.controller.js";

export function createResearchJobsRouter(service: ResearchJobsService) {
  const router = Router();
  const controller = createResearchJobsController(service);

  router.use(requireAuth);
  router.get("/", asyncHandler(controller.list));
  router.post("/", createUserRateLimiter("researchCreate"), asyncHandler(controller.create));
  router.get("/:jobId/events", asyncHandler(controller.streamEvents));
  router.get("/:jobId/report", asyncHandler(controller.getReport));
  router.post("/:jobId/cancel", asyncHandler(controller.cancel));
  router.get("/:jobId", asyncHandler(controller.get));

  return router;
}
