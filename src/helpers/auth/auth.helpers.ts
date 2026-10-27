import { createHash } from "node:crypto";
import type { Request, Response } from "express";
import { AuthSessionModel } from "../../models/auth/authSession.model.js";
import type { AuthSessionRecord } from "../../models/auth/authSession.model.js";
import { AuthUserModel } from "../../models/auth/authUser.model.js";
import type { AuthUserRecord } from "../../models/auth/authUser.model.js";
import type { AuthUserView } from "../../controllers/auth/auth.types.js";
import { createAppError } from "../../utils/AppError.js";

export interface AuthHelpers {
  createUser(user: Pick<AuthUserRecord, "email" | "name" | "passwordHash" | "role">): Promise<AuthUserRecord>;
  findUserByEmail(email: string): Promise<AuthUserRecord | null>;
  createSession(session: Pick<AuthSessionRecord, "userId" | "tokenHash" | "expiresAt">): Promise<void>;
  findUserBySessionHash(tokenHash: string): Promise<AuthUserRecord | null>;
  deleteSession(tokenHash: string): Promise<void>;
}

export const authHelpers: AuthHelpers = {
  async createUser(user) {
    return (await AuthUserModel.create(user)).toObject() as AuthUserRecord;
  },
  findUserByEmail(email) {
    return AuthUserModel.findOne({ email }).select("+passwordHash").lean<AuthUserRecord>().exec();
  },
  async createSession(session) {
    await AuthSessionModel.create(session);
  },
  async findUserBySessionHash(tokenHash) {
    const session = await AuthSessionModel.findOne({ tokenHash, expiresAt: { $gt: new Date() } })
      .select("+tokenHash")
      .lean<AuthSessionRecord>()
      .exec();
    if (!session) return null;
    return AuthUserModel.findById(session.userId).lean<AuthUserRecord>().exec();
  },
  async deleteSession(tokenHash) {
    await AuthSessionModel.deleteOne({ tokenHash }).exec();
  },
};

export function hashToken(token: string) {
  return createHash("sha256").update(token).digest("hex");
}

export function toAuthUserView(user: AuthUserRecord): AuthUserView {
  return {
    id: user._id,
    email: user.email,
    name: user.name,
    role: user.role,
    twoFactorEnabled: false,
  };
}

export function isDuplicateKeyError(error: unknown): error is { code: number } {
  return typeof error === "object" && error !== null && "code" in error && error.code === 11000;
}

export function readBearerToken(request: Request) {
  const authorization = request.header("authorization");
  const match = authorization?.match(/^Bearer\s+(.+)$/i);
  if (!match) throw createAppError(401, "AUTHENTICATION_REQUIRED", "Sign in to continue.");
  return match[1];
}

export function getAuthenticatedUser(response: Response): AuthUserView {
  const user = response.locals.authUser as AuthUserView | undefined;
  if (!user) throw createAppError(401, "AUTHENTICATION_REQUIRED", "Sign in to continue.");
  return user;
}
