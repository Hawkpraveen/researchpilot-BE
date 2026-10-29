import { loadEnvironment } from "./config/env.js";
import { connectorService, CONNECTOR_ENDPOINT } from "./services/connectors/connector.service.js";
import { createAppError } from "./utils/AppError.js";
import { createMongoResearchEventsRepository } from "./repositories/research-events/researchEvents.repository.js";
import { createMongoResearchJobsRepository } from "./repositories/research-jobs/researchJobs.repository.js";
import { createMongoResearchReportsRepository } from "./repositories/research-reports/researchReports.repository.js";
import { createResearchAgentClient } from "./services/research-agent/researchAgent.client.js";
import { createResearchJobsService } from "./services/research-jobs/researchJobs.service.js";
import { providerSettingsRepository } from "./repositories/settings/providerSettings.repository.js";
import { defaultProviderSettings } from "./config/providerSettings.js";
import { researchUsageRepository } from "./repositories/research-usage/researchUsage.repository.js";

const environment = loadEnvironment();
const jobs = createMongoResearchJobsRepository();
const events = createMongoResearchEventsRepository();
const reports = createMongoResearchReportsRepository();
const agent = createResearchAgentClient(environment.AGENT_BASE_URL, environment.AGENT_TIMEOUT_MS, fetch, async (job) => {
  const config = await providerSettingsRepository.find({ tenant_id: job.tenantId, workspace_id: job.workspaceId });
  if (config?.provider === "ollama" && config.endpoint === CONNECTOR_ENDPOINT) {
    if (!job.ownerId) throw createAppError(400, "CONNECTOR_OWNER_REQUIRED", "Sign in to use your computer's model.");
    const token = connectorService.mintRelay({ tenantId: job.tenantId, workspaceId: job.workspaceId, userId: job.ownerId }, config.model);
    return { mode: "local", provider: "ollama", endpoint: `http://127.0.0.1:${environment.PORT}/api/v1/connectors/relay`, model: config.model, apiKey: token };
  }
  // Credentials are sent only to the private agent, never stored on jobs or returned to browsers.
  return config ? {
    mode: config.mode, provider: config.provider, endpoint: config.endpoint, model: config.model, apiKey: config.api_key ?? "",
  } : { ...defaultProviderSettings };
}, researchUsageRepository.save);

export const researchJobsService = createResearchJobsService({ jobs, events, reports, agent, usage: researchUsageRepository });
