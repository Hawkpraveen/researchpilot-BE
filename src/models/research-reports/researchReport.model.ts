import { Schema, model } from "mongoose";
import type { ResearchReportView } from "../research-jobs/researchJob.types.js";

export interface ResearchReportRecord extends ResearchReportView {
  jobId: string;
  schemaVersion: string;
  createdAt: Date;
}

const researchReportSchema = new Schema<ResearchReportRecord>(
  {
    jobId: { type: String, required: true },
    schemaVersion: { type: String, required: true, default: "1.0" },
    researchStatus: { type: String, enum: ["not_run", "completed"], required: true, default: "not_run" },
    summary: { type: String, required: true },
    recommendation: { type: String, required: true },
    alternatives: { type: [String], required: true, default: [] },
    comparison: {
      type: [
        new Schema(
          {
            criterion: { type: String, required: true },
            values: { type: Schema.Types.Mixed, required: true },
          },
          { _id: false },
        ),
      ],
      required: true,
      default: [],
    },
    sources: {
      type: [
        new Schema(
          {
            id: { type: String, required: true },
            title: { type: String, required: true },
            domain: { type: String, required: true },
            url: { type: String, required: true },
            accessedAt: { type: String, required: true },
            snippet: { type: String, required: true },
            reliability: { type: String, enum: ["high", "medium", "low"], required: true },
          },
          { _id: false },
        ),
      ],
      required: true,
      default: [],
    },
    uncertainties: { type: [String], required: true, default: [] },
  },
  { timestamps: true, versionKey: false, collection: "research_reports" },
);

researchReportSchema.index({ jobId: 1 }, { unique: true });

export const ResearchReportModel = model<ResearchReportRecord>("ResearchReport", researchReportSchema);
