import { Schema, model } from "mongoose";
import { researchStatuses, type ResearchJobRecord } from "./researchJob.types.js";

const criterionSchema = new Schema(
  {
    id: { type: String, required: true },
    label: { type: String, required: true },
    weight: { type: Number, required: true, min: 1, max: 5 },
  },
  { _id: false },
);

const requestSchema = new Schema(
  {
    goal: { type: String, required: true },
    alternatives: { type: [String], required: true, default: [] },
    criteria: { type: [criterionSchema], required: true, default: [] },
    constraints: { type: [String], required: true, default: [] },
    depth: { type: String, enum: ["quick", "standard", "deep"], required: true },
  },
  { _id: false },
);

const progressSchema = new Schema(
  {
    completedUnits: { type: Number, required: true, default: 0 },
    totalUnits: { type: Number, required: true, default: 5 },
    message: { type: String, required: true },
  },
  { _id: false },
);

const errorSchema = new Schema(
  {
    code: { type: String, required: true },
    message: { type: String, required: true },
    retryable: { type: Boolean, required: true },
  },
  { _id: false },
);

const researchPlanTaskSchema = new Schema(
  {
    id: { type: String, required: true },
    criterionId: { type: String, default: null },
    question: { type: String, required: true },
    searchQueries: { type: [String], required: true },
  },
  { _id: false },
);

const researchAgentPlanSchema = new Schema(
  {
    jobId: { type: String, required: true },
    contractVersion: { type: String, enum: ["1.0"], required: true },
    status: { type: String, enum: ["planned"], required: true },
    researchExecuted: { type: Boolean, required: true, default: false },
    budget: {
      maxSubtasks: { type: Number, required: true },
      maxPages: { type: Number, required: true },
      maxFollowUpRounds: { type: Number, required: true },
      timeoutSeconds: { type: Number, required: true },
    },
    tasks: { type: [researchPlanTaskSchema], required: true },
    omittedCriterionIds: { type: [String], required: true },
    constraints: { type: [String], required: true },
    notice: { type: String, required: true },
  },
  { _id: false },
);

const researchJobSchema = new Schema<ResearchJobRecord>(
  {
    _id: { type: String, required: true },
    title: { type: String, trim: true, maxlength: 200 },
    deletedAt: { type: Date, default: null },
    tenantId: { type: String, required: true, index: true },
    workspaceId: { type: String, required: true, index: true },
    ownerId: { type: String, default: null },
    request: { type: requestSchema, required: true },
    agentPlan: { type: researchAgentPlanSchema, default: undefined },
    resume: { type: new Schema({ subject: { type: String, default: "" }, context: { type: String, default: "" }, consumedPages: Number,
      sources: { type: [new Schema({ id: String, title: String, domain: String, url: String, accessedAt: String, snippet: String, reliability: String }, { _id: false })], default: [] },
    }, { _id: false }), default: null },
    status: { type: String, enum: researchStatuses, required: true, default: "queued" },
    currentStage: { type: String, required: true, default: "Queued" },
    progress: { type: progressSchema, required: true },
    limits: {
      maxSubtasks: { type: Number, required: true },
      maxPages: { type: Number, required: true },
      maxFollowUpRounds: { type: Number, required: true },
      timeoutSeconds: { type: Number, required: true },
    },
    contractVersion: { type: String, required: true, default: "1.0" },
    startedAt: { type: Date, default: null },
    finishedAt: { type: Date, default: null },
    error: { type: errorSchema, default: null },
    version: { type: Number, required: true, default: 0 },
  },
  { timestamps: true, versionKey: false, collection: "research_jobs" },
);

researchJobSchema.index({ tenantId: 1, workspaceId: 1, ownerId: 1, createdAt: -1 });
researchJobSchema.index({ status: 1, updatedAt: 1 });

export const ResearchJobModel = model<ResearchJobRecord>("ResearchJob", researchJobSchema);
