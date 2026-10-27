import { z } from "zod";
import type { ResearchAgentPlan, ResearchJobRecord } from "../../models/research-jobs/researchJob.types.js";
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
}

export function createResearchAgentClient(
    baseUrl: string,
    timeoutMs: number,
    fetcher: typeof fetch = fetch,
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
  return { createPlan };
}
