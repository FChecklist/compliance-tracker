// Minimal list-only service backing the Wave 52 Credit Notes UI's supplier
// picker -- erpSuppliers has existed since Wave 49 but had no service layer
// consumer until now.
import { erpSuppliers } from "@/lib/db"
import { withTenantContext } from "@/lib/db/tenant-scoped"
import { eq } from "drizzle-orm"

export async function listSuppliers(ctx: { orgId: string }) {
  return withTenantContext({ orgId: ctx.orgId }, async (db) => {
    return db.query.erpSuppliers.findMany({ where: eq(erpSuppliers.orgId, ctx.orgId), orderBy: (t, { asc }) => asc(t.supplierName) })
  })
}
