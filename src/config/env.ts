import { z } from "zod";

const environmentSchema = z.object({
  NODE_ENV: z.enum(["development", "test", "production"]).default("development"),
  PORT: z.coerce.number().int().min(1).max(65535).default(5000),
  WEB_ORIGIN: z.string().url().default("http://localhost:8080"),
  MONGODB_URI: z.string().min(1).default("mongodb://127.0.0.1:27017/researchpilot"),
  AGENT_BASE_URL: z.string().url().default("http://127.0.0.1:8000"),
  AGENT_TIMEOUT_MS: z.coerce.number().int().min(100).max(60000).default(10000),
  GOOGLE_CLIENT_ID: z.string().default(""),
  MICROSOFT_CLIENT_ID: z.string().default(""),
  MICROSOFT_TENANT_ID: z.string().default("common"),
});

export function loadEnvironment(source: NodeJS.ProcessEnv = process.env) {
  const parsed = environmentSchema.safeParse(source);
  if (!parsed.success) {
    const details = parsed.error.issues.map((issue) => `${issue.path.join(".")}: ${issue.message}`).join("; ");
    throw new Error(`Invalid environment configuration: ${details}`);
  }

  return parsed.data;
}

export type Environment = ReturnType<typeof loadEnvironment>;
