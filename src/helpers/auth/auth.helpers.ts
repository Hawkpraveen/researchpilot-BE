import { messages } from "../../config/messages.js";
import { createHash } from "node:crypto";
import type { Request, Response } from "express";
import { Types } from "mongoose";
import { AuthSessionModel } from "../../models/auth/authSession.model.js";
import { AuthUserModel } from "../../models/auth/authUser.model.js";
import type { AuthUserView } from "../../controllers/auth/auth.types.js";
import { createAppError } from "../../utils/AppError.js";
import {
  AuthSessionRecord,
  AuthUserRecord,
} from "../../models/auth/authUsers.types.js";
import { AuthHelpers } from "./auth.types.js";
import { WorkSpaceModel } from "../../models/workspace/workspace.js";

export const authHelpers: AuthHelpers = {
  // create a new user
  async createUser(user) {
    return (await AuthUserModel.create(user)).toObject() as AuthUserRecord;
  },
  findUserByEmail(email) {
    return AuthUserModel.findOne({ email })
      .select("+password")
      .lean<AuthUserRecord>()
      .exec();
  },
  updateProfile(user_id, profile) {
    const { profile_url, ...names } = profile;
    const update: { $set?: typeof names & { profile_url?: string }; $unset?: { profile_url: number } } = {};
    if (Object.keys(names).length > 0 || typeof profile_url === "string") {
      update.$set = { ...names, ...(typeof profile_url === "string" ? { profile_url } : {}) };
    }
    if (profile_url === null) update.$unset = { profile_url: 1 };
    return AuthUserModel.findByIdAndUpdate(user_id, update, { new: true, runValidators: true })
      .lean<AuthUserRecord>()
      .exec();
  },
  async setActiveWorkspace(user_id, workspace_id) {
    const user = await AuthUserModel.findByIdAndUpdate(user_id, { $set: { active_workspace_id: workspace_id } }, { new: true })
      .select("+password").lean<AuthUserRecord>().exec();
    if (!user) throw createAppError(404, "USER_NOT_FOUND", "The user account could not be found.");
    return user;
  },
  async createDefaultWorkspace(user) {
    const workspace = await WorkSpaceModel.create({ tenant_id: user.tenant_id, user_id: user._id, workspace_name: "Personal workspace", slug: `personal-${user._id.toString()}`, status: "active", deleted_status: false, is_verified: true, verified_date: new Date(), created_by: user._id });
    return workspace._id;
  },

  // create a new auth session
  async createSession(session) {
    await AuthSessionModel.create(session);
  },
  async findUserBySessionHash(token_hash) {
    const session = await AuthSessionModel.findOne({
      token_hash,
      expires_at: { $gt: new Date() },
    })
      .select("+token_hash")
      .lean<AuthSessionRecord>()
      .exec();
    if (!session) return null;
    // Older sessions can reference a deleted or pre-ObjectId user. Treat them
    // as expired rather than allowing Mongoose to throw a CastError (500).
    if (!Types.ObjectId.isValid(session.user_id)) return null;
    return AuthUserModel.findById(session.user_id)
      .lean<AuthUserRecord>()
      .exec();
  },
  async deleteSession(token_hash) {
    await AuthSessionModel.deleteOne({ token_hash }).exec();
  },
};

export function hashToken(token: string) {
  return createHash("sha256").update(token).digest("hex");
}

export function toAuthUserView(user: AuthUserRecord): AuthUserView {
  if (!user.active_workspace_id) throw createAppError(409, "WORKSPACE_REQUIRED", "This account does not have an active workspace.");
  return {
    id: user._id,
    tenant_id: user.tenant_id,
    workspace_id: user.active_workspace_id,
    email: user.email,
    first_name: user.first_name,
    last_name: user.last_name,
    auth_type: user.auth_type,
    ...(user.profile_url ? { profile_url: user.profile_url } : {}),
    role: user.active_role_key,
    twoFactorEnabled: false,
  };
}

export function isDuplicateKeyError(error: unknown): error is { code: number } {
  return (
    typeof error === "object" &&
    error !== null &&
    "code" in error &&
    error.code === 11000
  );
}

export function readBearerToken(request: Request) {
  const authorization = request.header("authorization");
  const match = authorization?.match(/^Bearer\s+(.+)$/i);
  if (!match)
    throw createAppError(
      401,
      "AUTHENTICATION_REQUIRED",
      messages.AUTHENTICATION_REQUIRED,
    );
  return match[1];
}

export function getAuthenticatedUser(response: Response): AuthUserView {
  const user = response.locals.authUser as AuthUserView | undefined;
  if (!user)
    throw createAppError(
      401,
      "AUTHENTICATION_REQUIRED",
      messages.AUTHENTICATION_REQUIRED,
    );
  return user;
}
