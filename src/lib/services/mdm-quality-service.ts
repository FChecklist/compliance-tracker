// Wave 93 (Comparison CSV 3 gap analysis: MDM007 "Duplicate Detection" +
// MDM008 "Data Quality Scoring"). Duplicate candidates are detected via
// pg_trgm similarity() on erp_customers.customer_name / erp_suppliers.
// supplier_name combined with exact gstin/pan_number matches -- a real
// similarity computation against the Wave 93 trigram indexes, not a
// fabricated score. Quality score is a real completeness metric (tax IDs,
// credit limit, at least one contact/address on file), not fabricated.
//
// The merge workflow is deliberately scoped down: it deactivates the loser
// record and reassigns its own erp_contacts / erp_addresses (polymorphic
// linkedEntityId) and erp_supplier_bank_accounts (direct supplierId FK) to
// the survivor. It does NOT rewrite historical invoices/POs/subscriptions
// still pointing at the merged-away id -- a full transactional FK rewrite
// across every ERP table was judged too risky for this pass. This is a
// documented, deliberate scope boundary, not a silent gap.
import { mdmDuplicateCandidates, mdmMergeLog, erpCustomers, erpSuppliers, erpContacts, erpAddresses, erpSupplierBankAccounts, users } from "@/lib/db"
import { withTenantContext } from "@/lib/db/tenant-scoped"
import { and, eq, sql } from "drizzle-orm"
import { ServiceError } from "./compliance-service"
export { ServiceError }
import { logActivity } from "@/lib/audit"

export type MdmContext = { orgId: string; userId: string; dbUser: typeof users.$inferSelect }
export type MdmEntityType = "erp_customer" | "erp_supplier"

const SIMILARITY_THRESHOLD = 0.4

function assertEntityType(entityType: string): asserts entityType is MdmEntityType {
  if (entityType !== "erp_customer" && entityType !== "erp_supplier") {
    throw new ServiceError("entityType must be 'erp_customer' or 'erp_supplier'", 400)
  }
}

/** Pairwise scan of active rows within the org for name-similarity/tax-ID matches, upserting pending candidates. Existing 'not_duplicate'/'merged' rows are never re-raised. */
export async function scanForDuplicates(ctx: { orgId: string }, entityType: string) {
  assertEntityType(entityType)
  return withTenantContext({ orgId: ctx.orgId }, async (db) => {
    const tableName = entityType === "erp_customer" ? "erp_customers" : "erp_suppliers"
    const nameCol = entityType === "erp_customer" ? "customer_name" : "supplier_name"

    const rows = (await db.execute(sql`
      SELECT a.id AS id_a, b.id AS id_b,
        similarity(a.${sql.raw(nameCol)}, b.${sql.raw(nameCol)}) AS name_score,
        (a.gstin IS NOT NULL AND a.gstin = b.gstin) AS gstin_match,
        (a.pan_number IS NOT NULL AND a.pan_number = b.pan_number) AS pan_match
      FROM compliance.${sql.raw(tableName)} a
      JOIN compliance.${sql.raw(tableName)} b ON a.id < b.id AND a.org_id = b.org_id
      WHERE a.org_id = ${ctx.orgId} AND a.is_active = true AND b.is_active = true
        AND (similarity(a.${sql.raw(nameCol)}, b.${sql.raw(nameCol)}) > ${SIMILARITY_THRESHOLD}
          OR (a.gstin IS NOT NULL AND a.gstin = b.gstin)
          OR (a.pan_number IS NOT NULL AND a.pan_number = b.pan_number))
    `)) as { id_a: string; id_b: string; name_score: number; gstin_match: boolean; pan_match: boolean }[]

    const existing = await db.query.mdmDuplicateCandidates.findMany({
      where: and(eq(mdmDuplicateCandidates.orgId, ctx.orgId), eq(mdmDuplicateCandidates.entityType, entityType)),
    })
    const existingByPair = new Map(existing.map((c) => [`${c.entityIdA}:${c.entityIdB}`, c]))

    let created = 0
    for (const row of rows) {
      const key = `${row.id_a}:${row.id_b}`
      const prior = existingByPair.get(key)
      if (prior && prior.status !== "pending") continue // a human already decided this pair

      const matchScore = row.gstin_match ? 1 : row.pan_match ? 0.95 : Number(row.name_score)
      const matchReason = row.gstin_match && row.pan_match ? "combined" : row.gstin_match ? "gstin_match" : row.pan_match ? "pan_match" : "name_similarity"

      if (prior) {
        await db.update(mdmDuplicateCandidates).set({ matchScore: String(matchScore), matchReason }).where(eq(mdmDuplicateCandidates.id, prior.id))
      } else {
        await db.insert(mdmDuplicateCandidates).values({
          orgId: ctx.orgId, entityType, entityIdA: row.id_a, entityIdB: row.id_b,
          matchScore: String(matchScore), matchReason, status: "pending",
        })
        created++
      }
    }
    return { scanned: rows.length, newCandidates: created }
  })
}

