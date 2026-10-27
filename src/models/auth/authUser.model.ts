import mongoose, { model, Schema } from "mongoose";
import { AuthUserRecord } from "./authUsers.types";

const authUserSchema = new Schema<AuthUserRecord>(
  {
    
    tenant_id: {
      type: mongoose.Schema.ObjectId,
      ref: "tenants",
      required: true,
    },
    active_workspace_id: {
      type: mongoose.Schema.ObjectId,
      ref: "workspaces",
    },

    first_name: {
      type: String,
      required: true,
    },
    last_name: {
      type: String,
    },
    display_name: {
      type: String,
    },

    profile_url: {
      type: String,
    },
    auth_type: {
      type: String,
      enum: ["basic_auth", "google", "microsoft"],
      required: true,
      default: "basic_auth",
    },

    email: {
      type: String,
      required: true,
      lowercase: true,
      trim: true,
    },

    password: {
      type: String,
      required: function (): boolean {
        return this.auth_type === "basic_auth";
      },
      select: false,
    },
    forget_password_key: {
      type: String,
    },

    active_role_key: {
      type: String,
      enum: ["user", "owner"],
      required: true,
      default: "user",
    },

    first_login_date: {
      type: Date,
    },
    last_login_date: {
      type: Date,
    },

    active_directory_id: {
      type: String,
    },

    google_sub: {
      type: String,
    },
    microsoft_oid: {
      type: String,
    },
    microsoft_tenant_id: {
      type: String,
    },
    ms_account_type: {
      type: String, // "personal" | "organization"
    },
    active_directory_group_id: {
      type: [String],
      default: [],
    },

    active_directory_group_name: {
      type: [String],
      default: [],
    },

    status: {
      type: String,
      enum: ["active", "inactive", "deleted", "suspended"],
      required: true,
      default: "active",
    },
    deleted_status: {
      type: Boolean,
      default: false,
    },

    is_verified: {
      type: Boolean,
      default: false,
    },
    verified_date: {
      type: Date,
    },

    created_by: {
      type: mongoose.Schema.ObjectId,
      ref: "users",
    },
    updated_by: {
      type: mongoose.Schema.ObjectId,
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

authUserSchema.index({ email: 1 }, { unique: true });

export const AuthUserModel = model<AuthUserRecord>("users", authUserSchema);
