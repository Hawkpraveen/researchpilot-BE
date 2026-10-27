import assert from "node:assert/strict";
import test from "node:test";
import type { ResearchJobRecord } from "../src/models/research-jobs/researchJob.types.js";
import { createResearchAgentClient } from "../src/services/research-agent/researchAgent.client.js";

const job: ResearchJobRecord = {
  _id: "job_test-123",
  ownerId: null,
  request: {
    goal: "Compare two tools",
    alternatives: ["Tool A", "Tool B"],
    criteria: [{ id: "pricing", label: "Pricing", weight: 5 }],
    constraints: ["Use public information"],
    depth: "quick",
  },
  status: "planning",
  currentStage: "Planning",
  progress: { completedUnits: 0, totalUnits: 5, message: "Preparing a plan." },
  limits: { maxSubtasks: 3, maxPages: 5, maxFollowUpRounds: 0, timeoutSeconds: 60 },
  contractVersion: "1.0",
  startedAt: new Date(),
  finishedAt: null,
  error: null,
  version: 1,
};

const validPlan = {
  jobId: job._id,
  contractVersion: "1.0",
  status: "planned",
  researchExecuted: false,
  budget: job.limits,
  tasks: [{
    id: "criterion-pricing",
    criterionId: "pricing",
    question: "Compare pricing",
    searchQueries: ["Tool A pricing", "Tool B pricing"],
  }],
  omittedCriterionIds: [],
  constraints: job.request.constraints,
  notice: "Planning only. No search executed.",
};

test("sends the versioned job to the internal Agent and validates its response", async () => {
  let url = "";
  let init: RequestInit | undefined;
  const client = createResearchAgentClient("http://127.0.0.1:8000/", 2500, async (input, requestInit) => {
    url = String(input);
    init = requestInit;
    return new Response(JSON.stringify(validPlan), { status: 200 });
  });

  const plan = await client.createPlan(job);

  assert.equal(url, "http://127.0.0.1:8000/api/v1/research/plan");
  assert.equal(init?.method, "POST");
  assert.equal(new Headers(init?.headers).get("x-request-id"), job._id);
  assert.deepEqual(JSON.parse(String(init?.body)), {
    jobId: job._id,
    contractVersion: job.contractVersion,
    request: job.request,
  });
  assert.equal(plan.researchExecuted, false);
  assert.equal(init?.signal instanceof AbortSignal, true);
});

test("rejects Agent responses for a different job as a contract mismatch", async () => {
  const client = createResearchAgentClient("http://127.0.0.1:8000", 2500, async () => {
    return new Response(JSON.stringify({ ...validPlan, jobId: "job_another" }), { status: 200 });
  });

  await assert.rejects(client.createPlan(job), { code: "AGENT_CONTRACT_MISMATCH" });
});

test("reports an unavailable Agent using a stable retryable error", async () => {
  const client = createResearchAgentClient("http://127.0.0.1:8000", 2500, async () => {
    return new Response("unavailable", { status: 503 });
  });

  await assert.rejects(client.createPlan(job), { code: "AGENT_UNAVAILABLE", retryable: true });
});
