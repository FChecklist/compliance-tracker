// Sumeet requirement (new, 2026-09-18): "PROJEXA-AI.COM SHOULD BE ABLE TO
// CAPTURE, ANALYZE, FIX, ALL OF THESE AS A SOFTWARE FOR EVERY PROJECT" -- 28
// individually-investigable failure modes (of the 31 given; items 29-31 are
// meta-statements about the system as a whole, not individually testable).
//
// ★ EVERY CHECK BELOW IS DETERMINISTIC AND BOOLEAN, PER RECORD ★. None of
// these are AI judgment calls, heuristics with a confidence score, or fuzzy
// matches -- each is a plain SQL-expressible predicate over already-real
// columns (some added by this same change, see schema.ts's own comments on
// each new column for why). A record either satisfies the predicate or it
// doesn't; there is no "maybe".
//
// ★ SEVERAL ITEMS SHARE ONE REAL DETECTOR, ON PURPOSE (X-27 "single
// producer" discipline, same rule boq-analysis-service.ts's own header
// states) ★. The Owner's 31 items are not 31 independent facts -- several
// name the same underlying gap from a different angle:
//   - #1 ("extra work done, never captured") and #8 ("work happened not
//     captured") are the SAME signal (siteDiaryWithoutProgressEntry) --
//     "extra" work is still "work", and this codebase has exactly one way
//     to notice work happened with nothing capturing it: a diary entry with
//     no matching progress entry that day.
//   - #13 ("new scope of work decided") and #14 ("new BOQ decided") are the
//     same signal (newBoqRevisions) because this product's own design
//     already makes BOQ the record of scope (R-96's own recorded caveat).
//   - #15 ("customer approval on new scope") and #16 ("... on new BOQ") are
//     the same signal (boqCustomerApproval) for the identical reason.
//   - #26 ("user forgets") reuses #20's detector (a missed daily report IS
//     the forgetting); #27 ("user doesn't remember") reuses #18's detector
//     (material issued with no BOQ line recorded IS not remembering which
//     line it was for).
// Each is still exposed under its own Owner-facing key below, so nothing is
// silently hidden -- but the CODE computing it is written once.
//
// ★ WHAT NEEDED NEW SCHEMA, AND WHAT DIDN'T ★ -- see schema.ts's own
// comments on each new column/table added alongside this file
// (construction_work_progress_entries.drawing_document_id/*, construction_
// change_orders.boq_revision_id, construction_boqs.customer_approved_*,
// construction_interim_bills.retention_released_*, construction_labour_
// roster.employee_id, erp_purchase_order_items/erp_purchase_invoice_items.
// boq_line_item_id, and the two new tables construction_vendor_disputes/
// construction_customer_complaints) -- roughly half the 28 items needed a
// real new fact recorded somewhere; the rest were already fully answerable
// from existing tables and simply had never been joined this way before.
import { and, eq, gte, isNull, isNotNull, ne, lt, sql } from "drizzle-orm"
import { withTenantContext, type TenantDb } from "@/lib/db/tenant-scoped"
import {
  constructionSiteDiaries, constructionWorkProgressEntries,
  constructionChangeOrders, constructionBoqs, constructionBoqLineItems,
  constructionMaterialIssues, constructionLabourRoster, constructionPunchListItems,
  constructionInterimBills, constructionInterimBillLineItems,
  constructionVendorDisputes, constructionCustomerComplaints,
  erpPurchaseInvoiceItems,
  documents, projects,
} from "@/lib/db"
import { ServiceError } from "./compliance-service"
export { ServiceError }

export type ExceptionsContext = { orgId: string }

/** One flagged record, always citing exactly which row and why -- never a bare count with no way to look at the evidence. */
export type ExceptionRecord = { id: string; detail: string }

/** Sumeet's own item number/title, the deterministic boolean verdict, and the flagged rows (empty array = verdict false for every record checked). */
export type ExceptionCheck = {
  item: number
  title: string
  /** True if ANY record was flagged -- "this project currently has this problem". */
  flagged: boolean
  count: number
  records: ExceptionRecord[]
  /** The exact predicate, in words, so a reader can verify the boolean without reading the code. */
  formula: string
}

const TODAY = () => new Date().toISOString().slice(0, 10)

