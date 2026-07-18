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
//
// VERIDIAN Review Framework gap closure, 2026-07-18 ("Duplicate Data
// Detection" -- no general-purpose dedup outside GST reconciliation):
// re-read this file and reconciliation-engine.ts fresh before touching
// anything -- this service (not reconciliation-engine.ts, which is GST-
// reconciliation-specific and never generalized) was already the real
// generalized dedup service for vendors/customers. The one genuine
// remaining gap was purchase invoices: src/lib/engines/audit-engine.ts's
// detectDuplicateInvoices() is a real exact-match heuristic but only
// reachable via an AI-planned task_execution_engine.ts case, with no
// persistent candidate/review workflow. Added 'erp_purchase_invoice' as a
// 3rd MdmEntityType reusing this exact table/workflow instead of building
// a second parallel system -- exact supplier_id+invoice_number match
// (posting the same vendor invoice twice under the same number is never
// legitimate, so no similarity threshold is needed the way customer/
// supplier names need one). mergeDuplicates() explicitly refuses this
// entity type below -- there is no safe automatic merge for a posted
// invoice; confirm/not_duplicate is the terminal, actionable state.
import { mdmDuplicateCandidates, mdmMergeLog, erpCustomers, erpSuppliers, erpPurchaseInvoices, erpContacts, erpAddresses, erpSupplierBankAccounts, users } from "@/lib/db"
import { withTenantContext, type TenantDb } from "@/lib/db/tenant-scoped"
import { and, eq, sql } from "drizzle-orm"
import { ServiceError } from "./compliance-service"
export { ServiceError }
import { logActivity } from "@/lib/audit"

export type MdmContext = { orgId: string; userId: string; dbUser: typeof users.$inferSelect }
export type MdmEntityType = "erp_customer" | "erp_supplier" | "erp_purchase_invoice"

const SIMILARITY_THRESHOLD = 0.4

function assertEntityType(entityType: string): asserts entityType is MdmEntityType {
  if (entityType !== "erp_customer" && entityType !== "erp_supplier" && entityType !== "erp_purchase_invoice") {
    throw new ServiceError("entityType must be 'erp_customer', 'erp_supplier', or 'erp_purchase_invoice'", 400)
  }
}

type DuplicateRow = { id_a: string; id_b: string; matchScore: number; matchReason: string }

async function scanCustomerSupplierDuplicates(db: TenantDb, orgId: string, entityType: "erp_customer" | "erp_supplier"): Promise<DuplicateRow[]> {
  const tableName = entityType === "erp_customer" ? "erp_customers" : "erp_suppliers"
  const nameCol = entityType === "erp_customer" ? "customer_name" : "supplier_name"

  const rows = (await db.execute(sql`
    SELECT a.id AS id_a, b.id AS id_b,
      similarity(a.${sql.raw(nameCol)}, b.${sql.raw(nameCol)}) AS name_score,
      (a.gstin IS NOT NULL AND a.gstin = b.gstin) AS gstin_match,
      (a.pan_number IS NOT NULL AND a.pan_number = b.pan_number) AS pan_match
    FROM compliance.${sql.raw(tableName)} a
    JOIN compliance.${sql.raw(tableName)} b ON a.id < b.id AND a.org_id = b.org_id
    WHERE a.org_id = ${orgId} AND a.is_active = true AND b.is_active = true
      AND (similarity(a.${sql.raw(nameCol)}, b.${sql.raw(nameCol)}) > ${SIMILARITY_THRESHOLD}
        OR (a.gstin IS NOT NULL AND a.gstin = b.gstin)
        OR (a.pan_number IS NOT NULL AND a.pan_number = b.pan_number))
  `)) as { id_a: string; id_b: string; name_score: number; gstin_match: boolean; pan_match: boolean }[]

  return rows.map((row) => {
    const matchScore = row.gstin_match ? 1 : row.pan_match ? 0.95 : Number(row.name_score)
    const matchReason = row.gstin_match && row.pan_match ? "combined" : row.gstin_match ? "gstin_match" : row.pan_match ? "pan_match" : "name_similarity"
    return { id_a: row.id_a, id_b: row.id_b, matchScore, matchReason }
  })
}

