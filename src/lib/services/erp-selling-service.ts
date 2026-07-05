// Minimal list-only service backing the Wave 52 Credit Notes UI's customer
// picker -- erpCustomers has existed since Wave 49 but had no service layer
// consumer until now.
import { erpCustomers } from "@/lib/db"
import { withTenantContext } from "@/lib/db/tenant-scoped"
import { eq } from "drizzle-orm"

export async function listCustomers(ctx: { orgId: string }) {
  return withTenantContext({ orgId: ctx.orgId }, async (db) => {
    return db.query.erpCustomers.findMany({ where: eq(erpCustomers.orgId, ctx.orgId), orderBy: (t, { asc }) => asc(t.customerName) })
  })
}
