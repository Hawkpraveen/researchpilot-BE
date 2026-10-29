import assert from "node:assert/strict";
import test from "node:test";
import { createConnectorService } from "../src/services/connectors/connector.service.js";
import type { ConnectorStore, ConnectorRecord, ConnectorTask, PairingRecord, ConnectorScope } from "../src/models/connectors/connector.types.js";

function memoryStore(): ConnectorStore {
  const pairs = new Map<string, PairingRecord>(), computers = new Map<string, ConnectorRecord>(), tasks = new Map<string, ConnectorTask>();
  const matches = (record: ConnectorScope, scope: ConnectorScope) => record.tenantId === scope.tenantId && record.workspaceId === scope.workspaceId && record.userId === scope.userId;
  return {
    async createPairing(record) { for (const [id, pair] of pairs) if (matches(pair, record)) pairs.delete(id); pairs.set(record._id, record); },
    async consumePairing(hash, now) { const pair = pairs.get(hash); if (!pair || pair.expiresAt <= now) return null; pairs.delete(hash); return pair; },
    async replace(record) { computers.set(record._id, record); },
    async find(scope) { return [...computers.values()].find(record => matches(record, scope)) ?? null; },
    async authenticate(hash, now) { return [...computers.values()].find(record => record.tokenHash === hash && record.expiresAt > now) ?? null; },
    async heartbeat(id, models, now) { const computer = computers.get(id); if (computer) { computer.models = models; computer.lastSeen = now; } },
    async revoke(scope) { const computer = await this.find(scope); if (computer) computers.delete(computer._id); return computer; },
    async createTask(task) { tasks.set(task._id, task); },
    async claim(id, now) { const task = [...tasks.values()].find(task => task.connectorId === id && task.status === "queued" && task.expiresAt > now); if (task) task.status = "running"; return task ?? null; },
    async finishTask(id, connectorId, now) { const task = tasks.get(id); if (!task || task.connectorId !== connectorId || task.status !== "running" || task.expiresAt <= now) return null; tasks.delete(id); return task; },
    async deleteTask(id) { tasks.delete(id); },
  };
}
const scope = { tenantId: "tenant", workspaceId: "workspace", userId: "owner" };
const payload = { model: "llama3.2:3b", messages: [], stream: false, format: {}, options: {} };

test("pairing is scoped, single-use, expires, and connector secrets never appear in status", async () => {
  let time = 1_000_000;
  const service = createConnectorService(memoryStore(), () => time, 115_000, 0);
  const pairing = await service.createPairing(scope);
  const device = await service.pair(pairing.code, "Laptop");
  await assert.rejects(service.pair(pairing.code, "Other laptop"), { code: "PAIRING_EXPIRED" });
  await service.poll(device.token, [payload.model]);
  const status = await service.status(scope);
  assert.equal(status.connected, true);
  assert.equal(JSON.stringify(status).includes(device.token), false);
  for (const other of [{ ...scope, userId: "other" }, { ...scope, tenantId: "other" }, { ...scope, workspaceId: "other" }]) assert.equal((await service.status(other)).connected, false);
  const expiring = await service.createPairing({ ...scope, userId: "second" });
  time += 121_000;
  await assert.rejects(service.pair(expiring.code, "Laptop"), { code: "PAIRING_EXPIRED" });
  assert.equal((await service.status(scope)).connected, false);
});

test("only the paired computer can claim and complete its model task; relay binds model and owner", async () => {
  const service = createConnectorService(memoryStore(), Date.now, 115_000, 0);
  const first = await service.pair((await service.createPairing(scope)).code, "Laptop A");
  const second = await service.pair((await service.createPairing({ ...scope, userId: "second" })).code, "Laptop B");
  await service.poll(first.token, [payload.model]);
  await service.poll(second.token, [payload.model]);
  const capability = service.mintRelay(scope, payload.model);
  await assert.rejects(service.relay(capability, { ...payload, model: "other" }), { code: "CONNECTOR_RELAY_INVALID" });
  const generation = service.relay(capability, payload);
  let task = null;
  for (let attempt = 0; !task && attempt < 20; attempt++) {
    await new Promise(resolve => setTimeout(resolve, 1));
    assert.equal((await service.poll(second.token, [payload.model])).task, null);
    task = (await service.poll(first.token, [payload.model])).task;
  }
  assert.ok(task);
  assert.equal((await service.poll(first.token, [payload.model])).task, null);
  await assert.rejects(service.complete(second.token, task.id, { message: { content: "stolen" } }), { code: "CONNECTOR_TASK_EXPIRED" });
  await service.complete(first.token, task.id, { message: { content: "correct" } });
  assert.deepEqual(await generation, { message: { content: "correct" } });
  await assert.rejects(service.complete(first.token, task.id, {}), { code: "CONNECTOR_TASK_EXPIRED" });
});

test("revocation stops in-flight work and immediately invalidates device credentials", async () => {
  const service = createConnectorService(memoryStore(), Date.now, 115_000, 0);
  const device = await service.pair((await service.createPairing(scope)).code, "Laptop");
  await service.poll(device.token, [payload.model]);
  const result = service.relay(service.mintRelay(scope, payload.model), payload);
  const failure = assert.rejects(result, { code: "CONNECTOR_DISCONNECTED" });
  await new Promise(resolve => setTimeout(resolve, 1));
  await service.revoke({ ...scope, userId: "other" });
  assert.equal((await service.status(scope)).connected, true);
  await service.revoke(scope);
  await failure;
  await assert.rejects(service.poll(device.token, []), { code: "CONNECTOR_REVOKED" });
});

test("unavailable computers and absent models fail without sending work elsewhere", async () => {
  const service = createConnectorService(memoryStore(), Date.now, 115_000, 0);
  const capability = service.mintRelay(scope, payload.model);
  await assert.rejects(service.relay(capability, payload), { code: "CONNECTOR_OFFLINE" });
  const device = await service.pair((await service.createPairing(scope)).code, "Laptop");
  await service.poll(device.token, []);
  await assert.rejects(service.relay(capability, payload), { code: "LOCAL_MODEL_MISSING" });
});

test("long polling wakes when a model request arrives", async () => {
  const service = createConnectorService(memoryStore(), Date.now, 1000, 500);
  const device = await service.pair((await service.createPairing(scope)).code, "Laptop");
  const polling = service.poll(device.token, [payload.model]);
  await new Promise(resolve => setTimeout(resolve, 5));
  const generation = service.relay(service.mintRelay(scope, payload.model), payload);
  const { task } = await polling;
  assert.ok(task);
  await service.complete(device.token, task.id, { message: { content: "{}" } });
  assert.deepEqual(await generation, { message: { content: "{}" } });
});

