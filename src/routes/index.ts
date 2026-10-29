import { Router } from "express";
import { createConnectorRouter } from "../controllers/connectors/index.js";
import { createAuthRouter } from "../controllers/auth/index.js";
import { createHealthRouter } from "../controllers/health/index.js";
import { createResearchJobsRouter } from "../controllers/research-jobs/index.js";
import { createSettingsRouter } from "../controllers/settings/index.js";
import type { ResearchJobsService } from "../services/research-jobs/researchJobs.service.js";

export interface ApiRouteDependencies {
  researchJobsService: ResearchJobsService;
}

export function createApiRoutes({ researchJobsService }: ApiRouteDependencies) {
  const routes = Router();
  routes.use("/connectors", createConnectorRouter());

  routes.use("/health", createHealthRouter());
  routes.use("/auth", createAuthRouter());
  routes.use("/research-jobs", createResearchJobsRouter(researchJobsService));
  routes.use("/settings", createSettingsRouter());

  return routes;
}
