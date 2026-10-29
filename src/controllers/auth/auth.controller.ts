import { randomBytes } from "node:crypto";
import type { RequestHandler } from "express";
import {
  authHelpers,
  hashToken,
  isDuplicateKeyError,
  getAuthenticatedUser,
  readBearerToken,
  toAuthUserView,
} from "../../helpers/auth/auth.helpers.js";
import {
  hashPassword,
  verifyPassword,
} from "../../helpers/auth/password.helpers.js";
import { createAppError, isAppError } from "../../utils/AppError.js";
import { loginSchema, registerSchema, updateProfileSchema } from "./auth.validation.js";
import type { AuthSessionView } from "./auth.types.js";
import { AuthUserRecord } from "../../models/auth/authUsers.types.js";
import { TenantHelpers } from "../../helpers/tenant/tenant.types.js";
import { AuthHelpers } from "../../helpers/auth/auth.types.js";
import { tenantHelpers } from "../../helpers/tenant/tenants.helpers.js";
import { verifyGoogleIdToken, verifyMicrosoftIdToken } from "../../helpers/auth/oauth.helpers.js";
import type { GoogleClaims, MicrosoftClaims } from "../../helpers/auth/oauth.helpers.js";
import { z } from "zod";

const SESSION_LIFETIME_MS = 7 * 24 * 60 * 60 * 1000;
const dummyPasswordHash =
  "scrypt$00000000000000000000000000000000$" + "0".repeat(128);
