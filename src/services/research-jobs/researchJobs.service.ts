import { randomUUID } from "node:crypto";
import type { ResearchEventRecord } from "../../models/research-events/researchEvent.model.js";
import type {
  ResearchJobRecord,
  ResearchJobView,
  ResearchReportView,
  ResearchStatus,
} from "../../models/research-jobs/researchJob.types.js";
import type { ResearchJobsRepository } from "../../repositories/research-jobs/researchJobs.repository.js";
import type { ResearchEventsRepository } from "../../repositories/research-events/researchEvents.repository.js";
import type { ResearchReportsRepository } from "../../repositories/research-reports/researchReports.repository.js";
import { createAppError, isAppError } from "../../utils/AppError.js";
import type { ResearchAgent } from "../research-agent/researchAgent.client.js";
import type { CreateResearchJobInput, ClarifyResearchInput } from "./researchJobs.validation.js";
import { usageSchema, summarizeUsage } from "./researchUsage.js";

const activeStatuses: ResearchStatus[] = ["queued", "planning", "researching", "verifying", "analyzing", "quality_check"];
const terminalStatuses: ResearchStatus[] = ["completed", "failed", "cancelled"];

export interface ResearchJobsServiceDependencies {
  jobs: ResearchJobsRepository;
  events: ResearchEventsRepository;
  reports: ResearchReportsRepository;
  agent: ResearchAgent;
  usage?: { list(jobId: string, scope: ResearchScope): Promise<unknown[]> };
  schedule?: (work: () => Promise<void>) => void;
  pause?: (milliseconds: number) => Promise<void>;
}

export type ResearchJobsService = ReturnType<typeof createResearchJobsService>;
export interface ResearchScope { tenantId: string; workspaceId: string; ownerId: string }

