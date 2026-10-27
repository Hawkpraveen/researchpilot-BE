import { Router } from "express";
import { createHealthController } from "./health.controller.js";

export function createHealthRouter() {
  const router = Router();
  const controller = createHealthController();
  router.get("/", controller.getHealth);
  return router;
}