// ─────────────────────────────────────────────────────────────────────────
// #1 / #8 -- SHARED DETECTOR: a site diary was filed for a date, but no
// work-progress entry exists for the same project+date. A diary with real
// text in workDone but zero progress entries is exactly "work happened
// (someone wrote it down in the diary) but nothing captured it as
// measurable progress" -- deterministic set difference, not a heuristic.
// ─────────────────────────────────────────────────────────────────────────
export async function findDiaryWithoutProgressEntry(db: TenantDb, orgId: string, projectId: string): Promise<ExceptionRecord[]> {
  const diaries = await db.query.constructionSiteDiaries.findMany({
    where: and(eq(constructionSiteDiaries.orgId, orgId), eq(constructionSiteDiaries.projectId, projectId), isNotNull(constructionSiteDiaries.workDone)),
    columns: { id: true, diaryDate: true, workDone: true },
  })
  const progressDates = new Set(
    (await db.query.constructionWorkProgressEntries.findMany({
      where: and(eq(constructionWorkProgressEntries.orgId, orgId), eq(constructionWorkProgressEntries.projectId, projectId)),
      columns: { entryDate: true },
    })).map((p) => p.entryDate)
  )
  return diaries
    .filter((d) => d.workDone && d.workDone.trim().length > 0 && !progressDates.has(d.diaryDate))
    .map((d) => ({ id: d.id, detail: `Diary ${d.diaryDate} records work done but no progress entry exists for that date` }))
}

// ─────────────────────────────────────────────────────────────────────────
// #2 -- an APPROVED change order (real extra scope, cost impact != 0) whose
// linked BOQ revision (boqRevisionId) has never had a single interim bill
// raised against ANY of its line items. "Approved and priced into the BOQ,
// never billed."
// ─────────────────────────────────────────────────────────────────────────
export async function findApprovedChangeOrdersNeverBilled(db: TenantDb, orgId: string, projectId: string): Promise<ExceptionRecord[]> {
  const orders = await db.query.constructionChangeOrders.findMany({
    where: and(
      eq(constructionChangeOrders.orgId, orgId), eq(constructionChangeOrders.projectId, projectId),
      eq(constructionChangeOrders.status, "approved"), ne(constructionChangeOrders.costImpact, "0"),
      isNotNull(constructionChangeOrders.boqRevisionId)
    ),
    columns: { id: true, number: true, boqRevisionId: true, costImpact: true },
  })
  const out: ExceptionRecord[] = []
  for (const co of orders) {
    const lineItems = await db.query.constructionBoqLineItems.findMany({ where: eq(constructionBoqLineItems.boqId, co.boqRevisionId!), columns: { id: true } })
    if (lineItems.length === 0) continue
    const billed = await db.query.constructionInterimBillLineItems.findFirst({
      where: sql`${constructionInterimBillLineItems.boqLineItemId} IN (${sql.join(lineItems.map((l) => sql`${l.id}`), sql`, `)})`,
    })
    if (!billed) out.push({ id: co.id, detail: `CO-${co.number} approved (cost impact ${co.costImpact}) and linked to a BOQ revision, but no interim bill has ever been raised against it` })
  }
  return out
}

// ─────────────────────────────────────────────────────────────────────────
// #3 / #4 -- a work-progress entry names a drawing (drawingDocumentId) that
// is either not yet confirmed (#3) or superseded (#4, isLatestVersion=false).
// ─────────────────────────────────────────────────────────────────────────
export async function findUnconfirmedDrawingProgress(db: TenantDb, orgId: string, projectId: string): Promise<ExceptionRecord[]> {
  const rows = await db.query.constructionWorkProgressEntries.findMany({
    where: and(
      eq(constructionWorkProgressEntries.orgId, orgId), eq(constructionWorkProgressEntries.projectId, projectId),
      isNotNull(constructionWorkProgressEntries.drawingDocumentId), isNull(constructionWorkProgressEntries.drawingConfirmedAt)
    ),
    columns: { id: true, entryDate: true, drawingDocumentId: true },
  })
  return rows.map((r) => ({ id: r.id, detail: `Progress entry ${r.entryDate} built from drawing ${r.drawingDocumentId} with no confirmation on record` }))
}

export async function findOldDrawingProgress(db: TenantDb, orgId: string, projectId: string): Promise<ExceptionRecord[]> {
  const rows = await db.query.constructionWorkProgressEntries.findMany({
    where: and(eq(constructionWorkProgressEntries.orgId, orgId), eq(constructionWorkProgressEntries.projectId, projectId), isNotNull(constructionWorkProgressEntries.drawingDocumentId)),
    columns: { id: true, entryDate: true, drawingDocumentId: true },
  })
  const out: ExceptionRecord[] = []
  for (const r of rows) {
    const doc = await db.query.documents.findFirst({ where: eq(documents.id, r.drawingDocumentId!), columns: { isLatestVersion: true, name: true } })
    if (doc && !doc.isLatestVersion) out.push({ id: r.id, detail: `Progress entry ${r.entryDate} built from a superseded drawing (${doc.name})` })
  }
  return out
}

// ─────────────────────────────────────────────────────────────────────────
// #5 -- a change order still 'pending_approval' more than STUCK_APPROVAL_DAYS
// after it was created (createdAt), with no approvedAt/rejectedAt recorded.
// ─────────────────────────────────────────────────────────────────────────
export const STUCK_APPROVAL_DAYS = 7

