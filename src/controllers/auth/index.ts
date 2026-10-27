import { Router } from "express";
import { authHelpers } from "../../helpers/auth/auth.helpers.js";
import type { AuthHelpers } from "../../helpers/auth/auth.helpers.js";
import { createRequireAuth } from "../../middleware/requireAuth.js";
import { createAuthRateLimiter } from "../../middleware/authRateLimiter.js";
import { asyncHandler } from "../../utils/asyncHandler.js";
import { createAuthController } from "./auth.controller.js";

export function createAuthRouter(allowDemo: boolean, helpers: AuthHelpers = authHelpers) {
  const router = Router();
  const controller = createAuthController(helpers);
  const limitAuthenticationAttempts = createAuthRateLimiter();
  const requireAuth = createRequireAuth(helpers);

  router.post("/register", limitAuthenticationAttempts, asyncHandler(controller.register));
  router.post("/login", limitAuthenticationAttempts, asyncHandler(controller.login));
  router.get("/me", requireAuth, asyncHandler(controller.currentUser));
  router.post("/logout", requireAuth, asyncHandler(controller.logout));
  if (allowDemo) router.post("/demo", limitAuthenticationAttempts, asyncHandler(controller.demo));

  return router;
}
