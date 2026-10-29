
import { AuthUserModel } from "../../models/auth/authUser.model.js";
import { TenantModel } from "../../models/tenants/tenants.js";
import type { TenantHelpers } from "./tenant.types";

export const tenantHelpers: TenantHelpers = {

   // Check if the user is already registered and having tenant id 
  async resolveTenant(email) {
    const user = await AuthUserModel.findOne({ email })
      .select("email tenant_id")
      .lean();

    if (!user) {
      return null;
    }

    return {
      email: user.email,
      tenant_id: user.tenant_id ?? null,
    };
  },

  async createTenant(tenant) {
    return (await TenantModel.create(tenant)).toObject();
  }
};