export function createResearchJobsService(dependencies: ResearchJobsServiceDependencies) {
  const schedule = dependencies.schedule ?? ((work: () => Promise<void>) => setTimeout(() => void work(), 0));
  const executing = new Set<string>();

  async function execute(id: string) {
    if (executing.has(id)) return;
    executing.add(id);
    try { await runWorkflow(id); }
    catch (error) {
      console.error("[research] Workflow failed", { jobId: id, error });
      await markFailed(id, error);
    } finally { executing.delete(id); }
  }

  async function recordEvent(...args: Parameters<ResearchEventsRepository["append"]>) {
    const [jobId, stage, , message] = args;
    const status = stage === "planning" && message.startsWith("Preparing") ? "started" : activeStatuses.includes(stage as ResearchStatus) && stage !== "queued" ? "in_progress" : stage;
    console.info(`[research] ${JSON.stringify({ timestamp: new Date().toISOString(), jobId, status, stage, message })}`);
    return dependencies.events.append(...args);
  }

  async function create(input: CreateResearchJobInput, scope: ResearchScope) {
    const now = new Date();
    const record: ResearchJobRecord = {
      _id: `job_${randomUUID()}`,
      ...scope,
      request: input,
      status: "queued",
      currentStage: "Queued",
      progress: { completedUnits: 0, totalUnits: 5, message: "Research job queued." },
      limits: limitsForDepth(input.depth),
      contractVersion: "1.0",
      startedAt: null,
      finishedAt: null,
      error: null,
      version: 0,
      createdAt: now,
      updatedAt: now,
    };

    const saved = await dependencies.jobs.create(record);
    await recordEvent(saved._id, "queued", "status", "Research job queued.");
    schedule(() => execute(saved._id));

    return {
      jobId: saved._id,
      status: "queued" as const,
      statusUrl: `/api/v1/research-jobs/${encodeURIComponent(saved._id)}`,
      eventsUrl: `/api/v1/research-jobs/${encodeURIComponent(saved._id)}/events`,
    };
  }

  async function retry(id: string, scope: ResearchScope, clarification?: ClarifyResearchInput) {
    const job = await requireJob(id, scope);
    if (!terminalStatuses.includes(job.status) || executing.has(id)) {
      throw createAppError(409, "JOB_ALREADY_ACTIVE", "This research is already running or still stopping.");
    }
    let resume = job.resume ?? null;
    if (clarification) {
      const report = await dependencies.reports.findByJobId(id);
      if (report?.researchStatus !== "needs_clarification") throw createAppError(409, "CLARIFICATION_NOT_NEEDED", "This research is not waiting for clarification.");
      const candidate = clarification.candidateIndex === undefined ? undefined : report.resolution?.candidates[clarification.candidateIndex];
      if (clarification.candidateIndex !== undefined && !candidate) throw createAppError(422, "INVALID_SUBJECT_CHOICE", "Choose one of the available subjects.");
      resume = { subject: candidate?.label ?? "", context: clarification.context ?? candidate?.description ?? "",
        consumedPages: Math.min(5, job.limits.maxPages),
        sources: candidate ? report.sources.filter((source) => candidate.sourceIds.includes(source.id)) : report.sources };
    }
    const updated = await dependencies.jobs.update(id, {
      status: "queued", currentStage: resume ? "Continuing research" : "Queued",
      progress: { completedUnits: resume ? 1 : 0, totalUnits: 5, message: resume ? "Continuing from saved subject discovery." : "Research queued again." },
      startedAt: null, finishedAt: null, error: null, resume,
    }, [job.status]);
    if (!updated) throw createAppError(409, "JOB_ALREADY_ACTIVE", "This research has already been restarted.");
    await recordEvent(id, "queued", "status", clarification ? "Clarification received; continuing from saved discovery." : "Research restarted using the existing record.");
    schedule(() => execute(id));
    return { jobId: id, status: "queued" as const };
  }

  async function list(scope: ResearchScope): Promise<ResearchJobView[]> {
    const jobs = await dependencies.jobs.listForScope(scope, 50);
    const reports = await Promise.all(jobs.map((job) => dependencies.reports.findByJobId(job._id)));
    return jobs.map((job, index) => toJobView(job, reports[index] ? toReportView(reports[index]) : undefined));
  }

  async function get(id: string, scope: ResearchScope): Promise<ResearchJobView> {
    const job = await requireJob(id, scope);
    const report = await dependencies.reports.findByJobId(id);
    return toJobView(job, report ? toReportView(report) : undefined);
  }

  async function getReport(id: string, scope: ResearchScope): Promise<ResearchReportView> {
    const job = await requireJob(id, scope);
    if (job.status !== "completed") {
      throw createAppError(409, "REPORT_NOT_READY", "The report is not ready yet.", true);
    }
    const report = await dependencies.reports.findByJobId(id);
    if (!report) throw createAppError(409, "REPORT_NOT_READY", "The report is not ready yet.", true);
    return {
      researchStatus: report.researchStatus ?? "not_run",
      summary: report.summary,
      recommendation: report.recommendation,
      alternatives: report.alternatives,
      comparison: report.comparison,
      sources: report.sources,
      uncertainties: report.uncertainties,
      ...(report.resolution ? { resolution: report.resolution } : {}),
    };
  }

  async function rename(id: string, title: string, scope: ResearchScope) {
    await requireJob(id, scope);
    const normalized = title.trim();
    if (!normalized || normalized.length > 200) throw createAppError(422, "INVALID_TITLE", "Enter a report title between 1 and 200 characters.");
    const updated = await dependencies.jobs.updateForScope(id, scope, { title: normalized });
    if (!updated) throw createAppError(404, "JOB_NOT_FOUND", "Research job not found.");
    return get(id, scope);
  }

  async function remove(id: string, scope: ResearchScope) {
    const job = await requireJob(id, scope);
    if (!terminalStatuses.includes(job.status) || executing.has(id)) {
      throw createAppError(409, "JOB_ALREADY_ACTIVE", "Wait for this research to finish before deleting it.");
    }
    const deleted = await dependencies.jobs.updateForScope(id, scope, { deletedAt: new Date() }, terminalStatuses);
    if (!deleted) throw createAppError(409, "JOB_CHANGED", "This research has changed. Refresh the list and try again.");
  }

  async function cancel(id: string, scope: ResearchScope) {
    const job = await requireJob(id, scope);
    if (terminalStatuses.includes(job.status)) {
      throw createAppError(409, "JOB_ALREADY_FINISHED", "A finished research job cannot be cancelled.");
    }
    const updated = await dependencies.jobs.update(
      id,
      {
        status: "cancelled",
        currentStage: "Cancelled",
        finishedAt: new Date(),
        error: null,
      },
      activeStatuses,
    );
    if (!updated) throw createAppError(409, "JOB_ALREADY_FINISHED", "The research job is no longer active.");
    await recordEvent(id, "cancelled", "status", "Research job cancelled.");
    return { jobId: id, status: "cancelled" as const };
  }

  async function eventsAfter(id: string, sequence: number, scope: ResearchScope): Promise<ResearchEventRecord[]> {
    await requireJob(id, scope);
    return dependencies.events.listAfter(id, sequence, 100);
  }

  async function getUsage(id: string, scope: ResearchScope) {
    await requireJob(id, scope);
    const attempts = await dependencies.usage?.list(id, scope) ?? [];
    const calls = attempts.flatMap((attempt) => {
      const parsed = usageSchema.safeParse(attempt);
      if (parsed.success) return parsed.data.calls;
      if (typeof attempt === "object" && attempt !== null && "executionId" in attempt && "calls" in attempt) {
        const value = usageSchema.safeParse({ executionId: attempt.executionId, calls: attempt.calls });
        return value.success ? value.data.calls : [];
      }
      return [];
    });
    const missingAttempts = attempts.filter((attempt) => typeof attempt !== "object" || attempt === null || !("calls" in attempt) || !Array.isArray(attempt.calls) || attempt.calls.length === 0).length;
    const totals = summarizeUsage({ executionId: "aggregate", calls });
    return { jobId: id, attempts, totals: { ...totals, attemptsWithUnknownUsage: missingAttempts, countersComplete: totals.countersComplete && missingAttempts === 0 },
      costUsd: null, costStatus: "unknown" as const,
      note: "Reported counters only. Missing provider usage and requests without responses are unknown, not zero." };
  }

  async function recoverInterruptedJobs() {
    const runningStatuses: ResearchStatus[] = ["planning", "researching", "verifying", "analyzing", "quality_check"];
    const interrupted = (await Promise.all(runningStatuses.map((status) => dependencies.jobs.findByStatus(status)))).flat();
    for (const job of interrupted) {
      const updated = await dependencies.jobs.update(job._id, {
        status: "failed",
        currentStage: "Interrupted",
        finishedAt: new Date(),
        error: { code: "PROCESS_INTERRUPTED", message: "The API restarted before this job completed.", retryable: true },
      }, [job.status]);
      if (updated) await recordEvent(job._id, "failed", "status", "Research job interrupted by API restart.");
    }

    const queued = await dependencies.jobs.findByStatus("queued");
    for (const job of queued) schedule(() => execute(job._id));
  }

  async function runWorkflow(id: string) {
    let job = await dependencies.jobs.findById(id);
    if (!job || job.status !== "queued") return;

    const started = await dependencies.jobs.update(id, {
      status: "planning",
      currentStage: job.resume ? "Resuming saved research" : "Planning",
      progress: { completedUnits: job.resume ? 1 : 0, totalUnits: 5, message: job.resume ? "Resuming saved discovery." : "Preparing a bounded research plan." },
      startedAt: new Date(),
    }, ["queued"]);
    if (!started) return;
    await recordEvent(id, "planning", "stage", job.resume ? "Resuming saved research plan and discovery." : "Preparing a bounded research plan.");

    job = await dependencies.jobs.findById(id);
    if (!job || job.status !== "planning") return;
    const agentPlan = job.resume && job.agentPlan ? job.agentPlan : await dependencies.agent.createPlan(job);
    if (agentPlan.jobId !== id || agentPlan.contractVersion !== job.contractVersion) {
      throw createAppError(502, "AGENT_CONTRACT_MISMATCH", "The research agent returned a plan for a different job.");
    }
    const planned = await dependencies.jobs.update(id, {
      agentPlan,
      progress: { completedUnits: 1, totalUnits: 5, message: `The agent prepared ${agentPlan.tasks.length} bounded research tasks.` },
    }, ["planning"]);
    if (!planned) return;
    await recordEvent(id, "planning", "stage", `Agent prepared ${agentPlan.tasks.length} bounded research tasks.`);

    const researching = await dependencies.jobs.update(id, {
      status: "researching", currentStage: "Searching sources and generating findings",
      progress: { completedUnits: 2, totalUnits: 5, message: "Searching the web and analyzing retrieved evidence with your selected model." },
    }, ["planning"]);
    if (!researching) return;
    await recordEvent(id, "researching", "stage", "Searching the web and analyzing retrieved evidence with your selected model.");
    const waitingSince = Date.now();
    const deadlineMs = researching.limits.timeoutSeconds * 1000 + 10000;
    const heartbeat = setInterval(() => console.info(`[research] ${JSON.stringify({
      timestamp: new Date().toISOString(), jobId: id, status: "in_progress", stage: "researching",
      elapsedSeconds: Math.round((Date.now() - waitingSince) / 1000), timeoutSeconds: deadlineMs / 1000,
      message: "Waiting for the research agent to finish web search and model generation.",
    })}`), 10000);
    let deadline: ReturnType<typeof setTimeout> | undefined;
    let report: ResearchReportView;
    try {
      report = await Promise.race([
        dependencies.agent.runResearch(researching),
        new Promise<never>((_, reject) => {
          deadline = setTimeout(() => reject(createAppError(504, "RESEARCH_TIMEOUT",
            "The research agent exceeded its time budget. Check the agent logs and model connection, then try again.", true)), deadlineMs);
        }),
      ]);
    } finally {
      clearInterval(heartbeat);
      if (deadline) clearTimeout(deadline);
    }
    const checked = await dependencies.jobs.update(id, {
      status: "quality_check", currentStage: "Saving evidence-linked report",
      progress: { completedUnits: 4, totalUnits: 5, message: `Research returned ${report.sources.length} cited sources; citation and excerpt checks passed.` },
    }, ["researching"]);
    if (!checked) return;
    await recordEvent(id, "quality_check", "stage", `Citation checks passed for ${report.sources.length} sources. Saving report.`);

    job = await dependencies.jobs.findById(id);
    if (!job || job.status === "cancelled") return;
    await dependencies.reports.save(id, report);
    const completed = await dependencies.jobs.update(id, {
      status: "completed",
      currentStage: report.researchStatus === "needs_clarification" ? "Clarification needed" : report.researchStatus === "partial" ? "Limited research ready" : "Research complete",
      progress: { completedUnits: 5, totalUnits: 5, message: "Research completed with cited sources and evidence gaps." },
      finishedAt: new Date(),
    }, ["quality_check"]);
    if (completed) await recordEvent(id, "completed", "status", report.researchStatus === "needs_clarification" ? "Discovery finished; waiting for the user to clarify the subject." : report.researchStatus === "partial" ? "Research finished with limited coverage." : "Research report completed.");
  }

  async function markFailed(id: string, cause: unknown) {
    const failure = isAppError(cause)
      ? { code: cause.code, message: cause.message, retryable: cause.retryable }
      : { code: "WORKFLOW_FAILED", message: "The research workflow could not be completed.", retryable: true };
    try {
      const failed = await dependencies.jobs.update(id, {
        status: "failed",
        currentStage: "Research interrupted",
        finishedAt: new Date(),
        error: failure,
      }, activeStatuses);
      if (failed) await recordEvent(id, "failed", "status", `${failure.code}: ${failure.message}`);
    } catch (error) {
      console.error("Could not persist failed research job state", { jobId: id, error });
    }
  }

  async function requireJob(id: string, scope: ResearchScope) {
    const job = await dependencies.jobs.findByIdForScope(id, scope);
    if (!job || job.deletedAt) throw createAppError(404, "JOB_NOT_FOUND", "Research job not found.");
    return job;
  }

    return { create, retry, list, get, rename, remove, getReport, getUsage, cancel, eventsAfter, recoverInterruptedJobs };
}

