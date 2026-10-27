import { Router } from "express";
import { createAuthRouter } from "../controllers/auth/index.js";
import { createHealthRouter } from "../controllers/health/index.js";
import { createResearchJobsRouter } from "../controllers/research-jobs/index.js";
import type { ResearchJobsService } from "../services/research-jobs/researchJobs.service.js";

export interface ApiRouteDependencies {
  researchJobsService: ResearchJobsService;
  allowDemoAuth?: boolean;
}

export function createApiRoutes({
  researchJobsService,
  allowDemoAuth = false,
}: ApiRouteDependencies) {
  const routes = Router();

  routes.use("/health", createHealthRouter());
  routes.use("/auth", createAuthRouter(allowDemoAuth));
  routes.use("/research-jobs", createResearchJobsRouter(researchJobsService));

  return routes;
}
