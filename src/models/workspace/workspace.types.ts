import { Types } from "mongoose";

export type WorkspaceStatus = "active" | "inactive" | "suspended" | "archived";

export interface WorkSpaceRecord {
  _id: Types.ObjectId;

  tenant_id: Types.ObjectId;
  user_id: Types.ObjectId;

  workspace_name: string;
  slug?: string;
  description?: string;

  status: WorkspaceStatus;
  deleted_status: boolean;

  is_verified: boolean;
  verified_date?: Date;

  settings?: {
    default_research_depth?: "quick" | "moderate" | "deep";
    default_language?: string;
    timezone?: string;
  };

  created_by?: Types.ObjectId;
  updated_by?: Types.ObjectId;

  created_at: Date;
  updated_at: Date;
}
