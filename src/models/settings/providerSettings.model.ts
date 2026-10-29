import { model, Schema } from "mongoose";
import type { ProviderSettingsRecord } from "./providerSettings.types.js";
const providerSettingsSchema = new Schema<ProviderSettingsRecord>(
  {
    tenant_id: {
      type: Schema.Types.ObjectId,
      ref: "tenants",
      required: true,
      index: true,
    },
    workspace_id: {
      type: Schema.Types.ObjectId,
      ref: "Workspace",
      required: true,
      index: true,
    },
    user_id: { type: Schema.Types.ObjectId, ref: "users", required: true },
    mode: {
      type: String,
      enum: ["local", "byok"],
      required: true,
      default: "local",
    },
    provider: {
      type: String,
      enum: ["ollama", "openai", "anthropic", "custom"],
      required: true,
      default: "ollama",
    },
    endpoint: { type: String, required: true, trim: true },
    model: { type: String, required: true, trim: true },
    api_key: { type: String, select: false },
  },
  {
    timestamps: { createdAt: "created_at", updatedAt: "updated_at" },
    versionKey: false,
    collection: "provider_settings",
  },
);
providerSettingsSchema.index(
  { tenant_id: 1, workspace_id: 1 },
  { unique: true },
);
export const ProviderSettingsModel = model<ProviderSettingsRecord>(
  "ProviderSettings",
  providerSettingsSchema,
);

export async function ensureProviderSettingsIndexes() {
  try {
    await ProviderSettingsModel.collection.dropIndex("user_id_1");
  } catch (error) {
    if (!(error instanceof Error && "code" in error && error.code === 27)) throw error;
  }
  await ProviderSettingsModel.createIndexes();
}
