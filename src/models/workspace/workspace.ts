import mongoose, { model, Schema } from "mongoose";
import { WorkSpaceRecord } from "./workspace.types";

const workspaceSchema = new Schema<WorkSpaceRecord>(
  {
    tenant_id: {
      type: mongoose.Schema.Types.ObjectId,
      ref: "tenants",
      required: true,
      index: true,
    },

    user_id: {
      type: mongoose.Schema.Types.ObjectId,
      ref: "users",
      required: true,
      index: true,
    },

    workspace_name: {
      type: String,
      required: true,
      trim: true,
      maxlength: 100,
    },

    slug: {
      type: String,
      lowercase: true,
      trim: true,
      match: /^[a-z0-9]+(?:-[a-z0-9]+)*$/,
    },

    description: {
      type: String,
      trim: true,
      maxlength: 500,
    },

    status: {
      type: String,
      enum: ["active", "inactive", "suspended", "archived"],
      default: "active",
      required: true,
    },

    deleted_status: {
      type: Boolean,
      default: false,
      required: true,
    },

    is_verified: {
      type: Boolean,
      default: false,
      required: true,
    },

    verified_date: {
      type: Date,
    },

    settings: {
      default_research_depth: {
        type: String,
        enum: ["quick", "moderate", "deep"],
        default: "moderate",
      },
      default_language: {
        type: String,
        default: "en",
      },
      timezone: {
        type: String,
      },
    },

    created_by: {
      type: mongoose.Schema.Types.ObjectId,
      ref: "users",
    },

    updated_by: {
      type: mongoose.Schema.Types.ObjectId,
      ref: "users",
    },
  },
  {
    timestamps: {
      createdAt: "created_at",
      updatedAt: "updated_at",
    },
    versionKey: false,
    collection: "workspaces",
  },
);

workspaceSchema.index({ tenant_id: 1, status: 1 });
workspaceSchema.index({ tenant_id: 1, user_id: 1 });
workspaceSchema.index({ tenant_id: 1, workspace_name: 1 });

export const WorkSpaceModel = model<WorkSpaceRecord>(
  "Workspace",
  workspaceSchema,
);
