import assert from "node:assert/strict";
import { createServer } from "node:http";
import test from "node:test";
import express from "express";
import type { AddressInfo } from "node:net";
import type { AuthSessionRecord } from "../src/models/auth/authSession.model.js";
import type { AuthUserRecord } from "../src/models/auth/authUser.model.js";
import { apiErrorHandler } from "../src/middleware/apiErrorHandler.js";
import type { AuthHelpers } from "../src/helpers/auth/auth.helpers.js";
import type { TenantHelpers } from "../src/helpers/tenant/tenant.types.js";
import { createAuthRouter } from "../src/controllers/auth/index.js";

function createMemoryAuthHelpers(): AuthHelpers {
  const users = new Map<string, AuthUserRecord>();
  const sessions = new Map<string, AuthSessionRecord>();
  return {
    async createUser(input) {
      if (users.has(input.email)) throw { code: 11000 };
      const user: AuthUserRecord = {
        ...input,
        _id: `user-${users.size + 1}`,
        createdAt: new Date(),
        updatedAt: new Date(),
      };
      users.set(user.email, user);
      return user;
    },
    async findUserByEmail(email) {
      return users.get(email) ?? null;
    },
    async setActiveWorkspace(user_id, workspace_id) {
      const user = [...users.values()].find((item) => item._id === user_id);
      if (!user) throw new Error("User not found");
      user.active_workspace_id = workspace_id;
      return user;
    },
    async createDefaultWorkspace() {
      return `workspace-${users.size}` as never;
    },
    async createSession(input) {
      sessions.set(input.token_hash, { ...input, _id: `session-${sessions.size + 1}`, createdAt: new Date() });
    },
    async findUserBySessionHash(token_hash) {
      const session = sessions.get(token_hash);
      if (!session || session.expires_at <= new Date()) return null;
      return [...users.values()].find((user) => user._id === session.user_id) ?? null;
    },
    async deleteSession(token_hash) {
      sessions.delete(token_hash);
    },
  };
}

function createMemoryTenantHelpers(): TenantHelpers {
  const tenants = new Map<string, { _id: string; email?: string }>();
  return {
    async resolveTenant(email) {
      const tenant = tenants.get(email);
      return tenant ? { email, tenant_id: tenant._id } : null;
    },
    async createTenant(input) {
      const tenant = { ...input, _id: `tenant-${tenants.size + 1}` };
      return tenant as never;
    },
  };
}

test("auth routes register, restore, revoke, and gate bearer sessions", async () => {
  const helpers = createMemoryAuthHelpers();
  const app = express();
  app.use(express.json());
  app.use("/api/v1/auth", createAuthRouter(helpers, createMemoryTenantHelpers()));
  app.use(apiErrorHandler);
  const server = createServer(app);

  await new Promise<void>((resolve, reject) => {
    server.once("error", reject);
    server.listen(0, "127.0.0.1", resolve);
  });

  try {
    const address = server.address() as AddressInfo;
    const baseUrl = `http://127.0.0.1:${address.port}/api/v1/auth`;
    const registered = await fetch(`${baseUrl}/register`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ first_name: "Test", last_name: "User", email: "route@example.com", password: "correct horse battery staple" }),
    });
    assert.equal(registered.status, 201);
    const session = await registered.json() as { access_token: string; user: { email: string; role: string } };
    assert.equal(session.user.email, "route@example.com");
    assert.equal(session.user.role, "user");

    const duplicateRegistration = await fetch(`${baseUrl}/register`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ first_name: "Test", last_name: "User", email: "route@example.com", password: "correct horse battery staple" }),
    });
    assert.equal(duplicateRegistration.status, 409);

    const invalidLogin = await fetch(`${baseUrl}/login`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ email: "route@example.com", password: "wrong password" }),
    });
    assert.equal(invalidLogin.status, 401);

    const currentUser = await fetch(`${baseUrl}/me`, { headers: { Authorization: `Bearer ${session.access_token}` } });
    assert.equal(currentUser.status, 200);
    assert.equal((await currentUser.json() as { email: string }).email, "route@example.com");

    const logout = await fetch(`${baseUrl}/logout`, {
      method: "POST",
      headers: { Authorization: `Bearer ${session.access_token}` },
    });
    assert.equal(logout.status, 204);
    const revokedSession = await fetch(`${baseUrl}/me`, { headers: { Authorization: `Bearer ${session.access_token}` } });
    assert.equal(revokedSession.status, 401);

  } finally {
    await new Promise<void>((resolve, reject) => {
      server.close((error) => error ? reject(error) : resolve());
    });
  }
});
