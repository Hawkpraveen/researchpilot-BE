import type { RequestHandler } from "express";
import { messages } from "../config/messages.js";
import { rateLimiterRegistry } from "../config/rateLimiterRegistry.js";
import { createAppError } from "../utils/AppError.js";

export interface RateLimiterOptions {
  maxAttempts: number;
  windowMs: number;
  code: keyof typeof messages;
  maxEntries?: number;
  now?: () => number;
  key?: (request: Parameters<RequestHandler>[0], response: Parameters<RequestHandler>[1]) => string;
}

/** Per-process fixed-window limiter with bounded storage and no background timers. */
export function createRateLimiter(options: RateLimiterOptions): RequestHandler {
  const { maxAttempts, windowMs, code, maxEntries = 10_000, now = Date.now } = options;
  if (!Number.isInteger(maxAttempts) || maxAttempts < 1 || !Number.isFinite(windowMs) || windowMs <= 0
    || !Number.isInteger(maxEntries) || maxEntries < 1) throw new Error("Invalid rate limiter configuration.");
  const entries = new Map<string, { count: number; resetAt: number }>();
  let nextCleanup = 0;

  return (request, response, next) => {
    const time = now();
    if (time >= nextCleanup || entries.size >= maxEntries) {
      for (const [key, entry] of entries) if (entry.resetAt <= time) entries.delete(key);
      nextCleanup = time + Math.min(windowMs, 60_000);
    }
    const key = options.key?.(request, response) ?? request.ip ?? "unknown";
    let entry = entries.get(key);
    if (!entry || entry.resetAt <= time) {
      // Do not evict live counters (which would allow bypassing existing limits).
      if (!entry && entries.size >= maxEntries) {
        response.setHeader("Retry-After", Math.ceil(windowMs / 1000));
        next(createAppError(429, code, messages[code], true));
        return;
      }
      entry = { count: 0, resetAt: time + windowMs };
      entries.set(key, entry);
    }
    const retryAfter = Math.max(1, Math.ceil((entry.resetAt - time) / 1000));
    response.setHeader("RateLimit-Limit", maxAttempts);
    response.setHeader("RateLimit-Remaining", Math.max(0, maxAttempts - entry.count - 1));
    response.setHeader("RateLimit-Reset", retryAfter);
    if (entry.count >= maxAttempts) {
      response.setHeader("Retry-After", retryAfter);
      next(createAppError(429, code, messages[code], true));
      return;
    }
    entry.count += 1;
    next();
  };
}

/** Authenticated workloads are isolated per tenant, workspace, and user. */
export function createUserRateLimiter(policy: "researchCreate" | "providerTest" | "connectorPair"): RequestHandler {
  return createRateLimiter({
    ...rateLimiterRegistry[policy],
    key: (_request, response) => {
      const user = response.locals.authUser;
      if (!user) throw createAppError(401, "AUTHENTICATION_REQUIRED", messages.AUTHENTICATION_REQUIRED);
      return JSON.stringify([user.tenant_id, user.workspace_id, user.id]);
    },
  });
}
