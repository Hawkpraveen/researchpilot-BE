import assert from "node:assert/strict";
import test from "node:test";
import type { ResearchEventRecord } from "../src/models/research-events/researchEvent.model.js";
import type {
  ResearchJobRecord,
  ResearchReportView,
  ResearchStatus,
} from "../src/models/research-jobs/researchJob.types.js";
import type { ResearchAgent } from "../src/services/research-agent/researchAgent.client.js";
import { createAppError } from "../src/utils/AppError.js";
import type {
  ResearchJobsRepository,
} from "../src/repositories/research-jobs/researchJobs.repository.js";
import type {
  ResearchEventsRepository,
} from "../src/repositories/research-events/researchEvents.repository.js";
import type {
  ResearchReportsRepository,
} from "../src/repositories/research-reports/researchReports.repository.js";
import { createResearchJobsService } from "../src/services/research-jobs/researchJobs.service.js";
import { createResearchJobSchema } from "../src/services/research-jobs/researchJobs.validation.js";

function createMemoryJobsRepository(): ResearchJobsRepository & { records: Map<string, ResearchJobRecord> } {
  const records = new Map<string, ResearchJobRecord>();
  return {
    records,
    async create(record) {
      records.set(record._id, structuredClone(record));
      return structuredClone(record);
    },
    async findById(id) {
      const record = records.get(id);
      return record ? structuredClone(record) : null;
    },
    async findByIdForScope(id, scope) {
      const record = records.get(id);
      return record && record.ownerId === scope.ownerId && record.tenantId === scope.tenantId
        && record.workspaceId === scope.workspaceId ? structuredClone(record) : null;
    },
    async listForScope(scope, limit) {
      return [...records.values()].filter((record) => record.ownerId === scope.ownerId
        && record.tenantId === scope.tenantId && record.workspaceId === scope.workspaceId)
        .slice(0, limit).map((record) => structuredClone(record));
    },
    async findByStatus(status: ResearchStatus) {
      return [...records.values()].filter((record) => record.status === status).map((record) => structuredClone(record));
    },
    async update(id, update, allowedStatuses) {
      const current = records.get(id);
      if (!current || (allowedStatuses && !allowedStatuses.includes(current.status))) return null;
      const next = { ...current, ...structuredClone(update), version: current.version + 1, updatedAt: new Date() };
      records.set(id, next);
      return structuredClone(next);
    },
  };
}

function createMemoryEventsRepository(): ResearchEventsRepository & { records: ResearchEventRecord[] } {
  const records: ResearchEventRecord[] = [];
  return {
    records,
    async append(jobId, stage, eventType, message) {
      const event: ResearchEventRecord = {
        jobId,
        sequence: records.filter((item) => item.jobId === jobId).length + 1,
        stage,
        eventType,
        message,
        createdAt: new Date(),
      };
      records.push(event);
      return event;
    },
    async listAfter(jobId, sequence) {
      return records.filter((item) => item.jobId === jobId && item.sequence > sequence);
    },
  };
}

function createMemoryReportsRepository(): ResearchReportsRepository & { records: Map<string, ResearchReportView> } {
  const records = new Map<string, ResearchReportView>();
  return {
    records,
    async save(jobId, report) {
      records.set(jobId, structuredClone(report));
    },
    async findByJobId(jobId) {
      const record = records.get(jobId);
      return record ? { ...structuredClone(record), jobId, schemaVersion: "1.0", createdAt: new Date() } : null;
    },
  };
}

const validRequest = {
  goal: "Compare two project management tools for a small team",
  alternatives: ["Tool A", "Tool B"],
  criteria: [{ id: "pricing", label: "Pricing", weight: 5 }],
  constraints: ["Use public information"],
  depth: "standard",
};
const ownerId = { tenantId: "test-tenant", workspaceId: "test-workspace", ownerId: "test-user" };

