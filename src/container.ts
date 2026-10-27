import { loadEnvironment } from "./config/env.js";
import { createMongoResearchEventsRepository } from "./repositories/research-events/researchEvents.repository.js";
import { createMongoResearchJobsRepository } from "./repositories/research-jobs/researchJobs.repository.js";
import { createMongoResearchReportsRepository } from "./repositories/research-reports/researchReports.repository.js";
import { createResearchAgentClient } from "./services/research-agent/researchAgent.client.js";
import { createResearchJobsService } from "./services/research-jobs/researchJobs.service.js";

const environment = loadEnvironment();
const jobs = createMongoResearchJobsRepository();
const events = createMongoResearchEventsRepository();
const reports = createMongoResearchReportsRepository();
const agent = createResearchAgentClient(environment.AGENT_BASE_URL, environment.AGENT_TIMEOUT_MS);

export const researchJobsService = createResearchJobsService({ jobs, events, reports, agent });