export async function findStuckApprovals(db: TenantDb, orgId: string, projectId: string): Promise<ExceptionRecord[]> {
  const cutoff = new Date(Date.now() - STUCK_APPROVAL_DAYS * 24 * 60 * 60 * 1000)
  const rows = await db.query.constructionChangeOrders.findMany({
    where: and(
      eq(constructionChangeOrders.orgId, orgId), eq(constructionChangeOrders.projectId, projectId),
      eq(constructionChangeOrders.status, "pending_approval"), lt(constructionChangeOrders.createdAt, cutoff)
    ),
    columns: { id: true, number: true, createdAt: true },
  })
  return rows.map((r) => ({ id: r.id, detail: `CO-${r.number} has been pending_approval since ${r.createdAt.toISOString().slice(0, 10)}, over ${STUCK_APPROVAL_DAYS} days with no decision` }))
}

// ─────────────────────────────────────────────────────────────────────────
// #6 -- an approved change order self-approved by its own requester
// (approvedById === requestedById) -- no independent check on the decision.
// ─────────────────────────────────────────────────────────────────────────
export async function findSelfApprovedChangeOrders(db: TenantDb, orgId: string, projectId: string): Promise<ExceptionRecord[]> {
  const rows = await db.query.constructionChangeOrders.findMany({
    where: and(eq(constructionChangeOrders.orgId, orgId), eq(constructionChangeOrders.projectId, projectId), eq(constructionChangeOrders.status, "approved")),
    columns: { id: true, number: true, requestedById: true, approvedById: true },
  })
  return rows.filter((r) => r.approvedById && r.approvedById === r.requestedById)
    .map((r) => ({ id: r.id, detail: `CO-${r.number} was approved by the same person who requested it -- no independent approval` }))
}

// ─────────────────────────────────────────────────────────────────────────
// #7 -- work-progress entries recorded against a BOQ line whose BOQ is not
// (yet, or no longer) 'approved' -- work happening against an unapproved BOQ.
// ─────────────────────────────────────────────────────────────────────────
export async function findWorkWithoutApprovedBoq(db: TenantDb, orgId: string, projectId: string): Promise<ExceptionRecord[]> {
  const entries = await db.query.constructionWorkProgressEntries.findMany({
    where: and(eq(constructionWorkProgressEntries.orgId, orgId), eq(constructionWorkProgressEntries.projectId, projectId), isNotNull(constructionWorkProgressEntries.boqLineItemId)),
    columns: { id: true, entryDate: true, boqLineItemId: true },
  })
  const out: ExceptionRecord[] = []
  const boqStatusCache = new Map<string, string>()
  for (const e of entries) {
    const line = await db.query.constructionBoqLineItems.findFirst({ where: eq(constructionBoqLineItems.id, e.boqLineItemId!), columns: { boqId: true } })
    if (!line) continue
    let status = boqStatusCache.get(line.boqId)
    if (status === undefined) {
      const boq = await db.query.constructionBoqs.findFirst({ where: eq(constructionBoqs.id, line.boqId), columns: { status: true } })
      status = boq?.status ?? "unknown"
      boqStatusCache.set(line.boqId, status)
    }
    if (status !== "approved") out.push({ id: e.id, detail: `Progress entry ${e.entryDate} recorded against a BOQ line whose BOQ status is '${status}', not approved` })
  }
  return out
}

// ─────────────────────────────────────────────────────────────────────────
// #9 -- a BOQ line with real logged progress (percentComplete > 0) that has
// never had a single interim-bill line item raised against it.
// ─────────────────────────────────────────────────────────────────────────
export async function findProgressNeverBilled(db: TenantDb, orgId: string, projectId: string): Promise<ExceptionRecord[]> {
  const entries = await db.query.constructionWorkProgressEntries.findMany({
    where: and(eq(constructionWorkProgressEntries.orgId, orgId), eq(constructionWorkProgressEntries.projectId, projectId), isNotNull(constructionWorkProgressEntries.boqLineItemId), sql`${constructionWorkProgressEntries.percentComplete}::numeric > 0`),
    columns: { boqLineItemId: true },
  })
  const lineIds = [...new Set(entries.map((e) => e.boqLineItemId!))]
  const out: ExceptionRecord[] = []
  for (const lineId of lineIds) {
    const billed = await db.query.constructionInterimBillLineItems.findFirst({ where: eq(constructionInterimBillLineItems.boqLineItemId, lineId) })
    if (!billed) out.push({ id: lineId, detail: `BOQ line ${lineId} has logged progress but no interim bill has ever been raised against it` })
  }
  return out
}

// ─────────────────────────────────────────────────────────────────────────
// #10 -- any open vendor dispute.
// ─────────────────────────────────────────────────────────────────────────
export async function findOpenVendorDisputes(db: TenantDb, orgId: string, projectId: string): Promise<ExceptionRecord[]> {
  const rows = await db.query.constructionVendorDisputes.findMany({
    where: and(eq(constructionVendorDisputes.orgId, orgId), eq(constructionVendorDisputes.projectId, projectId), eq(constructionVendorDisputes.status, "open")),
    columns: { id: true, description: true, amountDisputed: true },
  })
  return rows.map((r) => ({ id: r.id, detail: `Open vendor dispute: ${r.description}${r.amountDisputed ? ` (${r.amountDisputed} disputed)` : ""}` }))
}

