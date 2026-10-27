import { model, Schema } from "mongoose";
import { TenantRecord } from "./tenants.types";

const tenantSchema = new Schema<TenantRecord>(
  {
    name: {
      type: String,
      required: true,
      trim: true,
    },
    slug: {
      type: String,
      required: true,
      lowercase: true,
      trim: true,
      match: /^[a-z0-9]+(?:-[a-z0-9]+)*$/,
    },
    tenant_key: {
      required: true,
      type: String,
      unique: true,
    },
    description: {
      type: String,
      trim: true,
      maxlength: 500,
    },
    status: {
      type: String,
      enum: ["active", "suspended"],
      required: true,
      default: "active",
    },
    deleted_status: {
      type: Boolean,
      default: false,
      required: true,
    },
    is_verified: {
      type: Boolean,
      default: false,
    },
    verified_date: {
      type: Date,
    },
    verify_account_key: {
      type: String,
    },

    // Entra ID directory (`tid`) of the org this tenant was self-onboarded from
    // (Microsoft OAuth signup). Null for password / Google tenants.
    microsoft_tenant_id: {
      type: String,
    },
    // How the tenant was created: 'self_google' | 'self_microsoft' (self-service
    // OAuth signup) | undefined (portal register / admin-created).
    registration_source: {
      type: String,
    },

    created_by: {
      type: String,
      ref: "users",
    },
    updated_by: {
      type: String,
      ref: "users",
    },
  },
  {
    timestamps: {
      createdAt: "created_at",
      updatedAt: "updated_at",
    },
  },
);

tenantSchema.index({ slug: 1 }, { unique: true });
tenantSchema.index({ status: 1, createdAt: -1 });

export const TenantModel = model<TenantRecord>("tenants", tenantSchema);
