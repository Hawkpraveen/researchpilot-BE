import { Schema, model } from "mongoose";
import type { ResearchUsage, UsageStatus } from "../../services/research-jobs/researchUsage.js";
import type { ResearchJobRecord } from "../../models/research-jobs/researchJob.types.js";

const callSchema = new Schema({
  provider: String, stage: String, model: { type: String, default: null }, status: String,
  httpStatus: { type: Number, default: null }, durationMs: Number,
  inputTokens: { type: Number, default: null }, outputTokens: { type: Number, default: null },
  totalTokens: { type: Number, default: null }, cachedInputTokens: { type: Number, default: null },
  cacheWriteTokens: { type: Number, default: null }, credits: { type: Number, default: null },
}, { _id: false });
const schema = new Schema({
  jobId: { type: String, required: true }, executionId: { type: String, required: true },
  tenantId: { type: String, required: true }, workspaceId: { type: String, required: true }, ownerId: String,
  status: { type: String, enum: ["running", "completed", "failed"], required: true },
  calls: { type: [callSchema], default: [] },
  // No price is inferred from tokens/credits; provider plans and negotiated rates vary.
  costUsd: { type: Number, default: null }, costStatus: { type: String, default: "unknown" },
}, { timestamps: true, versionKey: false, collection: "research_usage" });
schema.index({ tenantId: 1, workspaceId: 1, jobId: 1, executionId: 1 }, { unique: true });
export const ResearchUsageModel = model("ResearchUsage", schema);
export const researchUsageRepository = {
  async save(job: ResearchJobRecord, usage: ResearchUsage, status: UsageStatus) {
    await ResearchUsageModel.updateOne(
      { tenantId: job.tenantId, workspaceId: job.workspaceId, jobId: job._id, executionId: usage.executionId },
      { $set: { status, calls: usage.calls, ownerId: job.ownerId }, $setOnInsert: { costUsd: null, costStatus: "unknown" } },
      { upsert: true, runValidators: true },
    );
  },
  list(jobId: string, scope: { tenantId: string; workspaceId: string; ownerId: string }) {
    return ResearchUsageModel.find({ jobId, ...scope }).select("executionId status calls costUsd costStatus createdAt updatedAt -_id").sort({ createdAt: 1 }).lean().exec();
  },
};
