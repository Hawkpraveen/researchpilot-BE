import { Router } from "express";
import { requireAuth } from "../../middleware/requireAuth.js";
import { createUserRateLimiter } from "../../middleware/rateLimiter.js";
import { asyncHandler } from "../../utils/asyncHandler.js";
import { createSettingsController } from "./settings.controller.js";
export function createSettingsRouter() {
  const router = Router();
  const controller = createSettingsController();
  router.use(requireAuth);
  router.get("/provider", asyncHandler(controller.getProvider));
  router.put("/provider", asyncHandler(controller.saveProvider));
  router.post("/provider/test", createUserRateLimiter("providerTest"), asyncHandler(controller.testProvider));
  router.get("/workspace", asyncHandler(controller.getWorkspace));
  router.put("/workspace", asyncHandler(controller.renameWorkspace));
  return router;
}