// ─────────────────────────────────────────────────────────────────────────
// #11 / #12 -- customer complaints. #12 is any open complaint; #11 is the
// subset specifically categorised 'work_dispute'.
// ─────────────────────────────────────────────────────────────────────────
export async function findOpenCustomerComplaints(db: TenantDb, orgId: string, projectId: string, category?: string): Promise<ExceptionRecord[]> {
  const rows = await db.query.constructionCustomerComplaints.findMany({
    where: and(
      eq(constructionCustomerComplaints.orgId, orgId), eq(constructionCustomerComplaints.projectId, projectId),
      eq(constructionCustomerComplaints.status, "open"),
      category ? eq(constructionCustomerComplaints.category, category) : undefined
    ),
    columns: { id: true, description: true, severity: true, category: true },
  })
  return rows.map((r) => ({ id: r.id, detail: `Open complaint (${r.severity}, ${r.category}): ${r.description}` }))
}

// ─────────────────────────────────────────────────────────────────────────
// #13 / #14 -- a BOQ revision exists (parentBoqId set, i.e. this is not the
// original version) -- the record of "new scope"/"new BOQ" being decided.
// ─────────────────────────────────────────────────────────────────────────
export async function findNewBoqRevisions(db: TenantDb, orgId: string, projectId: string): Promise<ExceptionRecord[]> {
  const rows = await db.query.constructionBoqs.findMany({
    where: and(eq(constructionBoqs.orgId, orgId), eq(constructionBoqs.projectId, projectId), isNotNull(constructionBoqs.parentBoqId)),
    columns: { id: true, version: true, title: true, createdAt: true },
  })
  return rows.map((r) => ({ id: r.id, detail: `BOQ revision v${r.version} ("${r.title}") created ${r.createdAt.toISOString().slice(0, 10)}` }))
}

// ─────────────────────────────────────────────────────────────────────────
// #15 / #16 -- a BOQ revision with no customer approval on record
// (customerApprovedAt IS NULL) despite being internally approved.
// ─────────────────────────────────────────────────────────────────────────
export async function findBoqWithoutCustomerApproval(db: TenantDb, orgId: string, projectId: string): Promise<ExceptionRecord[]> {
  const rows = await db.query.constructionBoqs.findMany({
    where: and(eq(constructionBoqs.orgId, orgId), eq(constructionBoqs.projectId, projectId), eq(constructionBoqs.status, "approved"), isNull(constructionBoqs.customerApprovedAt)),
    columns: { id: true, version: true, title: true },
  })
  return rows.map((r) => ({ id: r.id, detail: `BOQ v${r.version} ("${r.title}") is internally approved with no customer approval on record` }))
}

// ─────────────────────────────────────────────────────────────────────────
// #17 -- an approved change order with no BOQ revision linked at all
// (approved without ever being compared against/priced into the BOQ).
// ─────────────────────────────────────────────────────────────────────────
export async function findApprovalsWithoutBoqComparison(db: TenantDb, orgId: string, projectId: string): Promise<ExceptionRecord[]> {
  const rows = await db.query.constructionChangeOrders.findMany({
    where: and(eq(constructionChangeOrders.orgId, orgId), eq(constructionChangeOrders.projectId, projectId), eq(constructionChangeOrders.status, "approved"), isNull(constructionChangeOrders.boqRevisionId)),
    columns: { id: true, number: true },
  })
  return rows.map((r) => ({ id: r.id, detail: `CO-${r.number} was approved with no BOQ revision ever linked to it` }))
}

// ─────────────────────────────────────────────────────────────────────────
// #18 / #27 -- material issued with no BOQ line item recorded.
//
// erp_purchase_order_items also gained a boq_line_item_id column alongside
// this change (schema.ts's own comment on it), for the SAME class of check
// at the purchase-order stage -- but erp_purchase_orders itself has no
// project_id at all (it is org-wide/company-scoped only, unlike
// construction_material_issues), so a per-PROJECT version of that check
// cannot be built without either fabricating a project link this table
// does not have, or widening this to an org-wide procurement-governance
// report instead of a per-project one. Left as a real, available column
// for that future, differently-scoped report rather than forcing an
// unreliable project filter onto a table that was never project-scoped.
// ─────────────────────────────────────────────────────────────────────────
export async function findMaterialWithoutBoqLine(db: TenantDb, orgId: string, projectId: string): Promise<ExceptionRecord[]> {
  const issues = await db.query.constructionMaterialIssues.findMany({
    where: and(eq(constructionMaterialIssues.orgId, orgId), eq(constructionMaterialIssues.projectId, projectId), isNull(constructionMaterialIssues.boqLineItemId)),
    columns: { id: true, issuedDate: true, quantity: true },
  })
  return issues.map((r) => ({ id: r.id, detail: `Material issued ${r.issuedDate} (qty ${r.quantity}) with no BOQ line recorded` }))
}

