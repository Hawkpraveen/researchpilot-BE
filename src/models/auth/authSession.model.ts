import { model, Schema } from "mongoose";

export interface AuthSessionRecord {
  _id: string;
  userId: string;
  tokenHash: string;
  expiresAt: Date;
  createdAt: Date;
}

const authSessionSchema = new Schema<AuthSessionRecord>(
  {
    userId: { type: String, required: true, index: true },
    tokenHash: { type: String, required: true, unique: true, select: false },
    expiresAt: { type: Date, required: true },
  },
  { timestamps: { createdAt: true, updatedAt: false }, versionKey: false, collection: "auth_sessions" },
);

authSessionSchema.index({ expiresAt: 1 }, { expireAfterSeconds: 0 });

export const AuthSessionModel = model<AuthSessionRecord>("AuthSession", authSessionSchema);
