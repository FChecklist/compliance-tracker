// PROJEXA-BUILD-002 AW-312 -- the write side of eight owner exception items that the 28-item report (construction-exceptions-
// service.ts getProjectExceptions) could detect and nothing could record.
//
// The report reads four facts that had no writer anywhere in this codebase (GAP_A section 3.3, checked by grep): the drawing a
// progress entry was built from and whether anyone confirmed it (items 3 and 4), a vendor dispute (10), a customer complaint
// (11 and 12), the customer's approval of an approved BOQ (15 and 16) and the employee a labour-roster row stands for (21).
// The columns and tables exist (schema.ts constructionWorkProgressEntries.drawing*, constructionVendorDisputes,
// constructionCustomerComplaints, constructionBoqs.customerApproved*, constructionLabourRoster.employeeId); this file is the
// one place that writes them, so the detectors can go quiet for the right reason: the fact is on record.
//
// One small function per fact. Every function is project-scoped: the record it changes or names must belong to `projectId` of
// `ctx.orgId` (a record of another project reads as absent, "not found"), and it runs in ONE transaction so a refused check
// leaves nothing behind. Each writes a compliance.audit_logs row through logActivity() in the same transaction, under the
// acting person, so who recorded what is on the record.
//
//   setProgressEntryDrawing    items 3, 4   names the drawing a progress entry was built from; confirming it is a separate fact
//   recordVendorDispute        item 10      an open dispute with a vendor, optionally on one BOQ line, optionally with an amount
//   recordCustomerComplaint    items 11, 12 an open complaint; category 'work_dispute' is item 11, any other is item 12
//   recordCustomerApproval     items 15, 16 the customer's approval of an INTERNALLY APPROVED BOQ, with the evidence document
//   linkRosterEmployee         item 21      ties a roster row to an employee profile so attendance can be reconciled with payroll
//
// WHO MAY CALL is decided by the caller (the executor and the link's rank): this file takes a person who is an active user of
// the organisation and refuses anyone else. An AI never approves or attests on its own: the executor makes every one of these a
// draft that the signed-in person confirms (link level 2), and recordCustomerApproval asks for a document as evidence.
import {
  constructionBoqLineItems,
  constructionBoqs,
  constructionCustomerComplaints,
  constructionLabourRoster,
  constructionVendorDisputes,
  constructionWorkProgressEntries,
  documents,
  employeeProfiles,
  erpCustomers,
  erpSuppliers,
  users,
} from "@/lib/db"
import { withTenantContext, type TenantDb } from "@/lib/db/tenant-scoped"
import { logActivity } from "@/lib/audit"
import { and, eq } from "drizzle-orm"
import { ServiceError } from "./compliance-service"
export { ServiceError }

export type ExceptionCaptureContext = { orgId: string; userId: string }

export const COMPLAINT_SEVERITIES = ["low", "medium", "high"] as const
export type ComplaintSeverity = (typeof COMPLAINT_SEVERITIES)[number]
export const WORK_DISPUTE_CATEGORY = "work_dispute"

const MAX_DESCRIPTION = 2000
const MAX_CATEGORY = 100

async function loadActor(db: TenantDb, ctx: ExceptionCaptureContext) {
  const actor = await db.query.users.findFirst({ where: and(eq(users.id, ctx.userId), eq(users.orgId, ctx.orgId)) })
  if (!actor || !actor.isActive) throw new ServiceError("The acting person is not an active user of this organisation", 403)
  return actor
}

function requiredText(value: string | undefined | null, field: string, max = MAX_DESCRIPTION): string {
  const text = typeof value === "string" ? value.trim() : ""
  if (!text) throw new ServiceError(`${field} is required`, 400)
  if (text.length > max) throw new ServiceError(`${field} is over ${max} characters`, 400)
  return text
}

/** A project document (a drawing when `drawingOnly`): linked to this project of this organisation, else "not found". */
async function loadProjectDocument(db: TenantDb, orgId: string, projectId: string, documentId: string, drawingOnly: boolean) {
  const doc = await db.query.documents.findFirst({ where: and(eq(documents.id, documentId), eq(documents.orgId, orgId)) })
  const onProject = doc && doc.linkedEntityType === "project" && doc.linkedEntityId === projectId
  const isDrawing = doc && (doc.category === "drawing" || doc.category === "drawing_3d")
  if (!doc || !onProject || (drawingOnly && !isDrawing)) throw new ServiceError(drawingOnly ? "Drawing not found" : "Document not found", 404)
  return doc
}