// ─────────────────────────────────────────────────────────────────────────
// #19 -- material issued for a BOQ line's activity AFTER work-progress
// entries already exist for that activity dated before the material
// arrived ("late"), or the same material issued twice for the same project
// within DUPLICATE_WINDOW_DAYS ("twice").
// ─────────────────────────────────────────────────────────────────────────
export const DUPLICATE_MATERIAL_WINDOW_DAYS = 3

export async function findLateOrDuplicateMaterial(db: TenantDb, orgId: string, projectId: string): Promise<ExceptionRecord[]> {
  const issues = await db.query.constructionMaterialIssues.findMany({
    where: and(eq(constructionMaterialIssues.orgId, orgId), eq(constructionMaterialIssues.projectId, projectId)),
    columns: { id: true, materialId: true, issuedDate: true, boqLineItemId: true },
  })
  const out: ExceptionRecord[] = []

  // Duplicate: same material issued twice within the window.
  const byMaterial = new Map<string, typeof issues>()
  for (const i of issues) byMaterial.set(i.materialId, [...(byMaterial.get(i.materialId) ?? []), i])
  for (const [materialId, rows] of byMaterial) {
    const sorted = [...rows].sort((a, b) => (a.issuedDate < b.issuedDate ? -1 : 1))
    for (let i = 1; i < sorted.length; i++) {
      const days = (new Date(sorted[i].issuedDate).getTime() - new Date(sorted[i - 1].issuedDate).getTime()) / 86_400_000
      if (days <= DUPLICATE_MATERIAL_WINDOW_DAYS) {
        out.push({ id: sorted[i].id, detail: `Material ${materialId} issued again ${sorted[i].issuedDate}, only ${days}d after the previous issue -- possible duplicate order` })
      }
    }
  }

  // Late: material issued after work-progress on its own linked activity had already started.
  for (const i of issues.filter((r) => r.boqLineItemId)) {
    const line = await db.query.constructionBoqLineItems.findFirst({ where: eq(constructionBoqLineItems.id, i.boqLineItemId!), columns: { activityId: true } })
    if (!line?.activityId) continue
    const earliestProgress = await db.query.constructionWorkProgressEntries.findFirst({
      where: and(eq(constructionWorkProgressEntries.activityId, line.activityId), eq(constructionWorkProgressEntries.orgId, orgId)),
      orderBy: (t, { asc }) => asc(t.entryDate),
      columns: { entryDate: true },
    })
    if (earliestProgress && i.issuedDate > earliestProgress.entryDate) {
      out.push({ id: i.id, detail: `Material issued ${i.issuedDate} for an activity that already had progress logged from ${earliestProgress.entryDate} -- arrived late` })
    }
  }
  return out
}

// ─────────────────────────────────────────────────────────────────────────
// #20 / #26 -- SHARED DETECTOR: a calendar day within the project's own
// active date range (its earliest to latest work-progress entry) with no
// site diary at all. A genuine date-series anti-join, not a heuristic.
// ─────────────────────────────────────────────────────────────────────────
export async function findMissingDailyReports(db: TenantDb, orgId: string, projectId: string): Promise<ExceptionRecord[]> {
  const diaryDates = new Set(
    (await db.query.constructionSiteDiaries.findMany({ where: and(eq(constructionSiteDiaries.orgId, orgId), eq(constructionSiteDiaries.projectId, projectId)), columns: { diaryDate: true } })).map((d) => d.diaryDate)
  )
  const entryDates = (await db.query.constructionWorkProgressEntries.findMany({ where: and(eq(constructionWorkProgressEntries.orgId, orgId), eq(constructionWorkProgressEntries.projectId, projectId)), columns: { entryDate: true } })).map((e) => e.entryDate)
  if (entryDates.length === 0) return []
  const sorted = [...entryDates].sort()
  const start = new Date(sorted[0])
  const end = new Date(Math.min(new Date(sorted[sorted.length - 1]).getTime(), Date.now()))
  const out: ExceptionRecord[] = []
  for (let d = new Date(start); d <= end; d.setDate(d.getDate() + 1)) {
    const iso = d.toISOString().slice(0, 10)
    if (!diaryDates.has(iso)) out.push({ id: iso, detail: `No site diary filed for ${iso}` })
  }
  return out
}

// ─────────────────────────────────────────────────────────────────────────
// #21 -- labour roster entries with no linked employee profile, so
// attendance/payroll can never be reconciled for them.
// ─────────────────────────────────────────────────────────────────────────
export async function findUnlinkedRoster(db: TenantDb, orgId: string, projectId: string): Promise<ExceptionRecord[]> {
  const rows = await db.query.constructionLabourRoster.findMany({
    where: and(eq(constructionLabourRoster.orgId, orgId), eq(constructionLabourRoster.projectId, projectId), eq(constructionLabourRoster.isActive, true), isNull(constructionLabourRoster.employeeId)),
    columns: { id: true, name: true },
  })
  return rows.map((r) => ({ id: r.id, detail: `Roster entry "${r.name}" has no linked employee profile -- cannot be reconciled against payroll` }))
}