function limitsForDepth(depth: CreateResearchJobInput["depth"]): ResearchJobRecord["limits"] {
  const limits = {
    quick: { maxSubtasks: 3, maxPages: 5, maxFollowUpRounds: 0, timeoutSeconds: 60 },
    standard: { maxSubtasks: 5, maxPages: 15, maxFollowUpRounds: 2, timeoutSeconds: 180 },
    deep: { maxSubtasks: 8, maxPages: 30, maxFollowUpRounds: 3, timeoutSeconds: 300 },
  };
  return limits[depth];
}

function toJobView(job: ResearchJobRecord, report?: ResearchReportView): ResearchJobView {
  const progress = job.progress.totalUnits === 0 ? 0 : Math.round((job.progress.completedUnits / job.progress.totalUnits) * 100);
  return {
    id: job._id,
    request: job.request,
    title: job.title ?? (job.request.goal.length > 48 ? `${job.request.goal.slice(0, 45)}…` : job.request.goal),
    question: job.request.goal,
    status: job.status === "queued" ? "queued" : job.status === "completed" ? report?.researchStatus === "needs_clarification" ? "needs_clarification" : report?.researchStatus === "partial" ? "partial" : "completed" : job.status === "failed" || job.status === "cancelled" ? "failed" : "running",
    createdAt: (job.createdAt ?? new Date()).toLocaleString(),
    updatedAt: (job.updatedAt ?? new Date()).toLocaleString(),
    createdAtIso: job.createdAt?.toISOString(),
    updatedAtIso: job.updatedAt?.toISOString(),
    progress,
    currentStage: job.currentStage,
    sourceCount: report?.sources.length ?? 0,
    error: job.error,
    ...(report && job.status === "completed" ? { report } : {}),
  };
}

function toReportView(report: ResearchReportView): ResearchReportView {
  return {
    ...(report.resolution ? { resolution: report.resolution } : {}),
    researchStatus: report.researchStatus ?? "not_run",
    summary: report.summary,
    recommendation: report.recommendation,
    alternatives: report.alternatives,
    comparison: report.comparison,
    sources: report.sources,
    uncertainties: report.uncertainties,
  };
}
