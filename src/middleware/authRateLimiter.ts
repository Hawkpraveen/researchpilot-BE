import type { RequestHandler } from "express";
import { createAppError } from "../utils/AppError.js";

export function createAuthRateLimiter(): RequestHandler {
  const attempts = new Map<string, { count: number; resetAt: number }>();
  const windowMs = 60_000;
  const maxAttempts = 10;

  return (request, _response, next) => {
    const now = Date.now();
    const key = request.ip ?? "unknown";
    let entry = attempts.get(key);
    if (!entry || entry.resetAt <= now) {
      entry = { count: 0, resetAt: now + windowMs };
      attempts.set(key, entry);
    }
    if (entry.count >= maxAttempts) {
      next(createAppError(429, "AUTH_RATE_LIMITED", "Too many authentication attempts. Try again shortly."));
      return;
    }
    entry.count += 1;
    if (attempts.size > 10_000) {
      for (const [ip, value] of attempts) if (value.resetAt <= now) attempts.delete(ip);
    }
    next();
  };
}