// ─────────────────────────────────────────────────────────────────────────
// #22 -- ALREADY CLOSED, zero new work: resolveApprovedBoq() (boq-contract-
// value-service.ts) already deterministically answers "which BOQ revision
// is final" (highest version among status='approved' in the chain). This
// wrapper exists only so #22 has the same shape as every other item here.
// ─────────────────────────────────────────────────────────────────────────
export async function findAmbiguousBoqVersions(db: TenantDb, orgId: string, projectId: string): Promise<ExceptionRecord[]> {
  const boqs = await db.query.constructionBoqs.findMany({ where: and(eq(constructionBoqs.orgId, orgId), eq(constructionBoqs.projectId, projectId), eq(constructionBoqs.status, "approved")) })
  // A revision chain can only ever have ONE row with status='approved' at a
  // time per parentBoqId chain by construction (createBoqRevision supersedes
  // the parent's status away from 'approved' when a child is confirmed --
  // see that function's own invariant). More than one INDEPENDENT
  // (non-chained) approved BOQ for the same project is legitimate (E-116)
  // and is not ambiguity -- so this only flags a true chain violation: two
  // approved rows where one's parentBoqId is the other's id.
  const out: ExceptionRecord[] = []
  for (const b of boqs) {
    if (b.parentBoqId && boqs.some((other) => other.id === b.parentBoqId)) {
      out.push({ id: b.id, detail: `BOQ v${b.version} and its own parent are BOTH status='approved' -- the revision chain's invariant is violated` })
    }
  }
  return out
}

// ─────────────────────────────────────────────────────────────────────────
// #23 -- a subcontractor invoice line linked to a BOQ line whose invoiced
// amount exceeds that line's own cumulative billed-to-customer amount --
// paying a subcontractor more than has been certified to the customer for
// the same work.
// ─────────────────────────────────────────────────────────────────────────
export async function findMismatchedSubcontractorInvoices(db: TenantDb, orgId: string, projectId: string): Promise<ExceptionRecord[]> {
  const invoiceItems = await db.query.erpPurchaseInvoiceItems.findMany({ where: isNotNull(erpPurchaseInvoiceItems.boqLineItemId), columns: { id: true, boqLineItemId: true, amount: true, invoiceId: true } })
  const out: ExceptionRecord[] = []
  for (const item of invoiceItems) {
    const line = await db.query.constructionBoqLineItems.findFirst({ where: and(eq(constructionBoqLineItems.id, item.boqLineItemId!)), columns: { boqId: true } })
    if (!line) continue
    const boq = await db.query.constructionBoqs.findFirst({ where: and(eq(constructionBoqs.id, line.boqId), eq(constructionBoqs.orgId, orgId), eq(constructionBoqs.projectId, projectId)) })
    if (!boq) continue // not this org/project's BOQ line
    const billed = await db.query.constructionInterimBillLineItems.findFirst({ where: eq(constructionInterimBillLineItems.boqLineItemId, item.boqLineItemId!), orderBy: (t, { desc }) => desc(t.cumulativeAmount) })
    const billedAmount = billed ? Number(billed.cumulativeAmount) : 0
    if (Number(item.amount) > billedAmount) {
      out.push({ id: item.id, detail: `Subcontractor invoice line (${item.amount}) exceeds this BOQ line's cumulative billed-to-customer amount (${billedAmount})` })
    }
  }
  return out
}

// ─────────────────────────────────────────────────────────────────────────
// #24 -- snags overdue and unresolved; retention still held despite every
// snag on the project being verified closed.
// ─────────────────────────────────────────────────────────────────────────
export async function findOverdueSnags(db: TenantDb, orgId: string, projectId: string): Promise<ExceptionRecord[]> {
  const today = TODAY()
  const rows = await db.query.constructionPunchListItems.findMany({
    where: and(eq(constructionPunchListItems.orgId, orgId), eq(constructionPunchListItems.projectId, projectId), ne(constructionPunchListItems.status, "verified_closed"), lt(constructionPunchListItems.dueDate, today)),
    columns: { id: true, number: true, description: true, dueDate: true },
  })
  return rows.map((r) => ({ id: r.id, detail: `Snag #${r.number} ("${r.description}") was due ${r.dueDate} and is still not verified closed` }))
}

