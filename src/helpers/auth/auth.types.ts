import {
  AuthSessionRecord,
  AuthUserRecord,
} from "../../models/auth/authUsers.types";

export interface AuthHelpers {
  createUser(user: Pick<AuthUserRecord, "email" | "first_name" | "last_name" | "active_role_key" | "tenant_id"> &
    Partial<Pick<AuthUserRecord, "password" | "auth_type" | "google_sub" | "microsoft_oid" | "microsoft_tenant_id" | "ms_account_type" | "profile_url" | "is_verified">>): Promise<AuthUserRecord>;
  findUserByEmail(email: string): Promise<AuthUserRecord | null>;
  updateProfile?(user_id: AuthUserRecord["_id"], profile: Partial<Pick<AuthUserRecord, "first_name" | "last_name">> & { profile_url?: string | null }): Promise<AuthUserRecord | null>;
  setActiveWorkspace(user_id: AuthUserRecord["_id"], workspace_id: AuthUserRecord["active_workspace_id"]): Promise<AuthUserRecord>;
  createDefaultWorkspace(user: AuthUserRecord): Promise<NonNullable<AuthUserRecord["active_workspace_id"]>>;
  createSession(
    session: Pick<AuthSessionRecord, "user_id" | "token_hash" | "expires_at">,
  ): Promise<void>;
  findUserBySessionHash(token_hash: string): Promise<AuthUserRecord | null>;
  deleteSession(token_hash: string): Promise<void>;
}
