import { ResearchReportModel, type ResearchReportRecord } from "../../models/research-reports/researchReport.model.js";
import type { ResearchReportView } from "../../models/research-jobs/researchJob.types.js";

export interface ResearchReportsRepository {
  save(jobId: string, report: ResearchReportView): Promise<void>;
  findByJobId(jobId: string): Promise<ResearchReportRecord | null>;
}

export function createMongoResearchReportsRepository(): ResearchReportsRepository {
  return {
    async save(jobId, report) {
      await ResearchReportModel.findOneAndUpdate(
        { jobId },
        { $set: { ...report, schemaVersion: "1.0" }, $setOnInsert: { jobId } },
        { upsert: true, new: true, runValidators: true },
      );
    },
    findByJobId(jobId) {
      return ResearchReportModel.findOne({ jobId }).lean<ResearchReportRecord>().exec();
    },
  };
}
