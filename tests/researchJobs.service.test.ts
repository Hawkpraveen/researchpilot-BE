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
import { createResearchJobSchema, updateResearchJobSchema } from "../src/services/research-jobs/researchJobs.validation.js";

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
      return record && !record.deletedAt ? structuredClone(record) : null;
    },
    async findByIdForScope(id, scope) {
      const record = records.get(id);
      return record && !record.deletedAt && record.ownerId === scope.ownerId && record.tenantId === scope.tenantId
        && record.workspaceId === scope.workspaceId ? structuredClone(record) : null;
    },
    async listForScope(scope, limit) {
      return [...records.values()].filter((record) => !record.deletedAt && record.ownerId === scope.ownerId
        && record.tenantId === scope.tenantId && record.workspaceId === scope.workspaceId)
        .slice(0, limit).map((record) => structuredClone(record));
    },
    async findByStatus(status: ResearchStatus) {
      return [...records.values()].filter((record) => !record.deletedAt && record.status === status).map((record) => structuredClone(record));
    },
    async update(id, update, allowedStatuses) {
      const current = records.get(id);
      if (!current || current.deletedAt || (allowedStatuses && !allowedStatuses.includes(current.status))) return null;
      const next = { ...current, ...structuredClone(update), version: current.version + 1, updatedAt: new Date() };
      records.set(id, next);
      return structuredClone(next);
    },
    async updateForScope(id, scope, update, allowedStatuses) {
      const record = records.get(id);
      if (!record || record.deletedAt || record.ownerId !== scope.ownerId || record.tenantId !== scope.tenantId
        || record.workspaceId !== scope.workspaceId || (allowedStatuses && !allowedStatuses.includes(record.status))) return null;
      const updated = { ...record, ...update, updatedAt: new Date(), version: record.version + 1 };
      records.set(id, updated);
      return structuredClone(updated);
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

test("report rename and deletion validate input, preserve evidence and enforce all scope boundaries", async () => {
  const jobs = createMemoryJobsRepository();
  const reports = createMemoryReportsRepository();
  const queue: Array<() => Promise<void>> = [];
  const service = createResearchJobsService({ jobs, reports, events: createMemoryEventsRepository(), agent: createAgentMock(), schedule: (work) => queue.push(work) });
  const { jobId } = await service.create(createResearchJobSchema.parse(validRequest), ownerId);
  await assert.rejects(service.remove(jobId, ownerId), { code: "JOB_ALREADY_ACTIVE" });
  await queue.shift()!();
  const original = await service.get(jobId, ownerId);
  for (const scope of [{ ...ownerId, tenantId: "other" }, { ...ownerId, workspaceId: "other" }, { ...ownerId, ownerId: "other" }]) {
    await assert.rejects(service.rename(jobId, "Unauthorized", scope), { code: "JOB_NOT_FOUND" });
    await assert.rejects(service.remove(jobId, scope), { code: "JOB_NOT_FOUND" });
  }
  for (const title of [" ", "x".repeat(201)]) {
    assert.equal(updateResearchJobSchema.safeParse({ title }).success, false);
    await assert.rejects(service.rename(jobId, title, ownerId), { code: "INVALID_TITLE" });
  }
  assert.equal(updateResearchJobSchema.safeParse({ title: "Valid", ownerId: "other" }).success, false);
  const renamed = await service.rename(jobId, "  Shortlist review  ", ownerId);
  assert.equal(renamed.title, "Shortlist review");
  assert.equal(renamed.question, original.question);
  assert.deepEqual(renamed.report, original.report);
  assert.equal((await service.list(ownerId))[0].title, "Shortlist review");
  assert.ok(Number.isFinite(Date.parse(renamed.updatedAtIso!)));
  await service.remove(jobId, ownerId);
  assert.equal((await service.list(ownerId)).length, 0);
  assert.ok(jobs.records.get(jobId)?.deletedAt);
  assert.ok(reports.records.has(jobId));
  await assert.rejects(service.get(jobId, ownerId), { code: "JOB_NOT_FOUND" });
  await assert.rejects(service.getReport(jobId, ownerId), { code: "JOB_NOT_FOUND" });
  await assert.rejects(service.eventsAfter(jobId, 0, ownerId), { code: "JOB_NOT_FOUND" });
  await assert.rejects(service.getUsage(jobId, ownerId), { code: "JOB_NOT_FOUND" });
  await assert.rejects(service.retry(jobId, ownerId), { code: "JOB_NOT_FOUND" });
  await assert.rejects(service.rename(jobId, "Resurrect", ownerId), { code: "JOB_NOT_FOUND" });
});

test("deletion cannot archive a report that was concurrently restarted", async () => {
  const jobs = createMemoryJobsRepository();
  const queue: Array<() => Promise<void>> = [];
  const service = createResearchJobsService({ jobs, reports: createMemoryReportsRepository(), events: createMemoryEventsRepository(), agent: createAgentMock(), schedule: (work) => queue.push(work) });
  const { jobId } = await service.create(createResearchJobSchema.parse(validRequest), ownerId);
  await queue.shift()!();
  const updateForScope = jobs.updateForScope;
  jobs.updateForScope = async (id, scope, update, allowedStatuses) => {
    if (update.deletedAt) await jobs.update(id, { status: "queued" });
    return updateForScope(id, scope, update, allowedStatuses);
  };
  await assert.rejects(service.remove(jobId, ownerId), { code: "JOB_CHANGED" });
  assert.equal((await service.get(jobId, ownerId)).status, "queued");
  assert.equal(jobs.records.get(jobId)?.deletedAt, undefined);
});

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

test("persists clarification and partial outcomes without displaying them as completed research", async () => {
  for (const status of ["needs_clarification", "partial"] as const) {
    const jobs = createMemoryJobsRepository();
    const reports = createMemoryReportsRepository();
    const queue: Array<() => Promise<void>> = [];
    const agent = createAgentMock();
    const service = createResearchJobsService({ jobs, reports, events: createMemoryEventsRepository(),
      agent: { ...agent, async runResearch(job) { return { ...await agent.runResearch(job), researchStatus: status,
        resolution: { status: status === "needs_clarification" ? "unresolved" : "resolved", subject: "Subject", explanation: "Discovery evidence", candidates: [], selectedSourceIds: status === "partial" ? ["S1"] : [] } }; } },
      schedule: (work) => queue.push(work) });
    const created = await service.create(createResearchJobSchema.parse(validRequest), ownerId);
    await queue[0]();
    const view = await service.get(created.jobId, ownerId);
    assert.equal(view.status, status);
    assert.equal(view.report?.researchStatus, status);
    assert.equal(view.report?.resolution?.explanation, "Discovery evidence");
    assert.deepEqual(view.request?.criteria, validRequest.criteria);
    assert.equal((await service.list(ownerId))[0].status, status);
    assert.equal((await service.getReport(created.jobId, ownerId)).researchStatus, status);
  }
});

test("retry reuses the record, hides the old report while running, and preserves event history", async () => {
  const jobs = createMemoryJobsRepository();
  const events = createMemoryEventsRepository();
  const reports = createMemoryReportsRepository();
  const queue: Array<() => Promise<void>> = [];
  const service = createResearchJobsService({ jobs, events, reports, agent: createAgentMock(), schedule: (work) => queue.push(work) });
  const created = await service.create(createResearchJobSchema.parse(validRequest), ownerId);
  await queue.shift()!();
  const before = await jobs.findById(created.jobId);
  const count = events.records.length;
  await assert.rejects(service.retry(created.jobId, { ...ownerId, workspaceId: "other" }), { code: "JOB_NOT_FOUND" });
  const retried = await service.retry(created.jobId, ownerId);
  assert.equal(retried.jobId, created.jobId);
  assert.equal(jobs.records.size, 1);
  const pending = await service.get(created.jobId, ownerId);
  assert.equal(pending.status, "queued");
  assert.equal(pending.report, undefined);
  await assert.rejects(service.retry(created.jobId, ownerId), { code: "JOB_ALREADY_ACTIVE" });
  await queue.shift()!();
  assert.equal((await service.get(created.jobId, ownerId)).status, "completed");
  assert.deepEqual((await jobs.findById(created.jobId))?.createdAt, before?.createdAt);
  assert.equal(jobs.records.size, 1);
  assert.ok(events.records.length > count);
  assert.equal(reports.records.size, 1);
});

test("clarification resumes the existing job from its saved discovery and plan", async () => {
  const jobs = createMemoryJobsRepository();
  const reports = createMemoryReportsRepository();
  const queue: Array<() => Promise<void>> = [];
  const planCalls: ResearchJobRecord[] = [];
  const agent = createAgentMock(planCalls);
  const researchCalls: ResearchJobRecord[] = [];
  const service = createResearchJobsService({ jobs, reports, events: createMemoryEventsRepository(), schedule: (work) => queue.push(work),
    agent: { ...agent, async runResearch(job) {
      researchCalls.push(structuredClone(job));
      const report = await agent.runResearch(job);
      return job.resume ? report : { ...report, researchStatus: "needs_clarification", resolution: { status: "ambiguous", subject: "", explanation: "Two possible subjects", selectedSourceIds: [],
        candidates: [{ label: "Software company", description: "The business", sourceIds: ["S1"] }, { label: "Clinical score", description: "The concept", sourceIds: ["S1"] }] } };
    } } });
  const created = await service.create(createResearchJobSchema.parse(validRequest), ownerId);
  await queue.shift()!();
  await assert.rejects(service.retry(created.jobId, ownerId, { candidateIndex: 3 }), { code: "INVALID_SUBJECT_CHOICE" });
  await service.retry(created.jobId, ownerId, { candidateIndex: 0 });
  await queue.shift()!();
  assert.equal(jobs.records.size, 1);
  assert.equal(planCalls.length, 1);
  assert.equal(researchCalls[1].resume?.subject, "Software company");
  assert.equal(researchCalls[1].resume?.sources[0].id, "S1");
  assert.deepEqual(researchCalls[1].request, researchCalls[0].request);
  assert.equal((await service.get(created.jobId, ownerId)).status, "completed");
});

test("usage reads enforce ownership and label missing attempt counters as unknown", async () => {
  const jobs = createMemoryJobsRepository();
  const queue: Array<() => Promise<void>> = [];
  let reads = 0;
  const service = createResearchJobsService({ jobs, reports: createMemoryReportsRepository(), events: createMemoryEventsRepository(), agent: createAgentMock(),
    schedule: (work) => queue.push(work), usage: { async list() { reads++; return [{ executionId: "attempt-1", status: "failed", calls: [] }]; } } });
  const created = await service.create(createResearchJobSchema.parse(validRequest), ownerId);
  await assert.rejects(service.getUsage(created.jobId, { ...ownerId, ownerId: "other" }), { code: "JOB_NOT_FOUND" });
  assert.equal(reads, 0);
  const usage = await service.getUsage(created.jobId, ownerId);
  assert.equal(usage.totals.attemptsWithUnknownUsage, 1);
  assert.equal(usage.totals.countersComplete, false);
  assert.equal(usage.costUsd, null);
});
