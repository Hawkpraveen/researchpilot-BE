import { Types } from "mongoose";
import { TenantRecord } from "../../models/tenants/tenants.types";

export interface TenantHelpers {
  resolveTenant(email: string): Promise<{
    email: string;
    tenant_id: unknown | null;
  } | null>;

  createTenant(
    tenant: Pick<
      TenantRecord,
      | "name"
      | "slug"
      | "tenant_key"
      | "description"
      | "status"
      | "is_verified"
      | "deleted_status"
      | "registration_source"
    >,
  ): Promise<TenantRecord>;
}
