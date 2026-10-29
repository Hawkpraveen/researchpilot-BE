import { ResearchReportModel, type ResearchReportRecord } from "../../models/research-reports/researchReport.model.js";
import { ResearchJobModel } from "../../models/research-jobs/researchJob.model.js";
import type { ResearchReportView } from "../../models/research-jobs/researchJob.types.js";

export interface ResearchReportsRepository {
  save(jobId: string, report: ResearchReportView): Promise<void>;
  findByJobId(jobId: string): Promise<ResearchReportRecord | null>;
}

export function createMongoResearchReportsRepository(): ResearchReportsRepository {
  return {
    async save(jobId, report) {
      const job = await ResearchJobModel.findById(jobId).select({ tenantId: 1, workspaceId: 1 }).lean();
      if (!job) throw new Error(`Research job ${jobId} was not found while saving a report.`);
      await ResearchReportModel.findOneAndUpdate(
        { jobId },
        { $set: { ...report, tenantId: job.tenantId, workspaceId: job.workspaceId, schemaVersion: "1.0" }, $setOnInsert: { jobId } },
        { upsert: true, new: true, runValidators: true },
      );
    },
    findByJobId(jobId) {
      return ResearchReportModel.findOne({ jobId }).lean<ResearchReportRecord>().exec();
    },
  };
}
