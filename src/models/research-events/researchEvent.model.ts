import { Schema, model } from "mongoose";

export interface ResearchEventRecord {
  jobId: string;
  sequence: number;
  stage: string;
  eventType: "stage" | "status";
  message: string;
  createdAt: Date;
}

const researchEventSchema = new Schema<ResearchEventRecord>(
  {
    jobId: { type: String, required: true },
    sequence: { type: Number, required: true },
    stage: { type: String, required: true },
    eventType: { type: String, enum: ["stage", "status"], required: true },
    message: { type: String, required: true },
    createdAt: { type: Date, required: true, default: Date.now },
  },
  { versionKey: false, collection: "research_events" },
);

researchEventSchema.index({ jobId: 1, sequence: 1 }, { unique: true });

export const ResearchEventModel = model<ResearchEventRecord>("ResearchEvent", researchEventSchema);
