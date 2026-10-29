import { z } from "zod";

const count = z.number().int().nonnegative().finite().nullable();
export const usageSchema = z.object({
  executionId: z.string().min(1).max(80),
  calls: z.array(z.object({
    provider: z.enum(["ollama", "openai", "anthropic", "custom", "tavily"]),
    stage: z.enum(["search", "subject_resolution", "synthesis"]), model: z.string().max(150).nullable(),
    httpStatus: z.number().int().min(100).max(599).nullable(), status: z.enum(["completed", "failed"]),
    durationMs: z.number().int().nonnegative().finite(), inputTokens: count, outputTokens: count,
    cachedInputTokens: count, cacheWriteTokens: count, totalTokens: count,
    credits: z.number().nonnegative().finite().nullable(),
  }).strict()).max(100),
}).strict();
export type ResearchUsage = z.infer<typeof usageSchema>;
export type UsageStatus = "running" | "completed" | "failed";

export function summarizeUsage(usage: ResearchUsage) {
  const models = usage.calls.filter((call) => call.provider !== "tavily");
  const searches = usage.calls.filter((call) => call.provider === "tavily");
  const sum = (values: Array<number | null>) => values.reduce<number>((total, value) => total + (value ?? 0), 0);
  return {
    usageAvailable: usage.calls.length > 0,
    countersComplete: usage.calls.length > 0 && models.every((call) => call.totalTokens !== null) && searches.every((call) => call.credits !== null),
    modelCalls: models.length, searchCalls: searches.length,
    reportedInputTokens: sum(models.map((call) => call.inputTokens)),
    reportedOutputTokens: sum(models.map((call) => call.outputTokens)),
    reportedTavilyCredits: sum(searches.map((call) => call.credits)),
    modelCallsWithUnknownUsage: models.filter((call) => call.totalTokens === null).length,
    searchCallsWithUnknownCredits: searches.filter((call) => call.credits === null).length,
  };
}