export function createAuthController(
  helpers: AuthHelpers = authHelpers,
  tenant_helpers: TenantHelpers = tenantHelpers,
) {
  async function ensureDefaultWorkspace(user: AuthUserRecord) {
    if (user.active_workspace_id) return user;
    const workspace_id = await helpers.createDefaultWorkspace(user);
    return helpers.setActiveWorkspace(user._id, workspace_id);
  }

  async function createSession(user: AuthUserRecord): Promise<AuthSessionView> {
    const access_token = randomBytes(32).toString("base64url");
    const expires_at = new Date(Date.now() + SESSION_LIFETIME_MS);
    await helpers.createSession({
      user_id: user._id,
      token_hash: hashToken(access_token),
      expires_at,
    });
    return {
      user: toAuthUserView(user),
      access_token,
      expires_at: expires_at.toISOString(),
    };
  }

  const register: RequestHandler = async (request, response) => {
    const input = registerSchema.parse(request.body);
    const existingTenant = await tenant_helpers.resolveTenant(input.email);
    if (existingTenant) {
      throw createAppError(
        409,
        "EMAIL_ALREADY_REGISTERED",
        "An account with this email already exists. Please sign in.",
      );
    }

    try {
      const identifier = randomBytes(8).toString("hex");
      const baseSlug =
        input.email
          .split("@", 1)[0]
          .toLowerCase()
          .replace(/[^a-z0-9]+/g, "-")
          .replace(/^-|-$/g, "") || "workspace";
      const tenant = await tenant_helpers.createTenant({
        name: `${input.first_name} ${input.last_name}'s workspace`,
        slug: `${baseSlug}-${identifier}`,
        tenant_key: randomBytes(20).toString("base64url"),
        status: "active",
        deleted_status: false,
        is_verified: false,
        registration_source: "self_email",
      });
      let user = await helpers.createUser({
        email: input.email,
        first_name: input.first_name,
        last_name: input.last_name,
        password: await hashPassword(input.password),
        active_role_key: "user",
        tenant_id: tenant._id,
      });
      user = await ensureDefaultWorkspace(user);
      response.status(201).json(await createSession(user));
    } catch (error) {
      if (isDuplicateKeyError(error)) {
        throw createAppError(
          409,
          "EMAIL_ALREADY_REGISTERED",
          "An account with this email already exists.",
        );
      }
      throw error;
    }
  };

  const login: RequestHandler = async (request, response) => {
    const input = loginSchema.parse(request.body);
    let user = await helpers.findUserByEmail(input.email);
    const passwordMatches = await verifyPassword(
      input.password,
      user?.password ?? dummyPasswordHash,
    );
    if (!user || !passwordMatches) {
      throw createAppError(
        401,
        "INVALID_CREDENTIALS",
        "Email or password is incorrect.",
      );
    }
    user = await ensureDefaultWorkspace(user);
    response.status(200).json(await createSession(user));
  };

  const oauthLogin = (provider: "google" | "microsoft"): RequestHandler => async (request, response) => {
    const { id_token } = z.object({ id_token: z.string().min(1) }).strict().parse(request.body);
    const clientId = process.env[provider === "google" ? "GOOGLE_CLIENT_ID" : "MICROSOFT_CLIENT_ID"];
    if (!clientId || clientId === "***" || clientId.startsWith("your-")) {
      throw createAppError(503, "OAUTH_NOT_CONFIGURED", `${provider === "google" ? "Google" : "Microsoft"} sign-in is not configured on the API.`, true);
    }
    let claims: GoogleClaims | MicrosoftClaims;
    try {
      claims = provider === "google" ? await verifyGoogleIdToken(id_token) : await verifyMicrosoftIdToken(id_token);
    } catch (error) {
      if (isAppError(error)) throw error;
      throw createAppError(401, "OAUTH_TOKEN_INVALID", `The ${provider === "google" ? "Google" : "Microsoft"} sign-in token is invalid or expired.`);
    }
    let user = await helpers.findUserByEmail(claims.email);
    const googleClaims = provider === "google" ? claims as GoogleClaims : null;
    const microsoftClaims = provider === "microsoft" ? claims as MicrosoftClaims : null;
    const providerId = googleClaims?.sub ?? microsoftClaims?.oid;
    const linked = googleClaims ? user?.google_sub === providerId : user?.microsoft_oid === providerId;
    if (user && linked) {
      user = await ensureDefaultWorkspace(user);
      response.status(200).json(await createSession(user));
      return;
    }
    if (user?.password) {
      throw createAppError(409, "OAUTH_LINK_REQUIRED", "This email already has a password account. Sign in with your password first, then link OAuth.");
    }
    const first_name = provider === "google" ? claims.given_name || "Google" : claims.given_name || "Microsoft";
    const last_name = provider === "google" ? claims.family_name || "User" : claims.family_name || "User";
    const tenant = await tenant_helpers.createTenant({
      name: `${first_name} ${last_name}'s workspace`,
      slug: `${provider}-${randomBytes(8).toString("hex")}`,
      tenant_key: randomBytes(20).toString("base64url"),
      status: "active",
      deleted_status: false,
      is_verified: true,
      registration_source: provider === "google" ? "self_google" : "self_microsoft",
    });
    let created = await helpers.createUser({
      email: claims.email,
      first_name,
      last_name,
      active_role_key: "user",
      tenant_id: tenant._id,
      auth_type: provider,
      is_verified: true,
      ...(googleClaims ? { google_sub: googleClaims.sub, profile_url: googleClaims.picture } : { microsoft_oid: microsoftClaims!.oid, microsoft_tenant_id: microsoftClaims!.tid, ms_account_type: "organization" }),
    });
    created = await ensureDefaultWorkspace(created);
    response.status(201).json(await createSession(created));
  };

  const currentUser: RequestHandler = async (request, response) => {
    let user = await helpers.findUserBySessionHash(
      hashToken(readBearerToken(request)),
    );
    if (!user)
      throw createAppError(
        401,
        "SESSION_INVALID",
        "Your session is invalid or has expired.",
      );
    user = await ensureDefaultWorkspace(user);
    response.status(200).json(toAuthUserView(user));
  };

  const updateProfile: RequestHandler = async (request, response) => {
    const input = updateProfileSchema.parse(request.body);
    const currentUser = getAuthenticatedUser(response);
    if (!helpers.updateProfile) throw createAppError(501, "PROFILE_UPDATE_UNAVAILABLE", "Profile editing is not available.");
    const user = await helpers.updateProfile(currentUser.id, input);
    if (!user) throw createAppError(404, "USER_NOT_FOUND", "The user account could not be found.");
    response.status(200).json(toAuthUserView(user));
  };

  const updateAvatar: RequestHandler = async (request, response) => {
    const currentUser = getAuthenticatedUser(response);
    if (!helpers.updateProfile) throw createAppError(501, "PROFILE_UPDATE_UNAVAILABLE", "Profile picture editing is not available.");
    if (!Buffer.isBuffer(request.body) || request.body.length < 12) throw createAppError(400, "INVALID_PROFILE_PICTURE", "Choose a valid PNG, JPEG, or WebP image.");
    const body = request.body as Buffer;
    const contentType = request.header("content-type")?.split(";")[0].trim().toLowerCase();
    const isPng = body.subarray(0, 8).equals(Buffer.from([137, 80, 78, 71, 13, 10, 26, 10]));
    const isJpeg = body[0] === 0xff && body[1] === 0xd8 && body[2] === 0xff;
    const isWebp = body.toString("ascii", 0, 4) === "RIFF" && body.toString("ascii", 8, 12) === "WEBP";
    const mimeType = isPng ? "image/png" : isJpeg ? "image/jpeg" : isWebp ? "image/webp" : null;
    if (!mimeType || mimeType !== contentType) throw createAppError(415, "INVALID_PROFILE_PICTURE", "Upload a valid PNG, JPEG, or WebP image.");
    const user = await helpers.updateProfile(currentUser.id, { profile_url: `data:${mimeType};base64,${body.toString("base64")}` });
    if (!user) throw createAppError(404, "USER_NOT_FOUND", "The user account could not be found.");
    response.status(200).json(toAuthUserView(user));
  };

  const deleteAvatar: RequestHandler = async (_request, response) => {
    const currentUser = getAuthenticatedUser(response);
    if (!helpers.updateProfile) throw createAppError(501, "PROFILE_UPDATE_UNAVAILABLE", "Profile picture editing is not available.");
    const user = await helpers.updateProfile(currentUser.id, { profile_url: null });
    if (!user) throw createAppError(404, "USER_NOT_FOUND", "The user account could not be found.");
    response.status(200).json(toAuthUserView(user));
  };

  const logout: RequestHandler = async (request, response) => {
    await helpers.deleteSession(hashToken(readBearerToken(request)));
    response.status(204).end();
  };

  return { register, login, google: oauthLogin("google"), microsoft: oauthLogin("microsoft"), currentUser, updateProfile, updateAvatar, deleteAvatar, logout };
}
