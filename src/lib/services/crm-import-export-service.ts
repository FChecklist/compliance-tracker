// Task #46 CRM feature-parity gap analysis (KERNEL_CONSOLIDATION_STATUS.md,
// finalized 2026-07-30 ~14:30 UTC), item 7: "CRM-specific import/export --
// exists for compliance/GST/bank-reconciliation, not for leads/contacts/
// accounts". Explicitly zero-new-batch-table: reuse the existing generic
// `ingestion_batches` table (already org/file/status/count-shaped) rather
// than a new CRM-specific batch table.
//
// Correction to the gap analysis's own premise (verified by direct grep
// before writing this): GST reconciliation does NOT use ingestionBatches --
// it has its own separate gstImportBatches table (schema.ts). The only real
// consumer of ingestionBatches before this file was /api/ingest/* (the
// compliance-item AI-extraction pipeline, src/app/api/ingest/route.ts +
// [batchId]/{route,confirm/route}.ts) -- this file follows that real
// pattern: create the batch row immediately (status: processing), parse the
// upload with the same @/lib/ingest/parser used there (generic CSV/XLSX
// parsing, nothing compliance-specific in it), validate every row, and
// track counts back onto the same batch row.
//
// Deliberately simpler than that pipeline in one respect: CRM row shapes
// are small and deterministic (a name + a handful of optional fields), so
// there is no AI-extraction step and no separate staging table + human
// review UI -- rows are validated and inserted in one pass, matching this
// task's own spec ("CSV/file -> crmLeads/crmOpportunities/accounts rows,
// validated, batched via ingestionBatches"). A row that fails validation is
// recorded in the batch's own extractionSummary/errorMessage columns
// (again, existing columns on ingestionBatches -- no new table) rather than
// a per-row staging record.
import { ingestionBatches, crmLeads, crmOpportunities, crmAccounts, crmContacts, crmStageHistory, users } from "@/lib/db"
import { withTenantContext, type TenantDb } from "@/lib/db/tenant-scoped"
import { eq, and, inArray } from "drizzle-orm"
import { createId } from "@paralleldrive/cuid2"
import { parseFile } from "@/lib/ingest/parser"
import type { ParsedRow } from "@/lib/ingest/types"
import { ServiceError } from "./compliance-service"
import { requireSalesEnabled } from "./crm-enablement-service"
import { canCreateCrmRecord } from "./crm-accounts-service"
import { isValidEmail, isValidPhoneNumber } from "@/lib/engines/data-quality-engine"
import { logActivity } from "@/lib/audit"

export { ServiceError }

export type CrmImportContext = { orgId: string; userId: string; dbUser: typeof users.$inferSelect }

export const CRM_IMPORT_ENTITIES = ["crm_lead", "crm_opportunity", "crm_account", "crm_contact"] as const
export type CrmImportEntity = (typeof CRM_IMPORT_ENTITIES)[number]

export function isCrmImportEntity(value: string): value is CrmImportEntity {
  return (CRM_IMPORT_ENTITIES as readonly string[]).includes(value)
}

const LEAD_STATUSES = ["new", "contacted", "qualified", "converted", "lost"] as const
const OPPORTUNITY_STAGES = ["prospecting", "proposal", "negotiation", "won", "lost"] as const
const ACCOUNT_LIFECYCLE_STAGES = ["prospect", "active_client", "dormant", "churned"] as const

// --- Pure helpers (unit-tested directly, no DB) -----------------------------

function pick(row: ParsedRow, ...keys: string[]): string {
  for (const key of keys) {
    const target = key.toLowerCase()
    const match = Object.keys(row).find((k) => k.trim().toLowerCase() === target)
    if (match === undefined) continue
    const value = row[match]
    if (value === null || value === undefined) continue
    const str = String(value).trim()
    if (str) return str
  }
  return ""
}

export type RowValidation<T> = { valid: true; values: T } | { valid: false; error: string }

export type LeadImportValues = {
  name: string; contactEmail: string | null; contactPhone: string | null
  source: string | null; status: (typeof LEAD_STATUSES)[number]
}

