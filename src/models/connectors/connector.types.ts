export interface ConnectorScope { tenantId: string; workspaceId: string; userId: string }
export interface ConnectorRecord extends ConnectorScope {
  _id: string; tokenHash: string; name: string; models: string[]; lastSeen: Date; expiresAt: Date;
}
export interface PairingRecord extends ConnectorScope { _id: string; expiresAt: Date }
export interface ConnectorTask { _id: string; connectorId: string; status: "queued" | "running"; payload: Record<string, unknown>; expiresAt: Date }
export interface ConnectorStore {
  createPairing(record: PairingRecord): Promise<void>;
  consumePairing(hash: string, now: Date): Promise<PairingRecord | null>;
  replace(record: ConnectorRecord): Promise<void>;
  find(scope: ConnectorScope): Promise<ConnectorRecord | null>;
  authenticate(hash: string, now: Date): Promise<ConnectorRecord | null>;
  heartbeat(id: string, models: string[], now: Date): Promise<void>;
  revoke(scope: ConnectorScope): Promise<ConnectorRecord | null>;
  createTask(task: ConnectorTask): Promise<void>;
  claim(id: string, now: Date): Promise<ConnectorTask | null>;
  finishTask(id: string, connectorId: string, now: Date): Promise<ConnectorTask | null>;
  deleteTask(id: string): Promise<void>;
}
