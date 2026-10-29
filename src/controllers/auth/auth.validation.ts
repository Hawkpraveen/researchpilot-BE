import { z } from "zod";

const emailSchema = z.string().trim().toLowerCase().email().max(254);
const passwordSchema = z.string().min(8).max(128);

const nameSchema = z.string().trim().min(1).max(151);
const firstNameSchema = z.string().trim().min(1).max(100);
const lastNameSchema = z.string().trim().min(1).max(50);

export const registerSchema = z.object({
  // `name` is retained temporarily so clients built before the first/last-name
  // API change receive a normal validation result instead of a 400.
  name: nameSchema.optional(),
  first_name: firstNameSchema.optional(),
  last_name: lastNameSchema.optional(),
  email: emailSchema,
  password: passwordSchema,
}).strict().superRefine((input, context) => {
  if (!input.name && !input.first_name) {
    context.addIssue({ code: z.ZodIssueCode.custom, path: ["first_name"], message: "First name is required." });
  }
  if (!input.name && !input.last_name) {
    context.addIssue({ code: z.ZodIssueCode.custom, path: ["last_name"], message: "Last name is required." });
  }
}).transform(({ name, first_name, last_name, email, password }) => {
  const nameParts = name?.split(/\s+/) ?? [];
  return {
    first_name: first_name ?? nameParts[0]!,
    last_name: last_name ?? (nameParts.slice(1).join(" ") || "User"),
    email,
    password,
  };
});

export const loginSchema = z.object({
  email: emailSchema,
  password: z.string().min(1).max(128),
}).strict();

export const updateProfileSchema = z.object({
  first_name: firstNameSchema,
  last_name: lastNameSchema,
}).strict();

export type RegisterInput = z.infer<typeof registerSchema>;
export type LoginInput = z.infer<typeof loginSchema>;
export type UpdateProfileInput = z.infer<typeof updateProfileSchema>;