function createAgentMock(calls: ResearchJobRecord[] = []): ResearchAgent {
  return {
    async runResearch() {
      return {
        researchStatus: "completed", summary: "Findings from a retrieved source. [S1]",
        recommendation: "Review the cited evidence. [S1]", alternatives: [], comparison: [],
        sources: [{ id: "S1", title: "Source", domain: "example.com", url: "https://example.com/", accessedAt: new Date().toISOString(), snippet: "A retrieved source excerpt.", reliability: "low" }],
        uncertainties: ["Independent verification remains necessary."],
      };
    },
    async createPlan(job) {
      calls.push(structuredClone(job));
      return {
        jobId: job._id,
        contractVersion: "1.0",
        status: "planned",
        researchExecuted: false,
        budget: job.limits,
        tasks: [{
          id: "criterion-pricing",
          criterionId: "pricing",
          question: "What pricing evidence is available?",
          searchQueries: ["Tool A pricing", "Tool B pricing"],
        }],
        omittedCriterionIds: [],
        constraints: job.request.constraints,
        notice: "Plan only. No web research was run.",
      };
    },
  };
}

test("request validation rejects unknown properties and duplicate criteria", () => {
  assert.equal(createResearchJobSchema.safeParse(validRequest).success, true);
  assert.equal(createResearchJobSchema.safeParse({ ...validRequest, provider: "paid-cloud" }).success, false);
  assert.equal(
    createResearchJobSchema.safeParse({
      ...validRequest,
      criteria: [validRequest.criteria[0], validRequest.criteria[0]],
    }).success,
    false,
  );
  assert.equal(
    createResearchJobSchema.safeParse({
      ...validRequest,
      criteria: [{ ...validRequest.criteria[0], weight: 6 }],
    }).success,
    false,
  );
});

test("job is persisted before scheduling and completes with the real agent report", async () => {
  const jobs = createMemoryJobsRepository();
  const events = createMemoryEventsRepository();
  const reports = createMemoryReportsRepository();
  const queued: Array<() => Promise<void>> = [];
  const agentCalls: ResearchJobRecord[] = [];
  const service = createResearchJobsService({
    jobs,
    events,
    reports,
    agent: createAgentMock(agentCalls),
    schedule: (work) => queued.push(work),
    pause: async () => undefined,
  });

  const created = await service.create(createResearchJobSchema.parse(validRequest), ownerId);
  const initiallyStored = await jobs.findById(created.jobId);
  assert.equal(initiallyStored?.status, "queued");
  assert.equal(queued.length, 1);

  await queued[0]();

  const job = await service.get(created.jobId, ownerId);
  assert.equal(job.status, "completed");
  assert.equal(job.currentStage, "Research complete");
  assert.equal(job.progress, 100);
  assert.equal(job.sourceCount, 1);
  assert.equal(agentCalls.length, 1);
  assert.equal(agentCalls[0]._id, created.jobId);
  assert.equal((await jobs.findById(created.jobId))?.agentPlan?.tasks.length, 1);
  assert.match(job.report?.summary ?? "", /Findings from a retrieved source/);
  assert.equal(job.report?.sources[0].id, "S1");
  const [listed] = await service.list(ownerId);
  assert.deepEqual(Object.keys(listed.report ?? {}).sort(), [
    "alternatives",
    "comparison",
    "recommendation",
    "researchStatus",
    "sources",
    "summary",
    "uncertainties",
  ]);
  assert.equal(job.report?.researchStatus, "completed");
  assert.deepEqual((await service.eventsAfter(created.jobId, 0, ownerId)).map((event) => event.sequence), [1, 2, 3, 4, 5, 6]);
  await assert.rejects(service.get(created.jobId, { ...ownerId, ownerId: "another-user" }), { code: "JOB_NOT_FOUND" });
  await assert.rejects(service.get(created.jobId, { ...ownerId, workspaceId: "another-workspace" }), { code: "JOB_NOT_FOUND" });
  await assert.rejects(service.get(created.jobId, { ...ownerId, tenantId: "another-tenant" }), { code: "JOB_NOT_FOUND" });
});

