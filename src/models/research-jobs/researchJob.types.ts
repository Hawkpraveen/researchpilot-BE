export const researchStatuses = [
  "queued",
  "planning",
  "researching",
  "verifying",
  "analyzing",
  "quality_check",
  "completed",
  "failed",
  "cancelled",
] as const;

export type ResearchStatus = (typeof researchStatuses)[number];
export type ResearchDepth = "quick" | "standard" | "deep";

export interface ResearchCriterion {
  id: string;
  label: string;
  weight: number;
}

export interface ResearchRequest {
  goal: string;
  alternatives: string[];
  criteria: ResearchCriterion[];
  constraints: string[];
  depth: ResearchDepth;
}

export interface ResearchProgress {
  completedUnits: number;
  totalUnits: number;
  message: string;
}

export interface ResearchError {
  code: string;
  message: string;
  retryable: boolean;
}

export interface ResearchAgentPlan {
  jobId: string;
  contractVersion: "1.0";
  status: "planned";
  researchExecuted: false;
  budget: {
    maxSubtasks: number;
    maxPages: number;
    maxFollowUpRounds: number;
    timeoutSeconds: number;
  };
  tasks: Array<{
    id: string;
    criterionId: string | null;
    question: string;
    searchQueries: string[];
  }>;
  omittedCriterionIds: string[];
  constraints: string[];
  notice: string;
}

export interface ResearchJobRecord {
  resume?: { subject: string; context: string; consumedPages: number; sources: ResearchReportView["sources"] } | null;
  _id: string;
  title?: string;
  deletedAt?: Date | null;
  tenantId: string;
  workspaceId: string;
  ownerId: string | null;
  request: ResearchRequest;
  agentPlan?: ResearchAgentPlan;
  status: ResearchStatus;
  currentStage: string;
  progress: ResearchProgress;
  limits: {
    maxSubtasks: number;
    maxPages: number;
    maxFollowUpRounds: number;
    timeoutSeconds: number;
  };
  contractVersion: string;
  startedAt: Date | null;
  finishedAt: Date | null;
  error: ResearchError | null;
  version: number;
  createdAt?: Date;
  updatedAt?: Date;
}

export interface ResearchJobView {
  request?: ResearchRequest;
  id: string;
  title: string;
  question: string;
  status: "queued" | "running" | "completed" | "failed" | "needs_clarification" | "partial";
  createdAt: string;
  updatedAt: string;
  createdAtIso?: string;
  updatedAtIso?: string;
  progress: number;
  currentStage: string;
  sourceCount: number;
  error?: ResearchError | null;
  report?: ResearchReportView;
}

export interface ResearchReportView {
  researchStatus: "not_run" | "completed" | "partial" | "needs_clarification";
  resolution?: {
    status: "resolved" | "ambiguous" | "unresolved";
    subject: string;
    explanation: string;
    candidates: Array<{ label: string; description: string; sourceIds: string[] }>;
    selectedSourceIds: string[];
  };
  summary: string;
  recommendation: string;
  alternatives: string[];
  comparison: Array<{ criterion: string; values: Record<string, string> }>;
  sources: Array<{
    id: string;
    title: string;
    domain: string;
    url: string;
    accessedAt: string;
    snippet: string;
    reliability: "high" | "medium" | "low";
  }>;
  uncertainties: string[];
}
