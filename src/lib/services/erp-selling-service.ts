// Minimal list-only service backing the Wave 52 Credit Notes UI's customer
// picker -- erpCustomers has existed since Wave 49 but had no service layer
// consumer until now.
//
// Wave 84 (COMPARISON_CSV_GAP_ANALYSIS.md backlog #5): adds create/update --
// nothing in this codebase had ever inserted a row into erp_customers
// outside of seed data, which made credit limits (this wave's actual goal)
// impossible to manage without a way to create/edit a customer at all.
import { erpCustomers } from "@/lib/db"
import { withTenantContext } from "@/lib/db/tenant-scoped"
import { and, eq } from "drizzle-orm"
import { ServiceError } from "./compliance-service"
export { ServiceError }
import { requireErpEnabled } from "./erp-enablement-service"

export async function listCustomers(ctx: { orgId: string }) {
  await requireErpEnabled(ctx.orgId)
  return withTenantContext({ orgId: ctx.orgId }, async (db) => {
    return db.query.erpCustomers.findMany({ where: eq(erpCustomers.orgId, ctx.orgId), orderBy: (t, { asc }) => asc(t.customerName) })
  })
}

export type CustomerInput = { customerName: string; gstin?: string; panNumber?: string; defaultPaymentTermsDays?: number; creditLimit?: number }

export async function createCustomer(ctx: { orgId: string }, input: CustomerInput) {
  await requireErpEnabled(ctx.orgId)
  if (!input.customerName?.trim()) throw new ServiceError("customerName is required", 400)
  return withTenantContext({ orgId: ctx.orgId }, async (db) => {
    const [customer] = await db.insert(erpCustomers).values({
      orgId: ctx.orgId, customerName: input.customerName, gstin: input.gstin, panNumber: input.panNumber,
      defaultPaymentTermsDays: input.defaultPaymentTermsDays, creditLimit: input.creditLimit?.toString(),
    }).returning()
    return customer
  })
}

export async function updateCustomer(ctx: { orgId: string }, customerId: string, input: Partial<CustomerInput>) {
  await requireErpEnabled(ctx.orgId)
  return withTenantContext({ orgId: ctx.orgId }, async (db) => {
    const customer = await db.query.erpCustomers.findFirst({ where: and(eq(erpCustomers.id, customerId), eq(erpCustomers.orgId, ctx.orgId)) })
    if (!customer) throw new ServiceError("Customer not found", 404)
    const [updated] = await db.update(erpCustomers).set({
      ...(input.customerName !== undefined ? { customerName: input.customerName } : {}),
      ...(input.gstin !== undefined ? { gstin: input.gstin } : {}),
      ...(input.panNumber !== undefined ? { panNumber: input.panNumber } : {}),
      ...(input.defaultPaymentTermsDays !== undefined ? { defaultPaymentTermsDays: input.defaultPaymentTermsDays } : {}),
      ...(input.creditLimit !== undefined ? { creditLimit: input.creditLimit === null ? null : input.creditLimit.toString() } : {}),
    }).where(eq(erpCustomers.id, customerId)).returning()
    return updated
  })
}