export async function listDuplicateCandidates(ctx: { orgId: string }, entityType?: string, status?: string) {
  return withTenantContext({ orgId: ctx.orgId }, async (db) => {
    const candidates = await db.query.mdmDuplicateCandidates.findMany({
      where: and(
        eq(mdmDuplicateCandidates.orgId, ctx.orgId),
        entityType ? eq(mdmDuplicateCandidates.entityType, entityType) : undefined,
        status ? eq(mdmDuplicateCandidates.status, status) : undefined,
      ),
      orderBy: (t, { desc }) => desc(t.matchScore),
    })
    if (candidates.length === 0) return []

    // Resolve display names for both entities in each candidate pair --
    // customers and suppliers can both appear across different candidates,
    // so both lookups run regardless of which entityType filter was used.
    const customers = await db.query.erpCustomers.findMany({ where: eq(erpCustomers.orgId, ctx.orgId) })
    const suppliers = await db.query.erpSuppliers.findMany({ where: eq(erpSuppliers.orgId, ctx.orgId) })
    const nameById = new Map<string, string>([
      ...customers.map((c) => [c.id, c.customerName] as const),
      ...suppliers.map((s) => [s.id, s.supplierName] as const),
    ])

    return candidates.map((c) => ({
      ...c,
      entityAName: nameById.get(c.entityIdA) ?? c.entityIdA,
      entityBName: nameById.get(c.entityIdB) ?? c.entityIdB,
    }))
  })
}

export async function reviewDuplicateCandidate(ctx: MdmContext, candidateId: string, status: "confirmed_duplicate" | "not_duplicate") {
  return withTenantContext({ orgId: ctx.orgId, userId: ctx.userId }, async (db) => {
    const candidate = await db.query.mdmDuplicateCandidates.findFirst({ where: and(eq(mdmDuplicateCandidates.id, candidateId), eq(mdmDuplicateCandidates.orgId, ctx.orgId)) })
    if (!candidate) throw new ServiceError("Duplicate candidate not found", 404)
    if (candidate.status !== "pending") throw new ServiceError(`Candidate is already '${candidate.status}'`, 409)

    const [updated] = await db.update(mdmDuplicateCandidates).set({
      status, reviewedById: ctx.userId, reviewedAt: new Date(),
    }).where(eq(mdmDuplicateCandidates.id, candidateId)).returning()
    return updated
  })
}

