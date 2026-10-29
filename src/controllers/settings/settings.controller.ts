import type { RequestHandler } from "express";
import { getAuthenticatedUser } from "../../helpers/auth/auth.helpers.js";
import { providerSettingsService } from "../../services/settings/providerSettings.service.js";
import { providerConfigSchema } from "./settings.validation.js";
import { workspaceSettingsService } from "../../services/settings/workspaceSettings.service.js";
import { updateWorkspaceNameSchema } from "./workspace.validation.js";

export function createSettingsController(service = providerSettingsService) {
  const getProvider: RequestHandler = async (_request, response) => {
    const user = getAuthenticatedUser(response);
    response.status(200).json(await service.get({
      tenant_id: user.tenant_id, workspace_id: user.workspace_id,
    }));
  };
  const saveProvider: RequestHandler = async (request, response) => {
    const input = providerConfigSchema.parse(request.body);
    const user = getAuthenticatedUser(response);
    response.status(200).json(await service.save({
      tenant_id: user.tenant_id, workspace_id: user.workspace_id,
    }, user.id.toString(), input));
  };
  const testProvider: RequestHandler = async (request, response) => {
    const user = getAuthenticatedUser(response);
    const config = providerConfigSchema.parse(request.body);
    response.status(200).json(await service.test({
      tenant_id: user.tenant_id, workspace_id: user.workspace_id,
    }, config));
  };
  const getWorkspace: RequestHandler = async (_request, response) => {
    const user = getAuthenticatedUser(response);
    response.status(200).json(await workspaceSettingsService.get({
      workspaceId: user.workspace_id.toString(), tenantId: user.tenant_id.toString(), userId: user.id.toString(),
    }));
  };
  const renameWorkspace: RequestHandler = async (request, response) => {
    const { workspace_name } = updateWorkspaceNameSchema.parse(request.body);
    const user = getAuthenticatedUser(response);
    response.status(200).json(await workspaceSettingsService.rename({
      workspaceId: user.workspace_id.toString(), tenantId: user.tenant_id.toString(), userId: user.id.toString(),
    }, user.id.toString(), workspace_name));
  };
  return { getProvider, saveProvider, testProvider, getWorkspace, renameWorkspace };
}
