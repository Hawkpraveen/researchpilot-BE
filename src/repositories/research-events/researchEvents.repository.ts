import { ResearchEventModel, type ResearchEventRecord } from "../../models/research-events/researchEvent.model.js";

export interface ResearchEventsRepository {
  append(jobId: string, stage: string, eventType: ResearchEventRecord["eventType"], message: string): Promise<ResearchEventRecord>;
  listAfter(jobId: string, sequence: number, limit: number): Promise<ResearchEventRecord[]>;
}

export function createMongoResearchEventsRepository(): ResearchEventsRepository {
  return {
    async append(jobId, stage, eventType, message) {
      const latest = await ResearchEventModel.findOne({ jobId }).sort({ sequence: -1 }).select({ sequence: 1 }).lean();
      const sequence = (latest?.sequence ?? 0) + 1;
      return ResearchEventModel.create({ jobId, sequence, stage, eventType, message, createdAt: new Date() });
    },
    listAfter(jobId, sequence, limit) {
      return ResearchEventModel.find({ jobId, sequence: { $gt: sequence } })
        .sort({ sequence: 1 })
        .limit(limit)
        .lean<ResearchEventRecord[]>()
        .exec();
    },
  };
}
