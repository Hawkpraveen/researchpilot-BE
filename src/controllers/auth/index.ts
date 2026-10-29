import { Router } from "express";
import express from "express";
import { authHelpers } from "../../helpers/auth/auth.helpers.js";
import type { AuthHelpers } from "../../helpers/auth/auth.types.js";
import { tenantHelpers } from "../../helpers/tenant/tenants.helpers.js";
import type { TenantHelpers } from "../../helpers/tenant/tenant.types.js";
import { createRequireAuth } from "../../middleware/requireAuth.js";
import { createAuthRateLimiter } from "../../middleware/authRateLimiter.js";
import { asyncHandler } from "../../utils/asyncHandler.js";
import { createAuthController } from "./auth.controller.js";

export function createAuthRouter(
  helpers: AuthHelpers = authHelpers,
  tenantHelperOverrides: TenantHelpers = tenantHelpers,
) {
  const router = Router();
  const controller = createAuthController(helpers, tenantHelperOverrides);
  const limitAuthenticationAttempts = createAuthRateLimiter();
  const requireAuth = createRequireAuth(helpers);

  router.post(
    "/register",
    limitAuthenticationAttempts,
    asyncHandler(controller.register),
  );

  router.post(
    "/login",
    limitAuthenticationAttempts,
    asyncHandler(controller.login),
  );

  router.post("/google", limitAuthenticationAttempts, asyncHandler(controller.google));
  router.post("/microsoft", limitAuthenticationAttempts, asyncHandler(controller.microsoft));

  router.get("/me", requireAuth, asyncHandler(controller.currentUser));
  router.put("/profile", requireAuth, asyncHandler(controller.updateProfile));
  router.put("/profile/avatar", requireAuth, express.raw({ type: ["image/png", "image/jpeg", "image/webp"], limit: "512kb" }), asyncHandler(controller.updateAvatar));
  router.delete("/profile/avatar", requireAuth, asyncHandler(controller.deleteAvatar));

  router.post("/logout", requireAuth, asyncHandler(controller.logout));
  return router;
}
