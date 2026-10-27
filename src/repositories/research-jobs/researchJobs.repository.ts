import { ResearchJobModel } from "../../models/research-jobs/researchJob.model.js";
import type { ResearchJobRecord, ResearchStatus } from "../../models/research-jobs/researchJob.types.js";

export interface ResearchJobsRepository {
  create(record: ResearchJobRecord): Promise<ResearchJobRecord>;
  findById(id: string): Promise<ResearchJobRecord | null>;
  listForOwner(ownerId: string, limit: number): Promise<ResearchJobRecord[]>;
  findByIdForOwner(id: string, ownerId: string): Promise<ResearchJobRecord | null>;
  update(id: string, update: Partial<ResearchJobRecord>, allowedStatuses?: ResearchStatus[]): Promise<ResearchJobRecord | null>;
  findByStatus(status: ResearchStatus): Promise<ResearchJobRecord[]>;
}

export function createMongoResearchJobsRepository(): ResearchJobsRepository {
  return {
    async create(record) {
      return (await ResearchJobModel.create(record)).toObject() as ResearchJobRecord;
    },
    findById(id) {
      return ResearchJobModel.findById(id).lean<ResearchJobRecord>().exec();
    },
    listForOwner(ownerId, limit) {
      return ResearchJobModel.find({ ownerId }).sort({ createdAt: -1 }).limit(limit).lean<ResearchJobRecord[]>().exec();
    },
    findByIdForOwner(id, ownerId) {
      return ResearchJobModel.findOne({ _id: id, ownerId }).lean<ResearchJobRecord>().exec();
    },
    update(id, update, allowedStatuses) {
      const filter = allowedStatuses ? { _id: id, status: { $in: allowedStatuses } } : { _id: id };
      return ResearchJobModel.findOneAndUpdate(
        filter,
        { $set: update, $inc: { version: 1 } },
        { new: true, runValidators: true },
      )
        .lean<ResearchJobRecord>()
        .exec();
    },
    findByStatus(status) {
      return ResearchJobModel.find({ status }).sort({ createdAt: 1 }).lean<ResearchJobRecord[]>().exec();
    },
  };
}
