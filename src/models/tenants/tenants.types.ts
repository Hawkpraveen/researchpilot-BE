import { Types } from "mongoose";

export type TenantStatus =
  | "pending"
  | "active"
  | "suspended"
  | "inactive"
  | "deleted";

export type RegistrationSource =
  | "self_email"
  | "self_google"
  | "self_microsoft";

export interface TenantRecord {
  _id: Types.ObjectId;

  name: string;
  slug: string;
  tenant_key: string;
  description?: string;

  status: TenantStatus;
  deleted_status: boolean;
  is_verified: boolean;

  verified_date?: Date;
  verify_account_key?: string;

  microsoft_tenant_id?: string;
  registration_source?: RegistrationSource;

  created_by?: string;
  updated_by?: string;

  created_at: Date;
  updated_at: Date;
}
