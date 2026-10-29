import { z } from "zod";
import type { ResearchAgentPlan, ResearchJobRecord, ResearchReportView } from "../../models/research-jobs/researchJob.types.js";
import { createAppError } from "../../utils/AppError.js";

const researchPlanSchema = z.object({
  jobId: z.string().min(1),
  contractVersion: z.literal("1.0"),
  status: z.literal("planned"),
  researchExecuted: z.literal(false),
  budget: z.object({
    maxSubtasks: z.number().int().nonnegative(),
    maxPages: z.number().int().nonnegative(),
    maxFollowUpRounds: z.number().int().nonnegative(),
    timeoutSeconds: z.number().int().positive(),
  }).strict(),
  tasks: z.array(z.object({
    id: z.string().min(1),
    criterionId: z.string().nullable(),
    question: z.string().min(1),
    searchQueries: z.array(z.string()),
  }).strict()),
  omittedCriterionIds: z.array(z.string()),
  constraints: z.array(z.string()),
  notice: z.string().min(1),
}).strict();

export interface ResearchAgent {
  createPlan(job: ResearchJobRecord): Promise<ResearchAgentPlan>;
  runResearch(job: ResearchJobRecord): Promise<ResearchReportView>;
}

export interface ResearchProviderConfig {
  mode: "local" | "byok";
  provider: "ollama" | "openai" | "anthropic" | "custom";
  endpoint: string;
  model: string;
  apiKey: string;
}

const reportSchema = z.object({
  researchStatus: z.literal("completed"),
  summary: z.string().min(1).max(100000),
  recommendation: z.string().min(1).max(10000),
  alternatives: z.array(z.string()).max(10),
  comparison: z.array(z.object({ criterion: z.string(), values: z.record(z.string()) }).strict()).max(10),
  sources: z.array(z.object({
    id: z.string().regex(/^S[1-9][0-9]*$/), title: z.string().min(1), domain: z.string().min(1),
    url: z.string().url().refine((value) => {
      const url = new URL(value);
      return ["http:", "https:"].includes(url.protocol) && !url.username && !url.password;
    }),
    accessedAt: z.string().datetime({ offset: true }), snippet: z.string().min(1),
    reliability: z.enum(["high", "medium", "low"]),
  }).strict()).min(1).max(30),
  uncertainties: z.array(z.string()).max(100),
}).strict();

const executionSchema = z.object({
  jobId: z.string(), contractVersion: z.literal("1.0"), researchExecuted: z.literal(true), report: reportSchema,
}).strict();

const executionErrors: Record<string, string> = {
  SEARCH_NOT_CONFIGURED: "Set TAVILY_API_KEY in the Python agent's .env file, then restart the agent.",
  PROVIDER_NOT_CONFIGURED: "Save your model provider configuration and API key in Settings before starting research.",
  SEARCH_AUTH_FAILED: "The web search API key was rejected. Check TAVILY_API_KEY in the agent environment.",
  SEARCH_UNAVAILABLE: "The web search provider is unavailable. Try again later.",
  SEARCH_INVALID_RESPONSE: "The web search provider returned invalid results.",
  MODEL_AUTH_FAILED: "The model API key was rejected. Check your saved provider settings.",
  MODEL_UNAVAILABLE: "The selected model could not be reached. Check the endpoint and model in Settings.",
  MODEL_INVALID_RESPONSE: "The model returned invalid research output. Try a model with structured JSON support.",
  UNSUPPORTED_EVIDENCE: "The model cited evidence that was not retrieved. No report was published. Try again.",
  NO_RESEARCH_EVIDENCE: "No usable web evidence was found. Try a more specific question.",
  RESEARCH_TIMEOUT: "Research exceeded its time budget. Try a smaller question or a larger depth budget.",
};

