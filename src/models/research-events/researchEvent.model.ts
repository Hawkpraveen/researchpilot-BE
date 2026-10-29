import { Schema, model } from "mongoose";

export interface ResearchEventRecord {
  tenantId: string;
  workspaceId: string;
  jobId: string;
  sequence: number;
  stage: string;
  eventType: "stage" | "status";
  message: string;
  createdAt: Date;
}

const researchEventSchema = new Schema<ResearchEventRecord>(
  {
    tenantId: { type: String, required: true, index: true },
    workspaceId: { type: String, required: true, index: true },
    jobId: { type: String, required: true },
    sequence: { type: Number, required: true },
    stage: { type: String, required: true },
    eventType: { type: String, enum: ["stage", "status"], required: true },
    message: { type: String, required: true },
    createdAt: { type: Date, required: true, default: Date.now },
  },
  { versionKey: false, collection: "research_events" },
);

researchEventSchema.index({ tenantId: 1, workspaceId: 1, jobId: 1, sequence: 1 }, { unique: true });

export const ResearchEventModel = model<ResearchEventRecord>("ResearchEvent", researchEventSchema);
