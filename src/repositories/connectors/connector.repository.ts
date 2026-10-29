import { model, Schema } from "mongoose";
import type { ConnectorRecord, PairingRecord, ConnectorTask, ConnectorStore } from "../../models/connectors/connector.types.js";

const scope = { tenantId: { type: String, required: true }, workspaceId: { type: String, required: true }, userId: { type: String, required: true } };
const pairingSchema = new Schema<PairingRecord>({ _id: String, ...scope, expiresAt: { type: Date, required: true } }, { versionKey: false });
pairingSchema.index({ expiresAt: 1 }, { expireAfterSeconds: 0 });
pairingSchema.index({ tenantId: 1, workspaceId: 1, userId: 1 }, { unique: true });
const connectorSchema = new Schema<ConnectorRecord>({ _id: String, ...scope, tokenHash: { type: String, required: true }, name: String, models: [String], lastSeen: Date, expiresAt: Date }, { versionKey: false });
connectorSchema.index({ tokenHash: 1 }, { unique: true });
connectorSchema.index({ tenantId: 1, workspaceId: 1, userId: 1 }, { unique: true });
connectorSchema.index({ expiresAt: 1 }, { expireAfterSeconds: 0 });
const taskSchema = new Schema<ConnectorTask>({ _id: String, connectorId: { type: String, required: true }, status: String, payload: Schema.Types.Mixed, expiresAt: Date }, { versionKey: false });
taskSchema.index({ connectorId: 1, status: 1, expiresAt: 1 });
taskSchema.index({ expiresAt: 1 }, { expireAfterSeconds: 0 });
const Pairing = model<PairingRecord>("ConnectorPairing", pairingSchema);
const Connector = model<ConnectorRecord>("LocalConnector", connectorSchema);
const Task = model<ConnectorTask>("ConnectorTask", taskSchema);

export const connectorStore: ConnectorStore = {
  async createPairing(record) {
    const { tenantId, workspaceId, userId } = record;
    await Pairing.deleteMany({ tenantId, workspaceId, userId });
    await Pairing.create(record);
  },
  consumePairing: (hash, now) => Pairing.findOneAndDelete({ _id: hash, expiresAt: { $gt: now } }).lean().exec(),
  async replace(record) {
    const { tenantId, workspaceId, userId } = record;
    await Connector.findOneAndReplace({ tenantId, workspaceId, userId }, record, { upsert: true }).exec();
  },
  find: (scope) => Connector.findOne(scope).lean().exec(),
  authenticate: (tokenHash, now) => Connector.findOne({ tokenHash, expiresAt: { $gt: now } }).lean().exec(),
  async heartbeat(_id, models, lastSeen) { await Connector.updateOne({ _id }, { $set: { models, lastSeen } }); },
  revoke: (scope) => Connector.findOneAndDelete(scope).lean().exec(),
  async createTask(task) { await Task.create(task); },
  claim: (connectorId, now) => Task.findOneAndUpdate({ connectorId, status: "queued", expiresAt: { $gt: now } }, { $set: { status: "running" } }, { new: true, sort: { expiresAt: 1 } }).lean().exec(),
  finishTask: (_id, connectorId, now) => Task.findOneAndDelete({ _id, connectorId, status: "running", expiresAt: { $gt: now } }).lean().exec(),
  async deleteTask(_id) { await Task.deleteOne({ _id }); },
};

export async function ensureConnectorIndexes() { await Promise.all([Pairing.init(), Connector.init(), Task.init()]); }