export async function findRetentionHeldDespiteSnagsClosed(db: TenantDb, orgId: string, projectId: string): Promise<ExceptionRecord[]> {
  const openSnags = await db.query.constructionPunchListItems.findFirst({ where: and(eq(constructionPunchListItems.orgId, orgId), eq(constructionPunchListItems.projectId, projectId), ne(constructionPunchListItems.status, "verified_closed")) })
  if (openSnags) return [] // snags still open -- retention being held is not (yet) a red flag
  const bills = await db.query.constructionInterimBills.findMany({
    where: and(eq(constructionInterimBills.orgId, orgId), eq(constructionInterimBills.projectId, projectId), gte(constructionInterimBills.retentionAmount, "0.01")),
    columns: { id: true, billNumber: true, retentionAmount: true, retentionReleasedAmount: true },
  })
  return bills
    .filter((b) => Number(b.retentionReleasedAmount ?? 0) < Number(b.retentionAmount))
    .map((b) => ({ id: b.id, detail: `Interim bill #${b.billNumber} still holds ${Number(b.retentionAmount) - Number(b.retentionReleasedAmount ?? 0)} retention, despite every snag on this project being verified closed` }))
}

// ─────────────────────────────────────────────────────────────────────────
// #25 -- an approved change order with no attached evidence document at all
// (documents.linkedEntityType='construction_change_order') -- approved on
// someone's word, not on a recorded artefact.
// ─────────────────────────────────────────────────────────────────────────
export async function findApprovalsWithoutEvidence(db: TenantDb, orgId: string, projectId: string): Promise<ExceptionRecord[]> {
  const orders = await db.query.constructionChangeOrders.findMany({
    where: and(eq(constructionChangeOrders.orgId, orgId), eq(constructionChangeOrders.projectId, projectId), eq(constructionChangeOrders.status, "approved")),
    columns: { id: true, number: true },
  })
  const out: ExceptionRecord[] = []
  for (const co of orders) {
    const evidence = await db.query.documents.findFirst({ where: and(eq(documents.orgId, orgId), eq(documents.linkedEntityType, "construction_change_order"), eq(documents.linkedEntityId, co.id)) })
    if (!evidence) out.push({ id: co.id, detail: `CO-${co.number} was approved with no evidence document attached to it` })
  }
  return out
}

// ─────────────────────────────────────────────────────────────────────────
// #28 -- a work-progress entry whose percentComplete is LOWER than the
// immediately preceding entry for the same activity -- cumulative progress
// can only ever go up; a decrease is a real data-entry error the software
// should catch, not the AI's judgment call.
// ─────────────────────────────────────────────────────────────────────────
export async function findProgressRegressions(db: TenantDb, orgId: string, projectId: string): Promise<ExceptionRecord[]> {
  const entries = await db.query.constructionWorkProgressEntries.findMany({
    where: and(eq(constructionWorkProgressEntries.orgId, orgId), eq(constructionWorkProgressEntries.projectId, projectId), eq(constructionWorkProgressEntries.entryBasis, "SNAPSHOT")),
    columns: { id: true, activityId: true, entryDate: true, percentComplete: true, createdAt: true },
  })
  const byActivity = new Map<string, typeof entries>()
  for (const e of entries) byActivity.set(e.activityId, [...(byActivity.get(e.activityId) ?? []), e])
  const out: ExceptionRecord[] = []
  for (const rows of byActivity.values()) {
    const sorted = [...rows].sort((a, b) => (a.entryDate === b.entryDate ? a.createdAt.getTime() - b.createdAt.getTime() : a.entryDate < b.entryDate ? -1 : 1))
    for (let i = 1; i < sorted.length; i++) {
      if (Number(sorted[i].percentComplete) < Number(sorted[i - 1].percentComplete)) {
        out.push({ id: sorted[i].id, detail: `Progress entry ${sorted[i].entryDate} reports ${sorted[i].percentComplete}%, lower than the ${sorted[i - 1].percentComplete}% already reported on ${sorted[i - 1].entryDate}` })
      }
    }
  }
  return out
}

