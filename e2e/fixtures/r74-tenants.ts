// R74 Y4-05: the two-tenant fixture. Both tenants and all 8 accounts already
// exist (R74 Phase 3, claude_log id 207) -- this just exposes their ids for
// tests that need to act as either tenant or assert cross-tenant isolation.
import { config as loadEnv } from "dotenv";
import path from "node:path";

loadEnv({ path: path.resolve(__dirname, "../../.env.r74-test.local") });

export const R74_TENANTS = {
  A: { id: process.env.R74_TENANT_A_ID!, label: "R74-TEST-Tenant-A" },
  B: { id: process.env.R74_TENANT_B_ID!, label: "R74-TEST-Tenant-B" },
} as const;

export type R74TenantKey = keyof typeof R74_TENANTS;

export function otherTenant(tenant: R74TenantKey): R74TenantKey {
  return tenant === "A" ? "B" : "A";
}
