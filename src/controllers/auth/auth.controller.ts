import { randomBytes } from "node:crypto";
import type { RequestHandler } from "express";
import { authHelpers, hashToken, isDuplicateKeyError, readBearerToken, toAuthUserView } from "../../helpers/auth/auth.helpers.js";
import type { AuthHelpers } from "../../helpers/auth/auth.helpers.js";
import type { AuthUserRecord } from "../../models/auth/authUser.model.js";
import { hashPassword, verifyPassword } from "../../helpers/auth/password.helpers.js";
import { createAppError } from "../../utils/AppError.js";
import { loginSchema, registerSchema } from "./auth.validation.js";
import type { AuthSessionView } from "./auth.types.js";

const SESSION_LIFETIME_MS = 7 * 24 * 60 * 60 * 1000;
const dummyPasswordHash = "scrypt$00000000000000000000000000000000$" + "0".repeat(128);

export function createAuthController(helpers: AuthHelpers = authHelpers) {
  async function createSession(user: AuthUserRecord): Promise<AuthSessionView> {
    const accessToken = randomBytes(32).toString("base64url");
    const expiresAt = new Date(Date.now() + SESSION_LIFETIME_MS);
    await helpers.createSession({
      userId: user._id,
      tokenHash: hashToken(accessToken),
      expiresAt,
    });
    return { user: toAuthUserView(user), accessToken, expiresAt: expiresAt.toISOString() };
  }

  const register: RequestHandler = async (request, response) => {
    const input = registerSchema.parse(request.body);
    let user;
    try {
      user = await helpers.createUser({
        email: input.email,
        name: input.name,
        passwordHash: await hashPassword(input.password),
        role: "user",
      });
    } catch (error) {
      if (isDuplicateKeyError(error)) {
        throw createAppError(409, "EMAIL_ALREADY_REGISTERED", "An account with this email already exists.");
      }
      throw error;
    }
    response.status(201).json(await createSession(user));
  };

  const login: RequestHandler = async (request, response) => {
    const input = loginSchema.parse(request.body);
    const user = await helpers.findUserByEmail(input.email);
    const passwordMatches = await verifyPassword(input.password, user?.passwordHash ?? dummyPasswordHash);
    if (!user || !passwordMatches) {
      throw createAppError(401, "INVALID_CREDENTIALS", "Email or password is incorrect.");
    }
    response.status(200).json(await createSession(user));
  };

  const currentUser: RequestHandler = async (request, response) => {
    const user = await helpers.findUserBySessionHash(hashToken(readBearerToken(request)));
    if (!user) throw createAppError(401, "SESSION_INVALID", "Your session is invalid or has expired.");
    response.status(200).json(toAuthUserView(user));
  };

  const logout: RequestHandler = async (request, response) => {
    await helpers.deleteSession(hashToken(readBearerToken(request)));
    response.status(204).end();
  };

  const demo: RequestHandler = async (_request, response) => {
    let user = await helpers.findUserByEmail("demo@researchpilot.local");
    if (!user) {
      try {
        user = await helpers.createUser({
          email: "demo@researchpilot.local",
          name: "Demo User",
          passwordHash: await hashPassword(randomBytes(32).toString("hex")),
          role: "user",
        });
      } catch (error) {
        if (!isDuplicateKeyError(error)) throw error;
        user = await helpers.findUserByEmail("demo@researchpilot.local");
      }
    }
    if (!user) throw createAppError(500, "DEMO_USER_UNAVAILABLE", "The demo account could not be created.");
    response.status(200).json(await createSession(user));
  };

  return { register, login, currentUser, logout, demo };
}
