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

const provider = { mode: "local", provider: "ollama", endpoint: "http://localhost:11434", model: "llama3.1", apiKey: "private-test-key" } as const;
const execution = {
  jobId: job._id, contractVersion: "1.0", researchExecuted: true,
  report: {
    researchStatus: "completed", summary: "A finding. [S1]", recommendation: "A next step. [S1]",
    alternatives: [], comparison: [], uncertainties: ["Independent verification required."],
    sources: [{ id: "S1", title: "Source", domain: "example.com", url: "https://example.com/", accessedAt: "2026-10-28T12:00:00+00:00", snippet: "Retrieved source content.", reliability: "low" }],
  },
};

test("executes research with the selected provider and depth timeout without returning credentials", async () => {
  const client = createResearchAgentClient("http://127.0.0.1:8000/", 1000, async (input, init) => {
    assert.equal(String(input), "http://127.0.0.1:8000/api/v1/research/run");
    assert.equal(new Headers(init?.headers).get("X-Request-ID"), job._id);
    assert.deepEqual(JSON.parse(String(init?.body)).provider, provider);
    return new Response(JSON.stringify(execution));
  }, async (received) => {
    assert.equal(received._id, job._id);
    return provider;
  });
  const report = await client.runResearch(job);
  assert.equal(report.researchStatus, "completed");
  assert.equal(report.sources.length, 1);
  assert.equal(JSON.stringify(report).includes("private-test-key"), false);
});

test("rejects research with mismatched identity, no sources, fabricated references, or unsafe links", async () => {
  for (const invalid of [
    { ...execution, jobId: "job_other" },
    { ...execution, report: { ...execution.report, sources: [] } },
    { ...execution, report: { ...execution.report, summary: "Invented. [S99]" } },
    { ...execution, report: { ...execution.report, sources: [{ ...execution.report.sources[0], url: "javascript:alert(1)" }] } },
  ]) {
    const client = createResearchAgentClient("http://127.0.0.1:8000", 1000,
      async () => new Response(JSON.stringify(invalid)), async () => provider);
    await assert.rejects(client.runResearch(job), { code: "AGENT_CONTRACT_MISMATCH" });
  }
});

test("returns safe actionable research configuration errors", async () => {
  const client = createResearchAgentClient("http://127.0.0.1:8000", 1000, async () => new Response(JSON.stringify({
    error: { code: "SEARCH_NOT_CONFIGURED", message: "untrusted secret provider message", retryable: false },
  }), { status: 503 }), async () => provider);
  await assert.rejects(client.runResearch(job), (error: any) => {
    assert.equal(error.code, "SEARCH_NOT_CONFIGURED");
    assert.match(error.message, /TAVILY_API_KEY/);
    assert.equal(error.message.includes("secret"), false);
    return true;
  });
});
