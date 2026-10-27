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
import type { CreateResearchJobInput } from "./researchJobs.validation.js";
import { createStubReport } from "./stubResearchAgent.service.js";

const activeStatuses: ResearchStatus[] = ["queued", "planning", "researching", "verifying", "analyzing", "quality_check"];
const terminalStatuses: ResearchStatus[] = ["completed", "failed", "cancelled"];
const wait = (milliseconds: number): Promise<void> => new Promise((resolve) => setTimeout(resolve, milliseconds));

export interface ResearchJobsServiceDependencies {
  jobs: ResearchJobsRepository;
  events: ResearchEventsRepository;
  reports: ResearchReportsRepository;
  agent: ResearchAgent;
  schedule?: (work: () => Promise<void>) => void;
  pause?: (milliseconds: number) => Promise<void>;
}

export type ResearchJobsService = ReturnType<typeof createResearchJobsService>;

export function createResearchJobsService(dependencies: ResearchJobsServiceDependencies) {
  const schedule = dependencies.schedule ?? ((work: () => Promise<void>) => setTimeout(() => void work(), 0));
  const pause = dependencies.pause ?? wait;

  async function create(input: CreateResearchJobInput, ownerId: string) {
    const now = new Date();
    const record: ResearchJobRecord = {
      _id: `job_${randomUUID()}`,
      ownerId,
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
    await dependencies.events.append(saved._id, "queued", "status", "Research job queued.");
    schedule(async () => {
      await runWorkflow(saved._id).catch(async (error: unknown) => {
        console.error("Research job workflow failed", { jobId: saved._id, error });
        await markFailed(saved._id, error);
      });
    });

    return {
      jobId: saved._id,
      status: "queued" as const,
      statusUrl: `/api/v1/research-jobs/${encodeURIComponent(saved._id)}`,
      eventsUrl: `/api/v1/research-jobs/${encodeURIComponent(saved._id)}/events`,
    };
  }

  async function list(ownerId: string): Promise<ResearchJobView[]> {
    const jobs = await dependencies.jobs.listForOwner(ownerId, 50);
    const reports = await Promise.all(jobs.map((job) => dependencies.reports.findByJobId(job._id)));
    return jobs.map((job, index) => toJobView(job, reports[index] ? toReportView(reports[index]) : undefined));
  }

  async function get(id: string, ownerId: string): Promise<ResearchJobView> {
    const job = await requireJob(id, ownerId);
    const report = await dependencies.reports.findByJobId(id);
    return toJobView(job, report ? toReportView(report) : undefined);
  }

  async function getReport(id: string, ownerId: string): Promise<ResearchReportView> {
    const job = await requireJob(id, ownerId);
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
    };
  }

  async function cancel(id: string, ownerId: string) {
    const job = await requireJob(id, ownerId);
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
    await dependencies.events.append(id, "cancelled", "status", "Research job cancelled.");
    return { jobId: id, status: "cancelled" as const };
  }

  async function eventsAfter(id: string, sequence: number, ownerId: string): Promise<ResearchEventRecord[]> {
    await requireJob(id, ownerId);
    return dependencies.events.listAfter(id, sequence, 100);
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
      if (updated) await dependencies.events.append(job._id, "failed", "status", "Research job interrupted by API restart.");
    }

    const queued = await dependencies.jobs.findByStatus("queued");
    for (const job of queued) schedule(async () => {
      await runWorkflow(job._id).catch(async (error: unknown) => {
        console.error("Research job recovery failed", { jobId: job._id, error });
        await markFailed(job._id, error);
      });
    });
  }

  async function runWorkflow(id: string) {
    let job = await dependencies.jobs.findById(id);
    if (!job || job.status !== "queued") return;

    const started = await dependencies.jobs.update(id, {
      status: "planning",
      currentStage: "Planning",
      progress: { completedUnits: 0, totalUnits: 5, message: "Preparing a bounded research plan." },
      startedAt: new Date(),
    }, ["queued"]);
    if (!started) return;
    await dependencies.events.append(id, "planning", "stage", "Preparing a bounded research plan.");

    job = await dependencies.jobs.findById(id);
    if (!job || job.status !== "planning") return;
    const agentPlan = await dependencies.agent.createPlan(job);
    if (agentPlan.jobId !== id || agentPlan.contractVersion !== job.contractVersion) {
      throw createAppError(502, "AGENT_CONTRACT_MISMATCH", "The research agent returned a plan for a different job.");
    }
    const planned = await dependencies.jobs.update(id, {
      agentPlan,
      progress: { completedUnits: 1, totalUnits: 5, message: `The agent prepared ${agentPlan.tasks.length} bounded research tasks.` },
    }, ["planning"]);
    if (!planned) return;
    await dependencies.events.append(id, "planning", "stage", `Agent prepared ${agentPlan.tasks.length} bounded research tasks.`);

    const stages: Array<{ status: ResearchStatus; label: string; message: string }> = [
      { status: "researching", label: "Researching", message: "A research plan is ready; no search provider is configured, so sources are not being fetched." },
      { status: "verifying", label: "Verifying", message: "No evidence is available to verify in the scaffold workflow." },
      { status: "analyzing", label: "Analyzing", message: "Preparing an explicit unknowns-only placeholder report." },
      { status: "quality_check", label: "Quality check", message: "Checking that unresearched claims are not presented as facts." },
    ];

    for (let index = 0; index < stages.length; index += 1) {
      await pause(100);
      job = await dependencies.jobs.findById(id);
      if (!job || job.status === "cancelled") return;
      const stage = stages[index];
      const updated = await dependencies.jobs.update(id, {
        status: stage.status,
        currentStage: stage.label,
        progress: { completedUnits: index + 2, totalUnits: 5, message: stage.message },
      }, activeStatuses);
      if (!updated) return;
      await dependencies.events.append(id, stage.status, "stage", stage.message);
    }

    job = await dependencies.jobs.findById(id);
    if (!job || job.status === "cancelled") return;
    await dependencies.reports.save(id, createStubReport(job));
    const completed = await dependencies.jobs.update(id, {
      status: "completed",
      currentStage: "Plan ready",
      progress: { completedUnits: 5, totalUnits: 5, message: "Planning completed; no external research was run." },
      finishedAt: new Date(),
    }, ["quality_check"]);
    if (completed) await dependencies.events.append(id, "completed", "status", "Workflow scaffold completed.");
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
      if (failed) await dependencies.events.append(id, "failed", "status", "Research workflow failed.");
    } catch (error) {
      console.error("Could not persist failed research job state", { jobId: id, error });
    }
  }

  async function requireJob(id: string, ownerId: string) {
    const job = ownerId
      ? await dependencies.jobs.findByIdForOwner(id, ownerId)
      : await dependencies.jobs.findById(id);
    if (!job) throw createAppError(404, "JOB_NOT_FOUND", "Research job not found.");
    return job;
  }

  return { create, list, get, getReport, cancel, eventsAfter, recoverInterruptedJobs };
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
    title: job.request.goal.length > 48 ? `${job.request.goal.slice(0, 45)}…` : job.request.goal,
    question: job.request.goal,
    status: job.status === "queued" ? "queued" : job.status === "completed" ? "completed" : job.status === "failed" || job.status === "cancelled" ? "failed" : "running",
    createdAt: (job.createdAt ?? new Date()).toLocaleString(),
    updatedAt: (job.updatedAt ?? new Date()).toLocaleString(),
    progress,
    currentStage: job.currentStage,
    sourceCount: report?.sources.length ?? 0,
    error: job.error,
    ...(report && job.status === "completed" ? { report } : {}),
  };
}

function toReportView(report: ResearchReportView): ResearchReportView {
  return {
    researchStatus: report.researchStatus ?? "not_run",
    summary: report.summary,
    recommendation: report.recommendation,
    alternatives: report.alternatives,
    comparison: report.comparison,
    sources: report.sources,
    uncertainties: report.uncertainties,
  };
}
