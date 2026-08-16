// Wave 84 (COMPARISON_CSV_GAP_ANALYSIS.md backlog #5): multiple
// addresses/contacts per Customer/Vendor master record. Generic across
// both entity types via linkedEntityType/linkedEntityId, matching
// document-service.ts's own polymorphic convention (Wave 61) -- one
// service, not a customer-only and supplier-only pair.
import { erpAddresses, erpContacts } from "@/lib/db"
import { withTenantContext } from "@/lib/db/tenant-scoped"
import { and, eq } from "drizzle-orm"
import { ServiceError } from "./compliance-service"
export { ServiceError }
import { requireErpEnabled } from "./erp-enablement-service"

export type PartyEntityType = "erp_customer" | "erp_supplier"

function assertEntityType(entityType: string): asserts entityType is PartyEntityType {
  if (entityType !== "erp_customer" && entityType !== "erp_supplier") {
    throw new ServiceError("Invalid entity type", 400)
  }
}

// ============================================================
// Addresses
// ============================================================

export async function listAddresses(ctx: { orgId: string }, entityType: string, entityId: string) {
  await requireErpEnabled(ctx.orgId)
  assertEntityType(entityType)
  return withTenantContext({ orgId: ctx.orgId }, (db) =>
    db.query.erpAddresses.findMany({
      where: and(eq(erpAddresses.orgId, ctx.orgId), eq(erpAddresses.linkedEntityType, entityType), eq(erpAddresses.linkedEntityId, entityId)),
      orderBy: (t, { desc }) => desc(t.isPrimary),
    })
  )
}

export async function addAddress(
  ctx: { orgId: string },
  entityType: string,
  entityId: string,
  input: { addressType?: string; line1: string; line2?: string; city?: string; state?: string; postalCode?: string; country?: string; isPrimary?: boolean }
) {
  await requireErpEnabled(ctx.orgId)
  assertEntityType(entityType)
  if (!input.line1?.trim()) throw new ServiceError("line1 is required", 400)

  return withTenantContext({ orgId: ctx.orgId }, async (db) => {
    if (input.isPrimary) {
      await db.update(erpAddresses).set({ isPrimary: false })
        .where(and(eq(erpAddresses.orgId, ctx.orgId), eq(erpAddresses.linkedEntityType, entityType), eq(erpAddresses.linkedEntityId, entityId)))
    }
    const [address] = await db.insert(erpAddresses).values({
      orgId: ctx.orgId, linkedEntityType: entityType, linkedEntityId: entityId,
      addressType: input.addressType ?? "billing", line1: input.line1, line2: input.line2,
      city: input.city, state: input.state, postalCode: input.postalCode, country: input.country,
      isPrimary: input.isPrimary ?? false,
    }).returning()
    return address
  })
}

export async function deleteAddress(ctx: { orgId: string }, addressId: string) {
  await requireErpEnabled(ctx.orgId)
  return withTenantContext({ orgId: ctx.orgId }, async (db) => {
    const address = await db.query.erpAddresses.findFirst({ where: and(eq(erpAddresses.id, addressId), eq(erpAddresses.orgId, ctx.orgId)) })
    if (!address) throw new ServiceError("Address not found", 404)
    await db.delete(erpAddresses).where(eq(erpAddresses.id, addressId))
  })
}

// ============================================================
// Contacts
// ============================================================

export async function listContacts(ctx: { orgId: string }, entityType: string, entityId: string) {
  await requireErpEnabled(ctx.orgId)
  assertEntityType(entityType)
  return withTenantContext({ orgId: ctx.orgId }, (db) =>
    db.query.erpContacts.findMany({
      where: and(eq(erpContacts.orgId, ctx.orgId), eq(erpContacts.linkedEntityType, entityType), eq(erpContacts.linkedEntityId, entityId)),
      orderBy: (t, { desc }) => desc(t.isPrimary),
    })
  )
}

export async function addContact(
  ctx: { orgId: string },
  entityType: string,
  entityId: string,
  input: { contactName: string; designation?: string; email?: string; phone?: string; isPrimary?: boolean }
) {
  await requireErpEnabled(ctx.orgId)
  assertEntityType(entityType)
  if (!input.contactName?.trim()) throw new ServiceError("contactName is required", 400)

  return withTenantContext({ orgId: ctx.orgId }, async (db) => {
    if (input.isPrimary) {
      await db.update(erpContacts).set({ isPrimary: false })
        .where(and(eq(erpContacts.orgId, ctx.orgId), eq(erpContacts.linkedEntityType, entityType), eq(erpContacts.linkedEntityId, entityId)))
    }
    const [contact] = await db.insert(erpContacts).values({
      orgId: ctx.orgId, linkedEntityType: entityType, linkedEntityId: entityId,
      contactName: input.contactName, designation: input.designation, email: input.email, phone: input.phone,
      isPrimary: input.isPrimary ?? false,
    }).returning()
    return contact
  })
}

export async function deleteContact(ctx: { orgId: string }, contactId: string) {
  await requireErpEnabled(ctx.orgId)
  return withTenantContext({ orgId: ctx.orgId }, async (db) => {
    const contact = await db.query.erpContacts.findFirst({ where: and(eq(erpContacts.id, contactId), eq(erpContacts.orgId, ctx.orgId)) })
    if (!contact) throw new ServiceError("Contact not found", 404)
    await db.delete(erpContacts).where(eq(erpContacts.id, contactId))
  })
}