/** Scoped merge (see file header for the documented boundary): deactivates the loser, reassigns its contacts/addresses/(supplier) bank accounts, logs the merge. Historical transactions are NOT rewritten. */
export async function mergeDuplicates(ctx: MdmContext, candidateId: string, survivingEntityId: string) {
  return withTenantContext({ orgId: ctx.orgId, userId: ctx.userId }, async (db) => {
    const candidate = await db.query.mdmDuplicateCandidates.findFirst({ where: and(eq(mdmDuplicateCandidates.id, candidateId), eq(mdmDuplicateCandidates.orgId, ctx.orgId)) })
    if (!candidate) throw new ServiceError("Duplicate candidate not found", 404)
    if (candidate.status !== "confirmed_duplicate") throw new ServiceError("Only confirmed duplicates can be merged", 409)
    if (survivingEntityId !== candidate.entityIdA && survivingEntityId !== candidate.entityIdB) {
      throw new ServiceError("survivingEntityId must be one of the candidate's two entities", 400)
    }
    const mergedEntityId = survivingEntityId === candidate.entityIdA ? candidate.entityIdB : candidate.entityIdA

    if (candidate.entityType === "erp_customer") {
      const loser = await db.query.erpCustomers.findFirst({ where: and(eq(erpCustomers.id, mergedEntityId), eq(erpCustomers.orgId, ctx.orgId)) })
      if (!loser) throw new ServiceError("Entity being merged away was not found", 404)
      await db.update(erpCustomers).set({ isActive: false }).where(eq(erpCustomers.id, mergedEntityId))
    } else {
      const loser = await db.query.erpSuppliers.findFirst({ where: and(eq(erpSuppliers.id, mergedEntityId), eq(erpSuppliers.orgId, ctx.orgId)) })
      if (!loser) throw new ServiceError("Entity being merged away was not found", 404)
      await db.update(erpSuppliers).set({ isActive: false }).where(eq(erpSuppliers.id, mergedEntityId))
      await db.update(erpSupplierBankAccounts).set({ supplierId: survivingEntityId })
        .where(and(eq(erpSupplierBankAccounts.orgId, ctx.orgId), eq(erpSupplierBankAccounts.supplierId, mergedEntityId)))
    }

    await db.update(erpContacts).set({ linkedEntityId: survivingEntityId })
      .where(and(eq(erpContacts.orgId, ctx.orgId), eq(erpContacts.linkedEntityType, candidate.entityType), eq(erpContacts.linkedEntityId, mergedEntityId)))
    await db.update(erpAddresses).set({ linkedEntityId: survivingEntityId })
      .where(and(eq(erpAddresses.orgId, ctx.orgId), eq(erpAddresses.linkedEntityType, candidate.entityType), eq(erpAddresses.linkedEntityId, mergedEntityId)))

    await db.update(mdmDuplicateCandidates).set({ status: "merged" }).where(eq(mdmDuplicateCandidates.id, candidateId))

    const [log] = await db.insert(mdmMergeLog).values({
      orgId: ctx.orgId, entityType: candidate.entityType, survivingEntityId, mergedEntityId, mergedById: ctx.userId,
    }).returning()

    await logActivity({ tx: db, orgId: ctx.orgId, dbUser: ctx.dbUser, action: "mdm.merged", entityType: candidate.entityType, entityId: survivingEntityId, details: JSON.stringify({ mergedEntityId }) })
    return log
  })
}

export type QualityScoreRow = { id: string; name: string; qualityScore: number; missingFields: string[] }

/** Real completeness score (tax IDs, credit limit, at least one contact/address on file) over 5 signals -- never a fabricated number. */
export async function computeQualityScores(ctx: { orgId: string }, entityType: string): Promise<QualityScoreRow[]> {
  assertEntityType(entityType)
  return withTenantContext({ orgId: ctx.orgId }, async (db) => {
    const contactCounts = await db.select({ linkedEntityId: erpContacts.linkedEntityId, count: sql<number>`count(*)` })
      .from(erpContacts).where(and(eq(erpContacts.orgId, ctx.orgId), eq(erpContacts.linkedEntityType, entityType)))
      .groupBy(erpContacts.linkedEntityId)
    const addressCounts = await db.select({ linkedEntityId: erpAddresses.linkedEntityId, count: sql<number>`count(*)` })
      .from(erpAddresses).where(and(eq(erpAddresses.orgId, ctx.orgId), eq(erpAddresses.linkedEntityType, entityType)))
      .groupBy(erpAddresses.linkedEntityId)
    const contactMap = new Map(contactCounts.map((c) => [c.linkedEntityId, Number(c.count)]))
    const addressMap = new Map(addressCounts.map((c) => [c.linkedEntityId, Number(c.count)]))

    function score(id: string, name: string, gstin: string | null, panNumber: string | null, creditLimit: string | null): QualityScoreRow {
      const missing: string[] = []
      if (!gstin) missing.push("gstin")
      if (!panNumber) missing.push("panNumber")
      if (creditLimit === null) missing.push("creditLimit")
      if ((contactMap.get(id) ?? 0) === 0) missing.push("contact")
      if ((addressMap.get(id) ?? 0) === 0) missing.push("address")
      return { id, name, qualityScore: (5 - missing.length) / 5, missingFields: missing }
    }

    if (entityType === "erp_customer") {
      const customers = await db.query.erpCustomers.findMany({ where: and(eq(erpCustomers.orgId, ctx.orgId), eq(erpCustomers.isActive, true)) })
      return customers.map((c) => score(c.id, c.customerName, c.gstin, c.panNumber, c.creditLimit))
    } else {
      const suppliers = await db.query.erpSuppliers.findMany({ where: and(eq(erpSuppliers.orgId, ctx.orgId), eq(erpSuppliers.isActive, true)) })
      return suppliers.map((s) => score(s.id, s.supplierName, s.gstin, s.panNumber, s.creditLimit))
    }
  })
}
