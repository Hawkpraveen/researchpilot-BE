import { WorkSpaceModel } from "../../models/workspace/workspace.js";
import { createAppError } from "../../utils/AppError.js";

export interface WorkspaceSettingsScope {
  workspaceId: string;
  tenantId: string;
  userId: string;
}

export function createWorkspaceSettingsService() {
  const scopeFilter = (scope: WorkspaceSettingsScope) => ({
    _id: scope.workspaceId,
    tenant_id: scope.tenantId,
    user_id: scope.userId,
    status: "active",
    deleted_status: false,
  });

  return {
    async get(scope: WorkspaceSettingsScope) {
      const workspace = await WorkSpaceModel.findOne(scopeFilter(scope)).select({ workspace_name: 1 }).lean().exec();
      if (!workspace) throw createAppError(404, "WORKSPACE_NOT_FOUND", "The active workspace could not be found.");
      return { workspace_name: workspace.workspace_name };
    },
    async rename(scope: WorkspaceSettingsScope, userId: string, workspaceName: string) {
      const workspace = await WorkSpaceModel.findOneAndUpdate(
        scopeFilter(scope),
        { $set: { workspace_name: workspaceName, updated_by: userId } },
        { new: true, runValidators: true },
      ).select({ workspace_name: 1 }).lean().exec();
      if (!workspace) throw createAppError(404, "WORKSPACE_NOT_FOUND", "The active workspace could not be found.");
      return { workspace_name: workspace.workspace_name };
    },
  };
}

export const workspaceSettingsService = createWorkspaceSettingsService();
