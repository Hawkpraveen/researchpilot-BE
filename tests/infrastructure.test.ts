import assert from "node:assert/strict";
import test from "node:test";
import express from "express";
import type { AddressInfo } from "node:net";
import { createRateLimiter } from "../src/middleware/rateLimiter.js";
import { apiErrorHandler } from "../src/middleware/apiErrorHandler.js";
import { requestId } from "../src/middleware/requestId.js";
import { providerConfigSchema } from "../src/controllers/settings/settings.validation.js";
import { createProviderSettingsService } from "../src/services/settings/providerSettings.service.js";
import type { providerSettingsRepository } from "../src/repositories/settings/providerSettings.repository.js";

test("rate limits return 429, retry metadata, isolate keys and expire without evicting live counters", async () => {
  let clock = 1000;
  const app = express();
  app.use(requestId);
  app.use(createRateLimiter({
    maxAttempts: 2, windowMs: 1000, maxEntries: 2, code: "AUTH_RATE_LIMITED",
    now: () => clock, key: (request) => String(request.query.client ?? "a"),
  }));
  app.get("/", (_request, response) => { response.json({ ok: true }); });
  app.use(apiErrorHandler);
  const server = app.listen(0, "127.0.0.1");
  await new Promise<void>((resolve) => server.once("listening", resolve));
  const url = `http://127.0.0.1:${(server.address() as AddressInfo).port}/`;
  try {
    assert.equal((await fetch(url)).status, 200);
    assert.equal((await fetch(url)).status, 200);
    const limited = await fetch(url);
    assert.equal(limited.status, 429);
    assert.equal(limited.headers.get("retry-after"), "1");
    assert.equal(limited.headers.get("ratelimit-remaining"), "0");
    const body = await limited.json() as { error: { code: string; requestId: string; retryable: boolean } };
    assert.equal(body.error.code, "AUTH_RATE_LIMITED");
    assert.equal(body.error.requestId, limited.headers.get("x-request-id"));
    assert.equal(body.error.retryable, true);
    assert.equal((await fetch(`${url}?client=b`)).status, 200);
    assert.equal((await fetch(`${url}?client=c`)).status, 429);
    assert.equal((await fetch(url)).status, 429);
    clock += 1000;
    assert.equal((await fetch(url)).status, 200);
  } finally {
    server.closeAllConnections();
    await new Promise<void>((resolve, reject) => server.close((error) => error ? reject(error) : resolve()));
  }
});

const input = { mode: "local", provider: "ollama", endpoint: "http://localhost:11434", model: "llama3.1", apiKey: "secret" } as const;

test("settings validation rejects non-HTTP endpoints and embedded credentials", () => {
  assert.equal(providerConfigSchema.safeParse(input).success, true);
  for (const endpoint of ["not a URL", "file:///etc/passwd", "ftp://localhost", "http://name:secret@localhost"]) {
    assert.equal(providerConfigSchema.safeParse({ ...input, endpoint }).success, false);
  }
});

test("settings service preserves workspace scope, redacts secrets, and reports failed probes", async () => {
  const scope = { tenant_id: "tenant-a", workspace_id: "workspace-a" };
  const stored = { ...input, api_key: "persisted-secret" };
  const calls: unknown[] = [];
  const repository = {
    async find(actualScope) { calls.push(actualScope); return stored; },
    async save(actualScope, userId, config) { calls.push([actualScope, userId, config]); return stored; },
  } as unknown as typeof providerSettingsRepository;
  const service = createProviderSettingsService(repository, async () => new Response(null, { status: 503 }));
  const view = await service.get(scope);
  assert.equal(view.apiKey, "");
  assert.equal("api_key" in view, false);
  assert.deepEqual(await service.save(scope, "user-a", input), view);
  assert.equal((await service.test(scope)).connected, false);
  assert.deepEqual(calls[0], scope);
  assert.deepEqual(calls[1], [scope, "user-a", input]);
  const missing = createProviderSettingsService({ ...repository, async find() { return null; } });
  await assert.rejects(missing.test(scope), { code: "PROVIDER_NOT_CONFIGURED", statusCode: 404 });
  assert.equal((await missing.get(scope)).provider, "ollama");
});
