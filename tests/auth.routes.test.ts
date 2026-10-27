import assert from "node:assert/strict";
import { createServer } from "node:http";
import test from "node:test";
import express from "express";
import type { AddressInfo } from "node:net";
import type { AuthSessionRecord } from "../src/models/auth/authSession.model.js";
import type { AuthUserRecord } from "../src/models/auth/authUser.model.js";
import { apiErrorHandler } from "../src/middleware/apiErrorHandler.js";
import type { AuthHelpers } from "../src/helpers/auth/auth.helpers.js";
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
    async createSession(input) {
      sessions.set(input.tokenHash, { ...input, _id: `session-${sessions.size + 1}`, createdAt: new Date() });
    },
    async findUserBySessionHash(tokenHash) {
      const session = sessions.get(tokenHash);
      if (!session || session.expiresAt <= new Date()) return null;
      return [...users.values()].find((user) => user._id === session.userId) ?? null;
    },
    async deleteSession(tokenHash) {
      sessions.delete(tokenHash);
    },
  };
}

test("auth routes register, restore, revoke, and gate bearer sessions", async () => {
  const helpers = createMemoryAuthHelpers();
  const app = express();
  app.use(express.json());
  app.use("/api/v1/auth", createAuthRouter(true, helpers));
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
      body: JSON.stringify({ name: "Test User", email: "route@example.com", password: "correct horse battery staple" }),
    });
    assert.equal(registered.status, 201);
    const session = await registered.json() as { accessToken: string; user: { email: string; role: string } };
    assert.equal(session.user.email, "route@example.com");
    assert.equal(session.user.role, "user");

    const duplicateRegistration = await fetch(`${baseUrl}/register`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ name: "Test User", email: "route@example.com", password: "correct horse battery staple" }),
    });
    assert.equal(duplicateRegistration.status, 409);

    const invalidLogin = await fetch(`${baseUrl}/login`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ email: "route@example.com", password: "wrong password" }),
    });
    assert.equal(invalidLogin.status, 401);

    const currentUser = await fetch(`${baseUrl}/me`, { headers: { Authorization: `Bearer ${session.accessToken}` } });
    assert.equal(currentUser.status, 200);
    assert.equal((await currentUser.json() as { email: string }).email, "route@example.com");

    const logout = await fetch(`${baseUrl}/logout`, {
      method: "POST",
      headers: { Authorization: `Bearer ${session.accessToken}` },
    });
    assert.equal(logout.status, 204);
    const revokedSession = await fetch(`${baseUrl}/me`, { headers: { Authorization: `Bearer ${session.accessToken}` } });
    assert.equal(revokedSession.status, 401);

    const demoSession = await fetch(`${baseUrl}/demo`, { method: "POST" });
    assert.equal(demoSession.status, 200);
  } finally {
    await new Promise<void>((resolve, reject) => {
      server.close((error) => error ? reject(error) : resolve());
    });
  }
});
