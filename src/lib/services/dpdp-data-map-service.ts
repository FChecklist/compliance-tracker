// WO-DPDP-001 4.2 -- the data map, the product's core artefact ("You
// cannot delete what you cannot find" / "If data leaks, you have 72 hours
// to say whose. Only this list can tell you.").
import { and, eq } from "drizzle-orm"
import { dpdpDataCategory, dpdpDataLocation, dpdpMembership, dpdpOrganisation } from "@/lib/db"
import { withDpdpContext } from "@/lib/db/tenant-scoped"
import { logDpdpEvent } from "./dpdp-event-service"
import { sendEmail, emailTemplate } from "@/lib/email"
import { ServiceError } from "./compliance-service"
export { ServiceError }

export type DataMapRow = {
  category: typeof dpdpDataCategory.$inferSelect
  location: typeof dpdpDataLocation.$inferSelect | null
}

export async function listDataMap(orgId: string): Promise<DataMapRow[]> {
  return withDpdpContext({ orgId }, async (tx) => {
    const categories = await tx.query.dpdpDataCategory.findMany({ where: eq(dpdpDataCategory.orgId, orgId) })
    const rows: DataMapRow[] = []
    for (const category of categories) {
      const location = await tx.query.dpdpDataLocation.findFirst({ where: eq(dpdpDataLocation.categoryId, category.id) })
      rows.push({ category, location: location ?? null })
    }
    return rows
  })
}

export type AddDataCategoryInput = {
  orgId: string; actorIdentityId: string; category: string; subjectGroup?: string; isChildrenData?: boolean
  systemName?: string; pathText?: string; physicalLocation?: string
  holderKind: "internal_person" | "processor_org"; holderPersonId?: string; holderOrgId?: string
}

/** "Write down where every kind of data is kept" -- one category + its (possibly still-unknown) location, in one step. */
export async function addDataCategory(input: AddDataCategoryInput) {
  if (!input.category.trim()) throw new ServiceError("What kind of data is required", 400)
  return withDpdpContext({ orgId: input.orgId }, async (tx) => {
    const [category] = await tx.insert(dpdpDataCategory).values({
      orgId: input.orgId, category: input.category.trim(), subjectGroup: input.subjectGroup, isChildrenData: input.isChildrenData ?? false,
    }).returning()

    const hasPlace = Boolean(input.pathText?.trim() || input.physicalLocation?.trim())
    const [location] = await tx.insert(dpdpDataLocation).values({
      categoryId: category.id, systemName: input.systemName, pathText: input.pathText, physicalLocation: input.physicalLocation,
      holderKind: input.holderKind, holderPersonId: input.holderPersonId, holderOrgId: input.holderOrgId,
      state: hasPlace ? "confirmed" : "unknown", confirmedBy: hasPlace ? input.actorIdentityId : undefined, confirmedAt: hasPlace ? new Date() : undefined,
    }).returning()

    if (hasPlace) {
      await logDpdpEvent({ orgId: input.orgId, actorIdentityId: input.actorIdentityId, actorLabel: "Owner", kind: "data_location_confirmed", summary: `Found: ${category.category}` }, tx)
    }
    return { category, location }
  })
}

/**
 * "Ask who knows" -- emails whoever is named as the holder (an internal
 * person, via their dpdp.identity email, or the first owner at a named
 * processor org) and marks the location `asked`.
 */
