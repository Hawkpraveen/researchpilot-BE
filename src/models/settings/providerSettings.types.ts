import { Types } from "mongoose";
export type ProviderMode = "local" | "byok";
export type ProviderKind = "ollama" | "openai" | "anthropic" | "custom";
export interface ProviderSettingsRecord {
  _id: Types.ObjectId;
  tenant_id: Types.ObjectId;
  workspace_id: Types.ObjectId;
  user_id: Types.ObjectId;
  mode: ProviderMode;
  provider: ProviderKind;
  endpoint: string;
  model: string;
  api_key?: string;
  created_at: Date;
  updated_at: Date;
}
