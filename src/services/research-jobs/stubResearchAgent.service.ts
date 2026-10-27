import type { ResearchJobRecord, ResearchReportView } from "../../models/research-jobs/researchJob.types.js";

export function createStubReport(job: ResearchJobRecord): ResearchReportView {
  const alternatives = job.request.alternatives;
  const labels = alternatives.length > 0 ? alternatives : ["No alternatives provided"];

  return {
    researchStatus: "not_run",
    summary:
      "This job completed the API workflow scaffold only. No web research or external AI was run, so this result contains no verified findings.",
    recommendation:
      "No recommendation is available yet. The Agent prepared a plan, but search and evidence evaluation are not implemented.",
    alternatives: [],
    comparison: job.request.criteria.map((criterion) => ({
      criterion: criterion.label,
      values: Object.fromEntries(labels.map((alternative) => [alternative, "Not researched"])),
    })),
    sources: [],
    uncertainties: [
      "The Agent returned a research plan, but this workflow did not execute it or collect sources.",
      "No claims, prices, features, or certifications were verified.",
      ...job.request.criteria.map((criterion) => `No evidence collected for: ${criterion.label}.`),
      ...job.request.constraints.map((constraint) => `Constraint not evaluated: ${constraint}.`),
    ],
  };
}