/** Pure row-format validator for a lead CSV/XLSX row -- no DB access. */
export function validateLeadRow(row: ParsedRow): RowValidation<LeadImportValues> {
  const name = pick(row, "name", "lead name", "full name")
  if (!name) return { valid: false, error: "name is required" }

  const contactEmail = pick(row, "contactEmail", "email") || null
  if (contactEmail && !isValidEmail(contactEmail)) return { valid: false, error: `"${contactEmail}" is not a valid email address` }

  const contactPhone = pick(row, "contactPhone", "phone") || null
  if (contactPhone && !isValidPhoneNumber(contactPhone)) return { valid: false, error: `"${contactPhone}" is not a valid phone number` }

  const statusRaw = pick(row, "status")
  const status = (statusRaw || "new").toLowerCase()
  if (!(LEAD_STATUSES as readonly string[]).includes(status)) {
    return { valid: false, error: `"${statusRaw}" is not a valid lead status (expected one of: ${LEAD_STATUSES.join(", ")})` }
  }

  return { valid: true, values: { name, contactEmail, contactPhone, source: pick(row, "source") || null, status: status as (typeof LEAD_STATUSES)[number] } }
}

export type OpportunityImportValues = {
  name: string; stage: (typeof OPPORTUNITY_STAGES)[number]; estimatedValue: string | null; expectedCloseDate: string | null
}

/** Pure row-format validator for an opportunity CSV/XLSX row -- no DB access. */
export function validateOpportunityRow(row: ParsedRow): RowValidation<OpportunityImportValues> {
  const name = pick(row, "name", "opportunity name", "deal name")
  if (!name) return { valid: false, error: "name is required" }

  const stageRaw = pick(row, "stage")
  const stage = (stageRaw || "prospecting").toLowerCase()
  if (!(OPPORTUNITY_STAGES as readonly string[]).includes(stage)) {
    return { valid: false, error: `"${stageRaw}" is not a valid stage (expected one of: ${OPPORTUNITY_STAGES.join(", ")})` }
  }

  const estimatedValueRaw = pick(row, "estimatedValue", "value", "amount")
  if (estimatedValueRaw && isNaN(Number(estimatedValueRaw))) {
    return { valid: false, error: `"${estimatedValueRaw}" is not a valid number for estimatedValue` }
  }

  const expectedCloseDateRaw = pick(row, "expectedCloseDate", "close date")
  if (expectedCloseDateRaw && isNaN(new Date(expectedCloseDateRaw).getTime())) {
    return { valid: false, error: `"${expectedCloseDateRaw}" is not a valid date for expectedCloseDate` }
  }

  return {
    valid: true,
    values: {
      name, stage: stage as (typeof OPPORTUNITY_STAGES)[number],
      estimatedValue: estimatedValueRaw || null,
      expectedCloseDate: expectedCloseDateRaw || null,
    },
  }
}

export type AccountImportValues = {
  name: string; industry: string | null; website: string | null; lifecycleStage: (typeof ACCOUNT_LIFECYCLE_STAGES)[number]
}

/** Pure row-format validator for an account CSV/XLSX row -- no DB access. */
export function validateAccountRow(row: ParsedRow): RowValidation<AccountImportValues> {
  const name = pick(row, "name", "account name", "company")
  if (!name) return { valid: false, error: "name is required" }

  const lifecycleStageRaw = pick(row, "lifecycleStage", "stage")
  const lifecycleStage = (lifecycleStageRaw || "prospect").toLowerCase()
  if (!(ACCOUNT_LIFECYCLE_STAGES as readonly string[]).includes(lifecycleStage)) {
    return { valid: false, error: `"${lifecycleStageRaw}" is not a valid lifecycle stage (expected one of: ${ACCOUNT_LIFECYCLE_STAGES.join(", ")})` }
  }

  return {
    valid: true,
    values: { name, industry: pick(row, "industry") || null, website: pick(row, "website") || null, lifecycleStage: lifecycleStage as (typeof ACCOUNT_LIFECYCLE_STAGES)[number] },
  }
}

export type ContactImportValues = { name: string; title: string | null; email: string | null; phone: string | null; accountRef: string }

