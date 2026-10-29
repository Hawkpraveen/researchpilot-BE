/** Public API messages. Keep stable error codes separate from presentation text. */
export const messages = {
  CONNECTOR_RATE_LIMITED: "Too many connector requests. Try again shortly.",
  NOT_FOUND: "The requested endpoint does not exist.",
  VALIDATION_ERROR: "The request body is invalid.",
  INVALID_JSON: "The request body must contain valid JSON.",
  PAYLOAD_TOO_LARGE: "The request body must not exceed 32 KB.",
  INTERNAL_ERROR: "An unexpected error occurred.",
  AUTHENTICATION_REQUIRED: "Sign in to continue.",
  SESSION_INVALID: "Your session is invalid or has expired.",
  AUTH_RATE_LIMITED: "Too many authentication attempts. Try again shortly.",
  RESEARCH_RATE_LIMITED: "Too many research requests. Try again shortly.",
  PROVIDER_TEST_RATE_LIMITED: "Too many provider connection tests. Try again shortly.",
  PROVIDER_NOT_CONFIGURED: "Save a provider configuration first.",
  PROVIDER_SAVE_FAILED: "The provider configuration could not be saved.",
  PROVIDER_CONNECTION_FAILED: "Could not connect to Ollama at the configured endpoint.",
} as const;
