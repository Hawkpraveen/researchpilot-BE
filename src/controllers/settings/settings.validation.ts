import { z } from "zod";

export const providerConfigSchema = z.object({
  mode: z.enum(["local", "byok"]),
  provider: z.enum(["ollama", "openai", "anthropic", "custom"]),
  endpoint: z.string().url().refine((value) => {
    try {
      const url = new URL(value);
      return ["http:", "https:"].includes(url.protocol) && !url.username && !url.password;
    } catch {
      return false;
    }
  }, "Use an HTTP or HTTPS endpoint without embedded credentials."),
  model: z.string().trim().min(1).max(150),
  apiKey: z.string().max(500).optional().default(""),
}).strict();

export type ProviderConfigInput = z.infer<typeof providerConfigSchema>;
