import { createHash, randomBytes, randomUUID } from "node:crypto";
import type { ConnectorScope, ConnectorStore } from "../../models/connectors/connector.types.js";
import { connectorStore } from "../../repositories/connectors/connector.repository.js";
import { createAppError } from "../../utils/AppError.js";

export const CONNECTOR_ENDPOINT = "http://connector.local";
const hash = (value: string) => createHash("sha256").update(value).digest("hex");
const fail = (status: number, code: string, message: string) => createAppError(status, code, message, true);
export function createConnectorService(store: ConnectorStore = connectorStore, now = Date.now, taskTimeout = 115_000, pollWait = 15_000) {
  const pending = new Map<string, { connectorId: string; resolve: (value: Record<string, unknown>) => void; reject: (error: Error) => void }>();
  const capabilities = new Map<string, { scope: ConnectorScope; model: string; expires: number }>();
  const wakeups = new Map<string, () => void>();
  const cancel = (id: string) => { for (const task of pending.values()) if (task.connectorId === id) task.reject(fail(503, "CONNECTOR_DISCONNECTED", "Your computer disconnected. Reconnect the connector and retry.")); };
  async function status(scope: ConnectorScope) {
    const record = await store.find(scope);
    const connected = Boolean(record && record.expiresAt.getTime() > now() && now() - record.lastSeen.getTime() < 45_000);
    return { connected, name: record?.name ?? null, models: connected ? record!.models : [], message: connected ? "Your computer is connected." : "Open ResearchPilot Connector on your computer." };
  }
  return {
    status,
    async createPairing(scope: ConnectorScope) {
      const code = randomBytes(32).toString("base64url");
      await store.createPairing({ ...scope, _id: hash(code), expiresAt: new Date(now() + 120_000) });
      return { code, expiresIn: 120 };
    },
    async pair(code: string, name: string) {
      const scope = await store.consumePairing(hash(code), new Date(now()));
      if (!scope) throw fail(401, "PAIRING_EXPIRED", "Connection approval expired. Connect again from Settings.");
      const old = await store.find({ tenantId: scope.tenantId, workspaceId: scope.workspaceId, userId: scope.userId });
      const token = randomBytes(32).toString("base64url");
      const record = { tenantId: scope.tenantId, workspaceId: scope.workspaceId, userId: scope.userId, _id: old?._id ?? randomUUID(), name, tokenHash: hash(token), models: [], lastSeen: new Date(0), expiresAt: new Date(now() + 30 * 86400_000) };
      await store.replace(record);
      if (old) cancel(old._id);
      return { token, connectorId: record._id, expiresAt: record.expiresAt.toISOString() };
    },
    async poll(token: string, models: string[]) {
      const connector = await store.authenticate(hash(token), new Date(now()));
      if (!connector) throw fail(401, "CONNECTOR_REVOKED", "Connect this computer again from Settings.");
      await store.heartbeat(connector._id, models, new Date(now()));
      let task = await store.claim(connector._id, new Date(now()));
      if (!task && pollWait > 0) {
        await new Promise<void>(resolve => {
          const timer = setTimeout(done, pollWait);
          function done() { clearTimeout(timer); if (wakeups.get(connector!._id) === done) wakeups.delete(connector!._id); resolve(); }
          wakeups.get(connector._id)?.();
          wakeups.set(connector._id, done);
        });
        // Authentication is checked again after waiting, including revocation.
        if (!await store.authenticate(hash(token), new Date(now()))) throw fail(401, "CONNECTOR_REVOKED", "This computer is no longer connected.");
        task = await store.claim(connector._id, new Date(now()));
      }
      return { task: task ? { id: task._id, payload: task.payload } : null };
    },
    async complete(token: string, taskId: string, result: Record<string, unknown>, error?: string) {
      const connector = await store.authenticate(hash(token), new Date(now()));
      if (!connector) throw fail(401, "CONNECTOR_REVOKED", "This computer is no longer connected.");
      const task = await store.finishTask(taskId, connector._id, new Date(now()));
      if (!task) throw fail(404, "CONNECTOR_TASK_EXPIRED", "The model request has expired.");
      const waiter = pending.get(taskId);
      if (waiter?.connectorId === connector._id) {
        if (error) waiter.reject(fail(502, "LOCAL_MODEL_FAILED", "Your local model could not complete the request. Check the connector."));
        else waiter.resolve(result);
      }
    },
    async revoke(scope: ConnectorScope) {
      const record = await store.revoke(scope);
      if (record) cancel(record._id);
      if (record) wakeups.get(record._id)?.();
    },
    mintRelay(scope: ConnectorScope, model: string) {
      for (const [key, value] of capabilities) if (value.expires <= now()) capabilities.delete(key);
      if (capabilities.size >= 1000) throw fail(503, "CONNECTOR_CAPACITY", "Too many active model connections. Try again shortly.");
      const token = randomBytes(32).toString("base64url");
      capabilities.set(hash(token), { scope, model, expires: now() + 360_000 });
      return token;
    },
    async relay(token: string, payload: Record<string, unknown>) {
      const capability = capabilities.get(hash(token));
      if (!capability || capability.expires <= now() || payload.model !== capability.model) throw fail(401, "CONNECTOR_RELAY_INVALID", "Model connection expired.");
      const connector = await store.find(capability.scope);
      if (!connector || !(await status(capability.scope)).connected) throw fail(503, "CONNECTOR_OFFLINE", "Your computer is offline. Open ResearchPilot Connector and retry.");
      if (!connector.models.includes(capability.model)) throw fail(400, "LOCAL_MODEL_MISSING", "The selected model is not installed on your computer.");
      if ([...pending.values()].some(task => task.connectorId === connector._id)) throw fail(429, "LOCAL_MODEL_BUSY", "Your computer is already running a model request. Try again shortly.");
      const id = randomUUID();
      let timer: ReturnType<typeof setTimeout> | undefined;
      const result = new Promise<Record<string, unknown>>((resolve, reject) => pending.set(id, { connectorId: connector._id, resolve, reject }));
      // A disconnect can reject while the database insert is still in progress.
      void result.catch(() => undefined);
      try {
        await store.createTask({ _id: id, connectorId: connector._id, status: "queued", payload, expiresAt: new Date(now() + taskTimeout) });
        wakeups.get(connector._id)?.();
        timer = setTimeout(() => pending.get(id)?.reject(fail(504, "LOCAL_MODEL_TIMEOUT", "Your computer took too long to respond. Try a smaller model.")), taskTimeout);
        return await result;
      } finally {
        clearTimeout(timer);
        pending.delete(id);
        await store.deleteTask(id);
      }
    },
  };
}
export const connectorService = createConnectorService();