// -- items 3 and 4: the drawing a progress entry was built from --------------------------------------------------------------

export type SetProgressDrawingInput = { projectId: string; progressEntryId: string; drawingDocumentId: string; confirmed?: boolean }

/**
 * Names the drawing a work-progress entry was built from, and (by default) records that the acting person confirmed it is the
 * right one to build from (drawingConfirmedById/At). Naming a DIFFERENT drawing than the one on the entry clears an earlier
 * confirmation unless this call confirms again: the person confirmed the old drawing, not the new one.
 *
 * A superseded drawing is accepted on purpose: "the site built from the old drawing" is a real fact, and recording it is what
 * item 4 asks for. The answer says whether the named drawing is still the latest version.
 */
export async function setProgressEntryDrawing(ctx: ExceptionCaptureContext, input: SetProgressDrawingInput) {
  if (!input.projectId) throw new ServiceError("projectId is required", 400)
  if (!input.progressEntryId) throw new ServiceError("progressEntryId is required", 400)
  if (!input.drawingDocumentId) throw new ServiceError("drawingDocumentId is required", 400)
  const confirmed = input.confirmed !== false

  return withTenantContext({ orgId: ctx.orgId, userId: ctx.userId }, async (db) => {
    const actor = await loadActor(db, ctx)
    const entry = await db.query.constructionWorkProgressEntries.findFirst({
      where: and(eq(constructionWorkProgressEntries.id, input.progressEntryId), eq(constructionWorkProgressEntries.orgId, ctx.orgId)),
    })
    if (!entry || entry.projectId !== input.projectId) throw new ServiceError("Progress entry not found", 404)
    const drawing = await loadProjectDocument(db, ctx.orgId, input.projectId, input.drawingDocumentId, true)

    const changed = entry.drawingDocumentId !== drawing.id
    const patch: Record<string, unknown> = { drawingDocumentId: drawing.id }
    if (confirmed) {
      patch.drawingConfirmedById = actor.id
      patch.drawingConfirmedAt = new Date()
    } else if (changed) {
      patch.drawingConfirmedById = null
      patch.drawingConfirmedAt = null
    }
    await db.update(constructionWorkProgressEntries).set(patch).where(eq(constructionWorkProgressEntries.id, entry.id))

    await logActivity({
      tx: db, action: "construction_progress.drawing_recorded", entityType: "construction_work_progress_entry", entityId: entry.id, orgId: ctx.orgId, dbUser: actor,
      details: JSON.stringify({ drawingDocumentId: drawing.id, confirmed, previousDrawingDocumentId: entry.drawingDocumentId }),
    })
    return {
      id: entry.id,
      projectId: entry.projectId,
      drawingDocumentId: drawing.id,
      drawingConfirmed: confirmed || (!changed && entry.drawingConfirmedAt !== null),
      drawingIsLatestVersion: drawing.isLatestVersion,
    }
  })
}

// -- item 10: a vendor dispute -------------------------------------------------------------------------------------------------

export type VendorDisputeInput = { projectId: string; description: string; vendorId?: string; boqLineItemId?: string; amountDisputed?: number }

/**
 * Records an OPEN vendor dispute on the project. A vendor is an organisation record (erp_suppliers) and must exist in the
 * organisation; a BOQ line must belong to a BOQ of this project. The amount, when given, is not negative.
 */
