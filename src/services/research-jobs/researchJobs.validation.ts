import { z } from "zod";

const boundedString = (max: number) => z.string().trim().min(1).max(max);
export const updateResearchJobSchema = z.object({ title: boundedString(200) }).strict();

export const createResearchJobSchema = z
  .object({
    goal: boundedString(1000),
    alternatives: z.array(boundedString(120)).max(5).default([]),
    criteria: z
      .array(
        z
          .object({
            id: z.string().regex(/^[a-z0-9][a-z0-9-]{0,63}$/),
            label: boundedString(120),
            weight: z.number().int().min(1).max(5),
          })
          .strict(),
      )
      .max(10)
      .default([]),
    constraints: z.array(boundedString(500)).max(10).default([]),
    depth: z.enum(["quick", "standard", "deep"]).default("standard"),
  })
  .strict()
  .superRefine((request, context) => {
    const ids = new Set<string>();
    for (const criterion of request.criteria) {
      if (ids.has(criterion.id)) {
        context.addIssue({
          code: z.ZodIssueCode.custom,
          path: ["criteria"],
          message: `Criterion IDs must be unique; "${criterion.id}" is repeated.`,
        });
      }
      ids.add(criterion.id);
    }
  });

export type CreateResearchJobInput = z.infer<typeof createResearchJobSchema>;

export const clarifyResearchSchema = z.object({
  candidateIndex: z.number().int().min(0).max(3).optional(),
  context: boundedString(500).optional(),
}).strict().refine((value) => value.candidateIndex !== undefined || Boolean(value.context), "Choose a subject or provide context.");
export type ClarifyResearchInput = z.infer<typeof clarifyResearchSchema>;
