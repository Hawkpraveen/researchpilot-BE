import type { RequestHandler } from "express";
import { rateLimiterRegistry } from "../config/rateLimiterRegistry.js";
import { createRateLimiter } from "./rateLimiter.js";

export function createAuthRateLimiter(): RequestHandler {
  return createRateLimiter(rateLimiterRegistry.auth);
}
