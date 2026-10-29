import { Types } from "mongoose";

export interface AuthUserView {
  id: Types.ObjectId;
  tenant_id: Types.ObjectId;
  workspace_id: Types.ObjectId;
  email: string;
  first_name: string;
  last_name: string;
  auth_type: "basic_auth" | "google" | "microsoft";
  profile_url?: string;
  role: "user" | "owner";
  twoFactorEnabled: false;
}

export interface AuthSessionView {
  user: AuthUserView;
  access_token: string;
  expires_at: string;
}