export async function recordVendorDispute(ctx: ExceptionCaptureContext, input: VendorDisputeInput) {
  if (!input.projectId) throw new ServiceError("projectId is required", 400)
  const description = requiredText(input.description, "description")
  if (input.amountDisputed !== undefined && (!Number.isFinite(input.amountDisputed) || input.amountDisputed < 0)) {
    throw new ServiceError("amountDisputed must be a number that is not negative", 400)
  }

  return withTenantContext({ orgId: ctx.orgId, userId: ctx.userId }, async (db) => {
    const actor = await loadActor(db, ctx)
    if (input.vendorId) {
      const vendor = await db.query.erpSuppliers.findFirst({ where: and(eq(erpSuppliers.id, input.vendorId), eq(erpSuppliers.orgId, ctx.orgId)), columns: { id: true } })
      if (!vendor) throw new ServiceError("Vendor not found", 404)
    }
    if (input.boqLineItemId) {
      const line = await db.query.constructionBoqLineItems.findFirst({ where: and(eq(constructionBoqLineItems.id, input.boqLineItemId), eq(constructionBoqLineItems.orgId, ctx.orgId)), columns: { boqId: true } })
      const boq = line ? await db.query.constructionBoqs.findFirst({ where: and(eq(constructionBoqs.id, line.boqId), eq(constructionBoqs.orgId, ctx.orgId)), columns: { projectId: true } }) : undefined
      if (!boq || boq.projectId !== input.projectId) throw new ServiceError("BOQ line not found", 404)
    }
    const [row] = await db.insert(constructionVendorDisputes).values({
      orgId: ctx.orgId, projectId: input.projectId, vendorId: input.vendorId ?? null, boqLineItemId: input.boqLineItemId ?? null, description,
      amountDisputed: input.amountDisputed === undefined ? null : String(input.amountDisputed), raisedById: actor.id,
    }).returning()
    await logActivity({
      tx: db, action: "construction_vendor_dispute.recorded", entityType: "construction_vendor_dispute", entityId: row!.id, orgId: ctx.orgId, dbUser: actor,
      details: JSON.stringify({ vendorId: input.vendorId ?? null, boqLineItemId: input.boqLineItemId ?? null }),
    })
    return row!
  })
}

// -- items 11 and 12: a customer complaint -------------------------------------------------------------------------------------

export type CustomerComplaintInput = { projectId: string; description: string; category?: string; severity?: string; customerId?: string }

/**
 * Records an OPEN customer complaint. category 'work_dispute' is item 11 (work disputed by the customer); any other category, and
 * the default 'general', is item 12. severity is low, medium or high (default medium). A customer, when named, is an
 * organisation record (erp_customers) and must exist in the organisation.
 */
export async function recordCustomerComplaint(ctx: ExceptionCaptureContext, input: CustomerComplaintInput) {
  if (!input.projectId) throw new ServiceError("projectId is required", 400)
  const description = requiredText(input.description, "description")
  const category = input.category === undefined ? "general" : requiredText(input.category, "category", MAX_CATEGORY)
  const severity = input.severity ?? "medium"
  if (!(COMPLAINT_SEVERITIES as readonly string[]).includes(severity)) throw new ServiceError("severity must be low, medium or high", 400)

  return withTenantContext({ orgId: ctx.orgId, userId: ctx.userId }, async (db) => {
    const actor = await loadActor(db, ctx)
    if (input.customerId) {
      const customer = await db.query.erpCustomers.findFirst({ where: and(eq(erpCustomers.id, input.customerId), eq(erpCustomers.orgId, ctx.orgId)), columns: { id: true } })
      if (!customer) throw new ServiceError("Customer not found", 404)
    }
    const [row] = await db.insert(constructionCustomerComplaints).values({
      orgId: ctx.orgId, projectId: input.projectId, customerId: input.customerId ?? null, category, description, severity: severity as ComplaintSeverity, raisedById: actor.id,
    }).returning()
    await logActivity({
      tx: db, action: "construction_customer_complaint.recorded", entityType: "construction_customer_complaint", entityId: row!.id, orgId: ctx.orgId, dbUser: actor,
      details: JSON.stringify({ category, severity, customerId: input.customerId ?? null }),
    })
    return row!
  })
}

// -- items 15 and 16: the customer's approval of a BOQ ------------------------------------------------------------------------

export type CustomerApprovalInput = { projectId: string; boqId: string; evidenceDocumentId: string; approvedOn?: string }

/**
 * Records that the CUSTOMER approved a BOQ that the organisation had already approved (status 'approved'): customerApprovedAt is
 * the day the customer approved (`approvedOn`, YYYY-MM-DD, not in the future; today when omitted) and customerApprovedById is the
 * person who recorded it. Two guards keep an approval from being invented: the BOQ must be internally approved first, and the
 * evidence (the customer's e-mail or signed sheet, stored as a document of THIS project) must be named; the evidence id is kept in
 * the audit row because the BOQ has no column for it. A BOQ that already has a customer approval is not overwritten (409).
 */
