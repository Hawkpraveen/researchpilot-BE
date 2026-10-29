/** Single source of truth for route budgets; windows are milliseconds. */
export const rateLimiterRegistry = {
  auth: { maxAttempts: 10, windowMs: 60_000, code: "AUTH_RATE_LIMITED" },
  researchCreate: { maxAttempts: 10, windowMs: 60_000, code: "RESEARCH_RATE_LIMITED" },
  providerTest: { maxAttempts: 5, windowMs: 60_000, code: "PROVIDER_TEST_RATE_LIMITED" },
} as const;
