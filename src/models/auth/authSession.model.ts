import mongoose, { model, Schema } from "mongoose";
import { AuthSessionRecord } from "./authUsers.types";

const authSessionSchema = new Schema<AuthSessionRecord>(
  {
    user_id: {
      type: mongoose.Schema.ObjectId,
      required: true,
      index: true,
    },
    token_hash: {
      type: String,
      required: true,
      unique: true,
      select: false,
    },
    expires_at: {
      type: Date,
      required: true,
    },
  },
  {
    timestamps: {
      createdAt: "created_at",
      updatedAt: false,
    },
  },
);

authSessionSchema.index({ expires_at: 1 }, { expireAfterSeconds: 0 });

export const AuthSessionModel = model<AuthSessionRecord>(
  "auth_sessions",
  authSessionSchema,
);

/** Remove the legacy camelCase index left by the previous session schema. */
export async function ensureAuthSessionIndexes() {
  try {
    await AuthSessionModel.collection.dropIndex("tokenHash_1");
    console.log("Removed legacy auth session index tokenHash_1");
  } catch (error) {
    if (!(error instanceof Error && "code" in error && error.code === 27)) {
      throw error;
    }
  }
  await AuthSessionModel.createIndexes();
}