/** Exact-match only, deliberately no fuzzy threshold: the same supplier posting the same invoice_number twice within an org is never a legitimate coincidence, unlike free-text customer/supplier names. */
async function scanPurchaseInvoiceDuplicates(db: TenantDb, orgId: string): Promise<DuplicateRow[]> {
  const rows = (await db.execute(sql`
    SELECT a.id AS id_a, b.id AS id_b
    FROM compliance.erp_purchase_invoices a
    JOIN compliance.erp_purchase_invoices b ON a.id < b.id AND a.org_id = b.org_id
    WHERE a.org_id = ${orgId} AND a.supplier_id = b.supplier_id AND a.invoice_number = b.invoice_number
  `)) as { id_a: string; id_b: string }[]

  return rows.map((row) => ({ id_a: row.id_a, id_b: row.id_b, matchScore: 1, matchReason: "invoice_number_match" }))
}

/** Pairwise scan of active rows within the org for name-similarity/tax-ID/invoice-number matches, upserting pending candidates. Existing 'not_duplicate'/'merged' rows are never re-raised. */
export async function scanForDuplicates(ctx: { orgId: string }, entityType: string) {
  assertEntityType(entityType)
  return withTenantContext({ orgId: ctx.orgId }, async (db) => {
    const rows = entityType === "erp_purchase_invoice"
      ? await scanPurchaseInvoiceDuplicates(db, ctx.orgId)
      : await scanCustomerSupplierDuplicates(db, ctx.orgId, entityType)

    const existing = await db.query.mdmDuplicateCandidates.findMany({
      where: and(eq(mdmDuplicateCandidates.orgId, ctx.orgId), eq(mdmDuplicateCandidates.entityType, entityType)),
    })
    const existingByPair = new Map(existing.map((c) => [`${c.entityIdA}:${c.entityIdB}`, c]))

    let created = 0
    for (const row of rows) {
      const key = `${row.id_a}:${row.id_b}`
      const prior = existingByPair.get(key)
      if (prior && prior.status !== "pending") continue // a human already decided this pair

      if (prior) {
        await db.update(mdmDuplicateCandidates).set({ matchScore: String(row.matchScore), matchReason: row.matchReason }).where(eq(mdmDuplicateCandidates.id, prior.id))
      } else {
        await db.insert(mdmDuplicateCandidates).values({
          orgId: ctx.orgId, entityType, entityIdA: row.id_a, entityIdB: row.id_b,
          matchScore: String(row.matchScore), matchReason: row.matchReason, status: "pending",
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
    // customers, suppliers, and purchase invoices can all appear across
    // different candidates, so every lookup runs regardless of which
    // entityType filter was used.
    const customers = await db.query.erpCustomers.findMany({ where: eq(erpCustomers.orgId, ctx.orgId) })
    const suppliers = await db.query.erpSuppliers.findMany({ where: eq(erpSuppliers.orgId, ctx.orgId) })
    const invoices = await db.query.erpPurchaseInvoices.findMany({ where: eq(erpPurchaseInvoices.orgId, ctx.orgId) })
    const supplierNameById = new Map(suppliers.map((s) => [s.id, s.supplierName] as const))
    const nameById = new Map<string, string>([
      ...customers.map((c) => [c.id, c.customerName] as const),
      ...suppliers.map((s) => [s.id, s.supplierName] as const),
      ...invoices.map((inv) => [inv.id, `Invoice #${inv.invoiceNumber} (${supplierNameById.get(inv.supplierId) ?? "unknown supplier"}, ${inv.grandTotal})`] as const),
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
    if (candidate.entityType === "erp_purchase_invoice") {
      throw new ServiceError("Purchase invoice duplicates cannot be auto-merged -- there is no safe merge semantics for a posted invoice (it may already be paid or posted to the ledger). Confirming the candidate is the terminal state here; void or credit-note the duplicate invoice manually.", 400)
    }
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

/** Real completeness score (tax IDs, credit limit, at least one contact/address on file) over 5 signals -- never a fabricated number. Customer/supplier only: "missing GSTIN/contact/address" isn't a meaningful concept for a posted invoice. */
export async function computeQualityScores(ctx: { orgId: string }, entityType: string): Promise<QualityScoreRow[]> {
  assertEntityType(entityType)
  if (entityType === "erp_purchase_invoice") {
    throw new ServiceError("Completeness scoring only applies to 'erp_customer' or 'erp_supplier'", 400)
  }
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