export async function askWhoKnows(orgId: string, actorIdentityId: string, locationId: string) {
  return withDpdpContext({ orgId }, async (tx) => {
    const location = await tx.query.dpdpDataLocation.findFirst({ where: eq(dpdpDataLocation.id, locationId) })
    if (!location) throw new ServiceError("Not found", 404)
    const category = await tx.query.dpdpDataCategory.findFirst({ where: and(eq(dpdpDataCategory.id, location.categoryId), eq(dpdpDataCategory.orgId, orgId)) })
    if (!category) throw new ServiceError("Not found", 404)

    let toEmail: string | null = null
    if (location.holderKind === "internal_person" && location.holderPersonId) {
      const { dpdpIdentityEmail } = await import("@/lib/db")
      const email = await tx.query.dpdpIdentityEmail.findFirst({ where: and(eq(dpdpIdentityEmail.identityId, location.holderPersonId), eq(dpdpIdentityEmail.isPrimary, true)) })
      toEmail = email?.email ?? null
    } else if (location.holderKind === "processor_org" && location.holderOrgId) {
      const holderOrgId = location.holderOrgId
      const firstOwner = await tx.query.dpdpMembership.findFirst({ where: and(eq(dpdpMembership.orgId, holderOrgId), eq(dpdpMembership.level, "owner"), eq(dpdpMembership.state, "active")) })
      if (firstOwner) {
        const { dpdpIdentityEmail } = await import("@/lib/db")
        const email = await tx.query.dpdpIdentityEmail.findFirst({ where: and(eq(dpdpIdentityEmail.identityId, firstOwner.identityId), eq(dpdpIdentityEmail.isPrimary, true)) })
        toEmail = email?.email ?? null
      }
    }

    await tx.update(dpdpDataLocation).set({ state: "asked", askedAt: new Date() }).where(eq(dpdpDataLocation.id, locationId))
    await logDpdpEvent({ orgId, actorIdentityId, actorLabel: "Owner", kind: "data_location_asked", summary: `Asked where "${category.category}" is kept` }, tx)

    if (toEmail) {
      await sendEmail({
        to: toEmail,
        subject: `Where is this kept? — ${category.category}`,
        html: emailTemplate(
          "One question about where something is kept",
          `We need the exact place: a folder, a system, a server, or a room and a cupboard for <strong>${category.category}</strong>. Reply, or press the link. No password needed.`,
        ),
      })
    }
    return true
  })
}

export async function confirmDataLocation(orgId: string, actorIdentityId: string, locationId: string, pathText: string) {
  if (!pathText.trim()) throw new ServiceError("Say where it is kept", 400)
  return withDpdpContext({ orgId }, async (tx) => {
    const location = await tx.query.dpdpDataLocation.findFirst({ where: eq(dpdpDataLocation.id, locationId) })
    if (!location) throw new ServiceError("Not found", 404)
    const category = await tx.query.dpdpDataCategory.findFirst({ where: and(eq(dpdpDataCategory.id, location.categoryId), eq(dpdpDataCategory.orgId, orgId)) })
    if (!category) throw new ServiceError("Not found", 404)

    const [updated] = await tx.update(dpdpDataLocation).set({ pathText: pathText.trim(), state: "confirmed", confirmedBy: actorIdentityId, confirmedAt: new Date() }).where(eq(dpdpDataLocation.id, locationId)).returning()
    await logDpdpEvent({ orgId, actorIdentityId, actorLabel: "Owner", kind: "data_location_confirmed", summary: `Found: ${category.category}` }, tx)
    return updated
  })
}

/**
 * For an advisor's "Where their data is" screen. data_category/
 * data_location have plain org_id RLS, not a relationship-aware policy
 * (drizzle/0415's own documented scope), so the relationship check has to
 * happen HERE, explicitly, before the GUC is set to the client's org --
 * see assertDpdpRelationship's own doc comment for why.
 */
export async function listClientDataMap(advisorOrgId: string, clientOrgId: string): Promise<DataMapRow[]> {
  const { assertDpdpRelationship } = await import("./dpdp-organisation-service")
  await assertDpdpRelationship(advisorOrgId, clientOrgId, ["advises", "audits"])
  return listDataMap(clientOrgId)
}

export async function orgExists(orgId: string) {
  return Boolean(await withDpdpContext({ orgId }, (tx) => tx.query.dpdpOrganisation.findFirst({ where: eq(dpdpOrganisation.id, orgId) })))
}