export async function recordCustomerApproval(ctx: ExceptionCaptureContext, input: CustomerApprovalInput) {
  if (!input.projectId) throw new ServiceError("projectId is required", 400)
  if (!input.boqId) throw new ServiceError("boqId is required", 400)
  if (!input.evidenceDocumentId) throw new ServiceError("evidenceDocumentId is required", 400)
  let approvedAt = new Date()
  if (input.approvedOn !== undefined) {
    const parsed = new Date(`${input.approvedOn}T00:00:00.000Z`)
    const real = /^\d{4}-\d{2}-\d{2}$/.test(input.approvedOn) && !Number.isNaN(parsed.getTime()) && parsed.toISOString().slice(0, 10) === input.approvedOn
    if (!real) throw new ServiceError("approvedOn must be a date written YYYY-MM-DD", 400)
    if (parsed.getTime() > Date.now()) throw new ServiceError("approvedOn cannot be in the future", 400)
    approvedAt = parsed
  }

  return withTenantContext({ orgId: ctx.orgId, userId: ctx.userId }, async (db) => {
    const actor = await loadActor(db, ctx)
    const boq = await db.query.constructionBoqs.findFirst({ where: and(eq(constructionBoqs.id, input.boqId), eq(constructionBoqs.orgId, ctx.orgId)) })
    if (!boq || boq.projectId !== input.projectId) throw new ServiceError("BOQ not found", 404)
    if (boq.status !== "approved") throw new ServiceError("The BOQ must be approved by the organisation before the customer's approval is recorded", 409)
    if (boq.customerApprovedAt) throw new ServiceError("This BOQ already has a customer approval on record", 409)
    const evidence = await loadProjectDocument(db, ctx.orgId, input.projectId, input.evidenceDocumentId, false)

    await db.update(constructionBoqs).set({ customerApprovedById: actor.id, customerApprovedAt: approvedAt, updatedAt: new Date() }).where(eq(constructionBoqs.id, boq.id))
    await logActivity({
      tx: db, action: "construction_boq.customer_approval_recorded", entityType: "construction_boq", entityId: boq.id, orgId: ctx.orgId, dbUser: actor,
      details: JSON.stringify({ evidenceDocumentId: evidence.id, approvedOn: approvedAt.toISOString().slice(0, 10) }),
    })
    return { id: boq.id, projectId: boq.projectId, version: boq.version, customerApprovedAt: approvedAt.toISOString(), customerApprovedById: actor.id, evidenceDocumentId: evidence.id }
  })
}

// -- item 21: the employee a roster row stands for ------------------------------------------------------------------------------

export type LinkRosterEmployeeInput = { projectId: string; rosterId: string; employeeId: string }

/**
 * Ties one labour-roster row of the project to an employee profile of the organisation (employee_profiles.id, the key payroll
 * uses), so the row's attendance can be reconciled with payroll. A roster row that is already linked is not silently re-pointed
 * (409). The answer carries ids only: the employee's personal data is not read back.
 */
export async function linkRosterEmployee(ctx: ExceptionCaptureContext, input: LinkRosterEmployeeInput) {
  if (!input.projectId) throw new ServiceError("projectId is required", 400)
  if (!input.rosterId) throw new ServiceError("rosterId is required", 400)
  if (!input.employeeId) throw new ServiceError("employeeId is required", 400)

  return withTenantContext({ orgId: ctx.orgId, userId: ctx.userId }, async (db) => {
    const actor = await loadActor(db, ctx)
    const roster = await db.query.constructionLabourRoster.findFirst({ where: and(eq(constructionLabourRoster.id, input.rosterId), eq(constructionLabourRoster.orgId, ctx.orgId)) })
    if (!roster || roster.projectId !== input.projectId) throw new ServiceError("Roster entry not found", 404)
    if (roster.employeeId && roster.employeeId !== input.employeeId) throw new ServiceError("This roster entry is already linked to another employee", 409)
    const employee = await db.query.employeeProfiles.findFirst({ where: and(eq(employeeProfiles.id, input.employeeId), eq(employeeProfiles.orgId, ctx.orgId)), columns: { id: true } })
    if (!employee) throw new ServiceError("Employee not found", 404)

    await db.update(constructionLabourRoster).set({ employeeId: employee.id }).where(eq(constructionLabourRoster.id, roster.id))
    await logActivity({
      tx: db, action: "construction_roster.employee_linked", entityType: "construction_labour_roster", entityId: roster.id, orgId: ctx.orgId, dbUser: actor,
      details: JSON.stringify({ employeeId: employee.id }),
    })
    return { id: roster.id, projectId: roster.projectId, employeeId: employee.id }
  })
}