test("cancelled jobs do not execute queued research", async () => {
  const jobs = createMemoryJobsRepository();
  const events = createMemoryEventsRepository();
  const reports = createMemoryReportsRepository();
  const queued: Array<() => Promise<void>> = [];
  const service = createResearchJobsService({
    jobs,
    events,
    reports,
    agent: createAgentMock(),
    schedule: (work) => queued.push(work),
    pause: async () => undefined,
  });

  const created = await service.create(createResearchJobSchema.parse(validRequest), ownerId);
  await service.cancel(created.jobId, ownerId);
  await queued[0]();

  assert.equal((await service.get(created.jobId, ownerId)).status, "failed");
  assert.equal(await reports.findByJobId(created.jobId), null);
});

test("reports are unavailable until the job reaches a terminal completed state", async () => {
  const jobs = createMemoryJobsRepository();
  const events = createMemoryEventsRepository();
  const reports = createMemoryReportsRepository();
  const queued: Array<() => Promise<void>> = [];
  const service = createResearchJobsService({
    jobs,
    events,
    reports,
    agent: createAgentMock(),
    schedule: (work) => queued.push(work),
    pause: async () => undefined,
  });

  const created = await service.create(createResearchJobSchema.parse(validRequest), ownerId);
  await assert.rejects(service.getReport(created.jobId, ownerId), { code: "REPORT_NOT_READY" });
});

test("Agent failures are persisted as safe job error details", async () => {
  const jobs = createMemoryJobsRepository();
  const events = createMemoryEventsRepository();
  const reports = createMemoryReportsRepository();
  const queued: Array<() => Promise<void>> = [];
  const service = createResearchJobsService({
    jobs,
    events,
    reports,
    agent: {
      ...createAgentMock(),
      async createPlan() {
        throw createAppError(503, "AGENT_UNAVAILABLE", "The research agent is unavailable.", true);
      },
    },
    schedule: (work) => queued.push(work),
    pause: async () => undefined,
  });

  const created = await service.create(createResearchJobSchema.parse(validRequest), ownerId);
  await queued[0]();

  const stored = await jobs.findById(created.jobId);
  const view = await service.get(created.jobId, ownerId);
  assert.equal(stored?.status, "failed");
  assert.deepEqual(stored?.error, {
    code: "AGENT_UNAVAILABLE",
    message: "The research agent is unavailable.",
    retryable: true,
  });
  assert.deepEqual(view.error, stored?.error);
});

test("research execution errors fail the job without saving a placeholder", async () => {
  const jobs = createMemoryJobsRepository();
  const reports = createMemoryReportsRepository();
  const queued: Array<() => Promise<void>> = [];
  const service = createResearchJobsService({ jobs, reports, events: createMemoryEventsRepository(),
    agent: { ...createAgentMock(), async runResearch() {
      throw createAppError(503, "SEARCH_NOT_CONFIGURED", "Set TAVILY_API_KEY in the agent environment.");
    } }, schedule: (work) => queued.push(work) });
  const created = await service.create(createResearchJobSchema.parse(validRequest), ownerId);
  await queued[0]();
  assert.equal((await jobs.findById(created.jobId))?.status, "failed");
  assert.equal((await jobs.findById(created.jobId))?.error?.code, "SEARCH_NOT_CONFIGURED");
  assert.equal(await reports.findByJobId(created.jobId), null);
});

test("cancellation during research discards the eventual provider result", async () => {
  const jobs = createMemoryJobsRepository();
  const reports = createMemoryReportsRepository();
  const queued: Array<() => Promise<void>> = [];
  const agent = createAgentMock();
  const service = createResearchJobsService({ jobs, reports, events: createMemoryEventsRepository(),
    agent: { ...agent, async runResearch(job) {
      await service.cancel(job._id, ownerId);
      return agent.runResearch(job);
    } }, schedule: (work) => queued.push(work) });
  const created = await service.create(createResearchJobSchema.parse(validRequest), ownerId);
  await queued[0]();
  assert.equal((await jobs.findById(created.jobId))?.status, "cancelled");
  assert.equal(await reports.findByJobId(created.jobId), null);
});
