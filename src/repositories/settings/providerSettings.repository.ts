import { ProviderSettingsModel } from "../../models/settings/providerSettings.model.js";
import type { Types } from "mongoose";
import type { ProviderConfigInput } from "../../controllers/settings/settings.validation.js";

export interface ProviderSettingsScope {
  tenant_id: string | Types.ObjectId;
  workspace_id: string | Types.ObjectId;
}

export const providerSettingsRepository = {
  find(scope: ProviderSettingsScope) {
    return ProviderSettingsModel.findOne(scope).lean().exec();
  },
  save(scope: ProviderSettingsScope, user_id: string, input: ProviderConfigInput) {
    const { apiKey, ...config } = input;
    return ProviderSettingsModel.findOneAndUpdate(scope, {
      $set: { ...scope, ...config, user_id, ...(apiKey ? { api_key: apiKey } : {}) },
    }, { upsert: true, new: true, setDefaultsOnInsert: true, runValidators: true }).lean().exec();
  },
};
