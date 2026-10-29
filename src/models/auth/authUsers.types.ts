import { Types } from "mongoose";

export type UserRole = "user" | "owner";

export type AccountStatus = "active" | "inactive" | "deleted" | "suspended";

export type AuthType = "basic_auth" | "google" | "microsoft";

export type MicrosoftAccountType = "personal" | "organization";

export interface AuthUserRecord {
  _id: Types.ObjectId;

  tenant_id: Types.ObjectId;
  active_workspace_id?: Types.ObjectId;

  first_name: string;
  last_name: string;
  display_name?: string;
  profile_url?: string;

  auth_type: AuthType;

  email: string;
  password?: string;
  forget_password_key?: string;

  active_role_key: UserRole;

  first_login_date?: Date;
  last_login_date?: Date;

  active_directory_id?: string;
  google_sub?: string;
  microsoft_oid?: string;
  microsoft_tenant_id?: string;
  ms_account_type?: MicrosoftAccountType;

  active_directory_group_id?: string[];
  active_directory_group_name?: string[];

  status: AccountStatus;
  deleted_status: boolean;

  is_verified: boolean;
  verified_date?: Date;

  created_by?: Types.ObjectId;
  updated_by?: Types.ObjectId;

  created_at: Date;
  updated_at: Date;
}

export interface AuthSessionRecord {
  _id: Types.ObjectId;
  user_id: Types.ObjectId;
  token_hash: string;
  expires_at: Date;
  created_at: Date;
}
