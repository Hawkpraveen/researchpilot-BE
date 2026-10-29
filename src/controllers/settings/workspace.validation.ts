import { z } from "zod";

export const updateWorkspaceNameSchema = z.object({
  workspace_name: z.string().trim().min(1).max(100),
}).strict();