// ─────────────────────────────────────────────────────────────────────────
// THE 28-ITEM REPORT, one project at a time. Sequential, not Promise.all,
// same pool-contention reasoning as boq-analysis-service.ts's listOrgAnalysis.
// ─────────────────────────────────────────────────────────────────────────
export async function getProjectExceptions(ctx: ExceptionsContext, projectId: string): Promise<ExceptionCheck[]> {
  return withTenantContext({ orgId: ctx.orgId }, async (db) => {
    const project = await db.query.projects.findFirst({ where: and(eq(projects.id, projectId), eq(projects.orgId, ctx.orgId)) })
    if (!project) throw new ServiceError("Project not found", 404)

    const checks: Array<{ item: number; title: string; formula: string; records: ExceptionRecord[] }> = []
    const push = (item: number, title: string, formula: string, records: ExceptionRecord[]) => checks.push({ item, title, formula, records })

    const diaryGap = await findDiaryWithoutProgressEntry(db, ctx.orgId, projectId)
    push(1, "Extra work done, never captured", "Site diary records work done on a date with no matching work-progress entry", diaryGap)
    push(8, "Work happened not captured", "Same detector as #1: a diary entry with no matching progress entry", diaryGap)

    push(2, "Extra work done, never billed", "An approved change order (cost impact != 0) linked to a BOQ revision with zero interim bills ever raised against it", await findApprovedChangeOrdersNeverBilled(db, ctx.orgId, projectId))
    push(3, "Site builds from the drawing but not confirmed", "Work-progress entry names a drawing with no confirmation recorded", await findUnconfirmedDrawingProgress(db, ctx.orgId, projectId))
    push(4, "Site builds from the old drawing", "Work-progress entry's named drawing is not the latest version", await findOldDrawingProgress(db, ctx.orgId, projectId))
    push(5, "Approvals stuck", `Change order pending_approval for over ${STUCK_APPROVAL_DAYS} days with no decision`, await findStuckApprovals(db, ctx.orgId, projectId))
    push(6, "Wrong approval given", "Change order approved by the same person who requested it", await findSelfApprovedChangeOrders(db, ctx.orgId, projectId))
    push(7, "Work without approval happened", "Work-progress entry recorded against a BOQ line whose BOQ is not status='approved'", await findWorkWithoutApprovedBoq(db, ctx.orgId, projectId))
    push(9, "Work happened not billed", "BOQ line with logged progress but zero interim-bill line items ever raised", await findProgressNeverBilled(db, ctx.orgId, projectId))
    push(10, "Work disputed with vendor", "Any construction_vendor_disputes row with status='open'", await findOpenVendorDisputes(db, ctx.orgId, projectId))
    push(11, "Work disputed by customer", "Any open construction_customer_complaints row with category='work_dispute'", await findOpenCustomerComplaints(db, ctx.orgId, projectId, "work_dispute"))
    push(12, "Customer complained", "Any open construction_customer_complaints row, any category", await findOpenCustomerComplaints(db, ctx.orgId, projectId))

    const newBoqs = await findNewBoqRevisions(db, ctx.orgId, projectId)
    push(13, "New scope of work decided", "A BOQ revision exists (parentBoqId set) -- this product's own record of a scope decision", newBoqs)
    push(14, "New BOQ decided", "Same detector as #13: BOQ IS this product's record of scope (R-96)", newBoqs)

    const noCustomerApproval = await findBoqWithoutCustomerApproval(db, ctx.orgId, projectId)
    push(15, "Approval from customer on new scope of work", "BOQ internally approved with no customerApprovedAt on record (inverted: flags the MISSING approval)", noCustomerApproval)
    push(16, "Approval from customer on new BOQ", "Same detector as #15", noCustomerApproval)

    push(17, "Approvals given without comparing scope of work and BOQ", "Change order approved with no BOQ revision ever linked to it", await findApprovalsWithoutBoqComparison(db, ctx.orgId, projectId))

    const materialNoLine = await findMaterialWithoutBoqLine(db, ctx.orgId, projectId)
    push(18, "Material ordered without scope of work and BOQ", "Material issue with no boqLineItemId recorded", materialNoLine)
    push(19, "Material ordered twice, or late", "Same material re-issued within a short window, or issued after progress on its activity had already started", await findLateOrDuplicateMaterial(db, ctx.orgId, projectId))

    const missingDiaries = await findMissingDailyReports(db, ctx.orgId, projectId)
    push(20, "The daily report never arrives", "A calendar day inside the project's active date range with no site diary filed", missingDiaries)
    push(26, "The user forgets", "Same detector as #20: a missed daily report", missingDiaries)

    push(21, "Manpower on paper, payroll disputes", "Labour roster entry with no linked employee profile -- cannot be reconciled against payroll", await findUnlinkedRoster(db, ctx.orgId, projectId))
    push(22, "Multiple versions of the BOQ -- which one is final, which is worked upon", "A BOQ revision chain violation (a row and its own parent both status='approved')", await findAmbiguousBoqVersions(db, ctx.orgId, projectId))
    push(23, "Subcontractor invoices don't match the work", "A subcontractor invoice line's amount exceeds its BOQ line's cumulative billed-to-customer amount", await findMismatchedSubcontractorInvoices(db, ctx.orgId, projectId))

    push(24, "Snags lost, retention held", "Overdue, not-yet-verified-closed punch list items", await findOverdueSnags(db, ctx.orgId, projectId))
    push(24, "Snags lost, retention held (retention half)", "Retention still held on an interim bill despite every snag being verified closed", await findRetentionHeldDespiteSnagsClosed(db, ctx.orgId, projectId))

    push(25, "The user decides from memory", "Change order approved with no evidence document attached", await findApprovalsWithoutEvidence(db, ctx.orgId, projectId))
    push(27, "The user doesn't remember", "Same detector as #18: material issued with no BOQ line recorded", materialNoLine)
    push(28, "The user reports wrong but it should be caught by software", "A work-progress entry's percentComplete is lower than the immediately preceding one for the same activity", await findProgressRegressions(db, ctx.orgId, projectId))

    return checks.map((c) => ({ item: c.item, title: c.title, formula: c.formula, records: c.records, count: c.records.length, flagged: c.records.length > 0 }))
  })
}