/**
 * Pure row-format validator for a contact CSV/XLSX row -- no DB access.
 * `accountRef` (the account's id or name, whichever the row supplied) is
 * resolved against the real crm_accounts table by the caller, since that
 * lookup genuinely needs the DB -- this function only validates what's
 * checkable from the row's own text.
 */
export function validateContactRow(row: ParsedRow): RowValidation<ContactImportValues> {
  const name = pick(row, "name", "contact name", "full name")
  if (!name) return { valid: false, error: "name is required" }

  const accountRef = pick(row, "accountId", "accountName", "account", "company")
  if (!accountRef) return { valid: false, error: "accountId or accountName is required" }

  const email = pick(row, "email") || null
  if (email && !isValidEmail(email)) return { valid: false, error: `"${email}" is not a valid email address` }

  const phone = pick(row, "phone") || null
  if (phone && !isValidPhoneNumber(phone)) return { valid: false, error: `"${phone}" is not a valid phone number` }

  return { valid: true, values: { name, title: pick(row, "title") || null, email, phone, accountRef } }
}

// --- Import ------------------------------------------------------------------

export type ImportRowError = { row: number; error: string }
export type ImportResult = {
  batchId: string; status: "confirmed" | "failed"
  totalRows: number; insertedCount: number; rejectedCount: number
  insertedIds: string[]; errors: ImportRowError[]
}

export async function importCrmRecords(
  ctx: CrmImportContext,
  entity: CrmImportEntity,
  file: { fileName: string; buffer: Buffer; mimeType: string }
): Promise<ImportResult> {
  await requireSalesEnabled(ctx.orgId)
  if (entity === "crm_account" || entity === "crm_contact") {
    const gate = canCreateCrmRecord(ctx.dbUser.role)
    if (!gate.ok) throw new ServiceError(gate.reason, 403)
  }

  const batchId = createId()
  await withTenantContext({ orgId: ctx.orgId }, (db) =>
    db.insert(ingestionBatches).values({
      id: batchId,
      fileName: file.fileName,
      fileType: file.fileName.split(".").pop()?.toLowerCase() ?? "unknown",
      fileSizeBytes: file.buffer.length,
      orgId: ctx.orgId,
      uploadedById: ctx.userId,
      status: "processing",
      targetEntity: entity,
    })
  )

  try {
    const parsed = await parseFile(file.buffer, file.fileName, file.mimeType)

    const errors: ImportRowError[] = []
    const insertedIds: string[] = []

    await withTenantContext({ orgId: ctx.orgId, userId: ctx.userId }, async (db) => {
      const leadStageHistoryRows: { orgId: string; entityType: "lead"; entityId: string; fromStage: null; toStage: string; changedById: string }[] = []

      for (let i = 0; i < parsed.rows.length; i++) {
        const sourceRow = i + 1
        try {
          const result = await importOneRow(db, ctx, entity, parsed.rows[i], leadStageHistoryRows)
          if (result.status === "inserted") insertedIds.push(result.id)
          else errors.push({ row: sourceRow, error: result.error })
        } catch (err) {
          errors.push({ row: sourceRow, error: err instanceof ServiceError ? err.message : (err as Error).message })
        }
      }

      if (leadStageHistoryRows.length > 0) await db.insert(crmStageHistory).values(leadStageHistoryRows)
    })

    const status: ImportResult["status"] = insertedIds.length > 0 ? "confirmed" : "failed"
    await withTenantContext({ orgId: ctx.orgId }, (db) =>
      db.update(ingestionBatches).set({
        status,
        totalRows: parsed.totalRows,
        extractedCount: parsed.totalRows - errors.length,
        confirmedCount: insertedIds.length,
        rejectedCount: errors.length,
        extractionSummary: JSON.stringify({ errors }),
        errorMessage: insertedIds.length === 0 ? `All ${parsed.totalRows} row(s) failed validation` : null,
        confirmedAt: insertedIds.length > 0 ? new Date() : null,
      }).where(eq(ingestionBatches.id, batchId))
    )

    await withTenantContext({ orgId: ctx.orgId, userId: ctx.userId }, (db) =>
      logActivity({
        tx: db, orgId: ctx.orgId, dbUser: ctx.dbUser,
        action: "crm_import.completed", entityType: entity, entityId: batchId,
        details: `${insertedIds.length} inserted, ${errors.length} rejected from ${file.fileName}`,
      })
    )

    return { batchId, status, totalRows: parsed.totalRows, insertedCount: insertedIds.length, rejectedCount: errors.length, insertedIds, errors }
  } catch (err) {
    await withTenantContext({ orgId: ctx.orgId }, (db) =>
      db.update(ingestionBatches).set({ status: "failed", errorMessage: (err as Error).message }).where(eq(ingestionBatches.id, batchId))
    ).catch(() => {})
    throw err
  }
}