export function createResearchAgentClient(
    baseUrl: string,
    timeoutMs: number,
    fetcher: typeof fetch = fetch,
    loadProvider?: (job: ResearchJobRecord) => Promise<ResearchProviderConfig>,
): ResearchAgent {
  const normalizedBaseUrl = baseUrl.replace(/\/+$/, "");

  async function createPlan(job: ResearchJobRecord): Promise<ResearchAgentPlan> {
    let response: Response;
    try {
      response = await fetcher(`${normalizedBaseUrl}/api/v1/research/plan`, {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
          "X-Request-ID": job._id,
        },
        body: JSON.stringify({
          jobId: job._id,
          contractVersion: job.contractVersion,
          request: job.request,
        }),
        signal: AbortSignal.timeout(timeoutMs),
      });
    } catch (error) {
      const timedOut = error instanceof Error && error.name === "TimeoutError";
      throw createAppError(
        503,
        timedOut ? "AGENT_TIMEOUT" : "AGENT_UNAVAILABLE",
        timedOut ? "The research agent timed out while preparing a plan." : "The research agent is unavailable.",
        true,
      );
    }

    if (!response.ok) {
      if (response.status === 422) {
        throw createAppError(502, "AGENT_REQUEST_REJECTED", "The research agent rejected the internal job request.");
      }
      throw createAppError(
        503,
        "AGENT_UNAVAILABLE",
        `The research agent returned HTTP ${response.status}.`,
        response.status >= 500,
      );
    }

    let body: unknown;
    try {
      body = await response.json();
    } catch {
      throw createAppError(502, "AGENT_CONTRACT_MISMATCH", "The research agent returned an invalid response.");
    }

    const parsed = researchPlanSchema.safeParse(body);
    if (!parsed.success || parsed.data.jobId !== job._id || parsed.data.contractVersion !== job.contractVersion) {
      throw createAppError(502, "AGENT_CONTRACT_MISMATCH", "The research agent response did not match the job contract.");
    }

    return parsed.data satisfies ResearchAgentPlan;
  }
  async function runResearch(job: ResearchJobRecord): Promise<ResearchReportView> {
    if (!loadProvider) throw createAppError(503, "PROVIDER_NOT_CONFIGURED", executionErrors.PROVIDER_NOT_CONFIGURED);
    const provider = await loadProvider(job);
    let response: Response;
    try {
      response = await fetcher(`${normalizedBaseUrl}/api/v1/research/run`, {
        method: "POST",
        headers: { "Content-Type": "application/json", "X-Request-ID": job._id },
        body: JSON.stringify({ jobId: job._id, contractVersion: job.contractVersion, request: job.request, provider }),
        signal: AbortSignal.timeout(job.limits.timeoutSeconds * 1000 + 10000),
      });
    } catch (error) {
      const timedOut = error instanceof Error && error.name === "TimeoutError";
      throw createAppError(503, timedOut ? "RESEARCH_TIMEOUT" : "AGENT_UNAVAILABLE",
        timedOut ? executionErrors.RESEARCH_TIMEOUT : "The research agent is unavailable.", true);
    }
    let body: unknown;
    try { body = await response.json(); } catch {
      throw createAppError(502, "AGENT_CONTRACT_MISMATCH", "The research agent returned invalid research output.");
    }
    if (!response.ok) {
      const failure = z.object({ error: z.object({ code: z.string(), retryable: z.boolean() }) }).safeParse(body);
      if (failure.success && Object.hasOwn(executionErrors, failure.data.error.code)) {
        throw createAppError(503, failure.data.error.code, executionErrors[failure.data.error.code], failure.data.error.retryable);
      }
      throw createAppError(503, "AGENT_UNAVAILABLE", "The research agent could not execute this job.", response.status >= 500);
    }
    const parsed = executionSchema.safeParse(body);
    if (!parsed.success || parsed.data.jobId !== job._id || parsed.data.contractVersion !== job.contractVersion) {
      throw createAppError(502, "AGENT_CONTRACT_MISMATCH", "The research agent returned a report that did not match the job contract.");
    }
    const report = parsed.data.report;
    const ids = new Set(report.sources.map((source) => source.id));
    const texts = [report.summary, report.recommendation, ...report.comparison.flatMap((row) => Object.values(row.values))];
    if (ids.size !== report.sources.length || report.sources.length > job.limits.maxPages
      || texts.some((text) => [...text.matchAll(/\[(S\d+)\]/g)].some((match) => !ids.has(match[1])))
      || !/\[S\d+\]/.test(report.summary) || !/\[S\d+\]/.test(report.recommendation)) {
      throw createAppError(502, "AGENT_CONTRACT_MISMATCH", "The research report contains invalid source references.");
    }
    return report;
  }
  return { createPlan, runResearch };
}
