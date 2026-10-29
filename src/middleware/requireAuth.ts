import { messages } from "../config/messages.js";
import type { RequestHandler } from "express";
import type { AuthHelpers } from "../helpers/auth/auth.types.js";
import { authHelpers, hashToken, readBearerToken, toAuthUserView } from "../helpers/auth/auth.helpers.js";
import { createAppError } from "../utils/AppError.js";

export { type AuthUserView as AuthenticatedRequestUser } from "../controllers/auth/auth.types.js";

export function createRequireAuth(helpers: AuthHelpers = authHelpers): RequestHandler {
  return async (request, response, next) => {
    try {
      let user = await helpers.findUserBySessionHash(hashToken(readBearerToken(request)));
      if (!user) throw createAppError(401, "SESSION_INVALID", messages.SESSION_INVALID);
      if (!user.active_workspace_id) {
        const workspaceId = await helpers.createDefaultWorkspace(user);
        user = await helpers.setActiveWorkspace(user._id, workspaceId);
      }
      response.locals.authUser = toAuthUserView(user);
      next();
    } catch (error) {
      next(error);
    }
  };
}

export const requireAuth = createRequireAuth();