type RowOutcome = { status: "inserted"; id: string } | { status: "rejected"; error: string }

/** Inserts one row into `entity`'s target table, or reports why it was rejected. Format-invalid rows are rejected here rather than thrown; DB-dependent failures (e.g. a contact row's account not found) throw ServiceError, caught by the caller's loop. */
async function importOneRow(
  db: TenantDb, ctx: CrmImportContext, entity: CrmImportEntity, row: ParsedRow,
  leadStageHistoryRows: { orgId: string; entityType: "lead"; entityId: string; fromStage: null; toStage: string; changedById: string }[]
): Promise<RowOutcome> {
  if (entity === "crm_lead") {
    const validation = validateLeadRow(row)
    if (!validation.valid) return { status: "rejected", error: validation.error }
    const [lead] = await db.insert(crmLeads).values({
      orgId: ctx.orgId, name: validation.values.name, contactEmail: validation.values.contactEmail,
      contactPhone: validation.values.contactPhone, source: validation.values.source,
      status: validation.values.status, createdById: ctx.userId,
    }).returning()
    leadStageHistoryRows.push({ orgId: ctx.orgId, entityType: "lead", entityId: lead.id, fromStage: null, toStage: lead.status, changedById: ctx.userId })
    return { status: "inserted", id: lead.id }
  }

  if (entity === "crm_opportunity") {
    const validation = validateOpportunityRow(row)
    if (!validation.valid) return { status: "rejected", error: validation.error }
    const [opportunity] = await db.insert(crmOpportunities).values({
      orgId: ctx.orgId, name: validation.values.name, stage: validation.values.stage,
      estimatedValue: validation.values.estimatedValue, expectedCloseDate: validation.values.expectedCloseDate,
      createdById: ctx.userId,
    }).returning()
    return { status: "inserted", id: opportunity.id }
  }

  if (entity === "crm_account") {
    const validation = validateAccountRow(row)
    if (!validation.valid) return { status: "rejected", error: validation.error }
    const [account] = await db.insert(crmAccounts).values({
      orgId: ctx.orgId, name: validation.values.name, industry: validation.values.industry,
      website: validation.values.website, lifecycleStage: validation.values.lifecycleStage,
      createdById: ctx.userId,
    }).returning()
    return { status: "inserted", id: account.id }
  }

  // crm_contact
  const validation = validateContactRow(row)
  if (!validation.valid) return { status: "rejected", error: validation.error }
  const account = await db.query.crmAccounts.findFirst({
    where: and(eq(crmAccounts.orgId, ctx.orgId), eq(crmAccounts.id, validation.values.accountRef)),
  }) ?? await db.query.crmAccounts.findFirst({
    where: and(eq(crmAccounts.orgId, ctx.orgId), eq(crmAccounts.name, validation.values.accountRef)),
  })
  if (!account) throw new ServiceError(`No account found matching "${validation.values.accountRef}"`, 404)

  const [contact] = await db.insert(crmContacts).values({
    orgId: ctx.orgId, accountId: account.id, name: validation.values.name, title: validation.values.title,
    email: validation.values.email, phone: validation.values.phone, createdById: ctx.userId,
  }).returning()
  return { status: "inserted", id: contact.id }
}

// --- Batch listing -------------------------------------------------------------

export async function listCrmImportBatches(ctx: { orgId: string }, entity?: CrmImportEntity) {
  return withTenantContext({ orgId: ctx.orgId }, (db) =>
    db.query.ingestionBatches.findMany({
      where: entity
        ? and(eq(ingestionBatches.orgId, ctx.orgId), eq(ingestionBatches.targetEntity, entity))
        : and(eq(ingestionBatches.orgId, ctx.orgId), inArray(ingestionBatches.targetEntity, CRM_IMPORT_ENTITIES as unknown as string[])),
      orderBy: (b, { desc }) => [desc(b.createdAt)],
      limit: 50,
      with: { uploadedBy: { columns: { name: true } } },
    })
  )
}

export async function getCrmImportBatch(ctx: { orgId: string }, batchId: string) {
  const batch = await withTenantContext({ orgId: ctx.orgId }, (db) =>
    db.query.ingestionBatches.findFirst({
      where: and(eq(ingestionBatches.id, batchId), eq(ingestionBatches.orgId, ctx.orgId)),
      with: { uploadedBy: { columns: { name: true } } },
    })
  )
  if (!batch || !isCrmImportEntity(batch.targetEntity ?? "")) throw new ServiceError("Import batch not found", 404)
  return batch
}

// --- Export --------------------------------------------------------------------

export type CrmExportResult = { fileName: string; csv: string; rowCount: number }

export async function exportCrmRecords(ctx: { orgId: string }, entity: CrmImportEntity): Promise<CrmExportResult> {
  await requireSalesEnabled(ctx.orgId)

  const rows = await withTenantContext({ orgId: ctx.orgId }, async (db) => {
    if (entity === "crm_lead") {
      const leads = await db.query.crmLeads.findMany({ where: eq(crmLeads.orgId, ctx.orgId), orderBy: (t, { desc }) => desc(t.createdAt) })
      return leads.map((l) => ({ name: l.name, contactEmail: l.contactEmail ?? "", contactPhone: l.contactPhone ?? "", source: l.source ?? "", status: l.status, createdAt: l.createdAt.toISOString() }))
    }
    if (entity === "crm_opportunity") {
      const opportunities = await db.query.crmOpportunities.findMany({ where: eq(crmOpportunities.orgId, ctx.orgId), orderBy: (t, { desc }) => desc(t.createdAt) })
      return opportunities.map((o) => ({ name: o.name, stage: o.stage, estimatedValue: o.estimatedValue ?? "", expectedCloseDate: o.expectedCloseDate ?? "", createdAt: o.createdAt.toISOString() }))
    }
    if (entity === "crm_account") {
      const accounts = await db.query.crmAccounts.findMany({ where: eq(crmAccounts.orgId, ctx.orgId), orderBy: (t, { desc }) => desc(t.createdAt) })
      return accounts.map((a) => ({ name: a.name, industry: a.industry ?? "", website: a.website ?? "", lifecycleStage: a.lifecycleStage, createdAt: a.createdAt.toISOString() }))
    }
    // crm_contacts/crm_accounts have no drizzle relation registered between
    // them (app-level link only, same convention as every other CRM
    // cross-entity column -- see schema.ts's own note on crm_accounts) --
    // two flat queries + an in-memory join, same shape as
    // findDuplicateAccountsInOrg's own org-scoped in-memory scan.
    const [contacts, accounts] = await Promise.all([
      db.query.crmContacts.findMany({ where: eq(crmContacts.orgId, ctx.orgId), orderBy: (t, { desc }) => desc(t.createdAt) }),
      db.query.crmAccounts.findMany({ where: eq(crmAccounts.orgId, ctx.orgId), columns: { id: true, name: true } }),
    ])
    const accountNameById = new Map(accounts.map((a) => [a.id, a.name]))
    return contacts.map((c) => ({ name: c.name, accountName: accountNameById.get(c.accountId) ?? "", title: c.title ?? "", email: c.email ?? "", phone: c.phone ?? "", createdAt: c.createdAt.toISOString() }))
  })

  // eslint-disable-next-line @typescript-eslint/no-require-imports
  const XLSX = require("xlsx")
  const sheet = XLSX.utils.json_to_sheet(rows)
  const csv = XLSX.utils.sheet_to_csv(sheet)

  return { fileName: `${entity}-export.csv`, csv, rowCount: rows.length }
}
