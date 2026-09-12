// Point 118 (WhatsApp share): tokenised, expiring, read-only report links --
// mirrors veri-meeting-service.ts's share-link trio (createMeetingShareLink/
// revokeMeetingShareLink/getMeetingByShareToken) exactly in shape. Rajat
// ruled: NOT the WhatsApp Business API -- a plain unguessable URL the user
// pastes into WhatsApp themselves. AR-10 applies: the public resolve path
// must render, never authorise -- see resolveReportShareLink()'s comment.
import { reportShareLinks } from "@/lib/db"
import { isShareLinkUsable } from "@/lib/share-link-usable"
import { withTenantContext } from "@/lib/db/tenant-scoped"
import { eq, and } from "drizzle-orm"
import { createId } from "@paralleldrive/cuid2"
import { ServiceError } from "./compliance-service"
import { lookupReportShareLinkByToken } from "@/lib/db/preauth-lookups"
import { listBoqs, getBoq, type BoqLineItemRow } from "./construction-boq-service"
import { listActivities, listCategories, listProgressEntries } from "./construction-progress-service"
import { getProjectDashboard, type ProjectDashboard } from "./construction-dashboard-service"
import { attendanceSummary, boqBudgetVarianceReport, type AttendanceSummary, type BudgetLine } from "./construction-reports-service"
export { ServiceError }

export type ReportRef = { projectId: string; from: string; to: string }

/**
 * R67 E-12 (R-136). The report types a public, expiring link can be minted for.
 *
 * This list is the WHOLE contract: a token may only be minted for a type that
 * resolveReportShareLink() below can really render, because a link that 404s
 * for whoever received it is worse than no link at all. Item E-09 deliberately
 * left Share on the Reports screen copying its in-app URL for exactly that
 * reason -- project_status had no public renderer. It has one now
 * (projexa src/app/share/report/[token]/page.tsx), so the type is added here
 * and in the same change, never before it.
 *
 * R67 D-31 (R-090): the Manpower screen's "Share" reuses THIS mechanism rather
 * than growing a second one -- same table, same token, same expiry and
 * revocation rules, same public resolve route. Adding a member here is the only
 * change the mechanism needed, which is why both items could add one
 * independently and the merge is a union rather than a choice.
 */
export const SHAREABLE_REPORT_TYPES = ["work_progress", "project_status", "attendance_summary"] as const
export type ShareableReportType = (typeof SHAREABLE_REPORT_TYPES)[number]

/**
 * Pure. Refuses anything this service cannot actually resolve, and names what
 * it CAN do rather than saying only "unsupported" -- a caller that guessed a
 * type is told the real vocabulary.
 */
export function assertShareableReportType(value: unknown): ShareableReportType {
  if (typeof value === "string" && (SHAREABLE_REPORT_TYPES as readonly string[]).includes(value)) {
    return value as ShareableReportType
  }
  throw new ServiceError(`Unsupported report type. Shareable reports: ${SHAREABLE_REPORT_TYPES.join(", ")}`, 400)
}

/** Pure. The reference every shareable report needs, checked before a row is written. */
export function assertReportRef(ref: unknown): ReportRef {
  const r = ref as ReportRef | undefined
  if (!r?.projectId || !r?.from || !r?.to) {
    throw new ServiceError("reportRef.projectId, from and to are required", 400)
  }
  return { projectId: r.projectId, from: r.from, to: r.to }
}

/** Pure. Whether a link row may still be resolved. Expired, revoked and unknown are deliberately indistinguishable to a visitor. */
// Moved to @/lib/share-link-usable so the other three public share surfaces
// can share it instead of each restating the rule. Re-exported because this
// module's own tests and callers already import it from here.
export { isShareLinkUsable }

export async function createReportShareLink(
  // R38: userId is null for an API-key-authenticated (server-to-server)
  // caller -- there is no real `users` row to attribute the link to. See
  // schema.ts's createdById comment for the FK-violation bug this fixes.
  ctx: { orgId: string; userId: string | null },
  input: { reportType: ShareableReportType; reportRef: ReportRef; expiresInHours?: number }
) {
  assertShareableReportType(input.reportType)
  assertReportRef(input.reportRef)
  const expiresInHours = input.expiresInHours ?? 168 // 7 days, matching veri_meeting_share_links' default
  return withTenantContext({ orgId: ctx.orgId, userId: ctx.userId ?? undefined }, async (tx) => {
    const expiresAt = new Date(Date.now() + expiresInHours * 60 * 60 * 1000)
    const [link] = await tx.insert(reportShareLinks).values({
      orgId: ctx.orgId, reportType: input.reportType, reportRef: JSON.stringify(input.reportRef),
      token: createId(), createdById: ctx.userId, expiresAt,
    }).returning()
    return link
  })
}

export async function listReportShareLinks(ctx: { orgId: string }, reportType: string, reportRef: ReportRef) {
  return withTenantContext({ orgId: ctx.orgId }, (tx) =>
    tx.query.reportShareLinks.findMany({
      where: and(eq(reportShareLinks.orgId, ctx.orgId), eq(reportShareLinks.reportType, reportType), eq(reportShareLinks.reportRef, JSON.stringify(reportRef))),
      orderBy: (t, { desc }) => desc(t.createdAt),
    })
  )
}

export async function revokeReportShareLink(ctx: { orgId: string }, linkId: string) {
  return withTenantContext({ orgId: ctx.orgId }, async (tx) => {
    const link = await tx.query.reportShareLinks.findFirst({ where: and(eq(reportShareLinks.id, linkId), eq(reportShareLinks.orgId, ctx.orgId)) })
    if (!link) throw new ServiceError("Share link not found", 404)
    const [updated] = await tx.update(reportShareLinks).set({ revokedAt: new Date() }).where(eq(reportShareLinks.id, linkId)).returning()
    return updated
  })
}

// ─────────────────────────────────────────────────────────────────────────
// PUBLIC-SHARE COST REDACTION (found 2026-09-12, pm-urgent-share-leak).
//
// Owner ruling D91 (claude_log id 375): "Any unauthenticated share token CAN
// NEVER CARRY COST." resolveReportShareLink() below is genuinely public --
// no session, no role check, by design, so a plain URL pasted into WhatsApp
// works -- which means EVERY field it returns for 'project_status' and
// 'attendance_summary' must be schedule/progress/scope, never a cost,
// budget, variance or profit figure.
//
// These are ALLOWLISTS, not blocklists, and deliberately built by
// DESTRUCTURING the named fields (never `{ ...full, budget: undefined }` or
// similar) -- a field added to ProjectDashboard/BudgetLine/AttendanceSummary
// after this change is invisible here by default instead of leaking until
// someone remembers to add it to a blocklist. See each function's own
// comment for exactly which real fields were found leaking and why each
// kept field is safe under D91's own rule (progress/schedule/scope, never
// cost/budget/variance/profit).
// ─────────────────────────────────────────────────────────────────────────

/**
 * The 'project_status' dashboard, redacted. getProjectDashboard()'s real
 * return type (construction-dashboard-service.ts) carries, and this
 * deliberately DROPS: budget, ledgerBudget, revenue, expenses, projectValue,
 * projectValueSource, earnedValue, percentByValue, contractValue, and
 * progressByBoqValuePct (its own doc comment: "the SAME number as
 * percentByValue" -- an earned-value ratio, not a schedule figure, so it
 * follows percentByValue out).
 *
 * Kept: projectId/projectName (identity), progressPercent /
 * progressByActivityLogPct (schedule, activity-log-derived, no cost
 * involved), delayedTaskCount/photoCount/taskCount/permitsExpiring(d)Count
 * (schedule/operational counts), generatedAt (freshness stamp), categories
 * (category name + percentComplete only -- no money, see
 * CategoryProgressRow), recentEntries (activity name + quantityDone/
 * percentComplete -- a physical quantity, not a price).
 */
export type PublicProjectStatusDashboard = Pick<
  ProjectDashboard,
  | "projectId" | "projectName" | "progressPercent" | "progressByActivityLogPct"
  | "delayedTaskCount" | "photoCount" | "taskCount" | "generatedAt"
  | "permitsExpiringCount" | "permitsExpiredCount" | "categories" | "recentEntries"
>

export function toPublicProjectStatusDashboard(dashboard: ProjectDashboard): PublicProjectStatusDashboard {
  const {
    projectId, projectName, progressPercent, progressByActivityLogPct,
    delayedTaskCount, photoCount, taskCount, generatedAt,
    permitsExpiringCount, permitsExpiredCount, categories, recentEntries,
  } = dashboard
  return {
    projectId, projectName, progressPercent, progressByActivityLogPct,
    delayedTaskCount, photoCount, taskCount, generatedAt,
    permitsExpiringCount, permitsExpiredCount, categories, recentEntries,
  }
}

/**
 * One boqBudgetVarianceReport() line, redacted. toBudgetLine()'s real shape
 * (construction-reports-service.ts) carries, and this DROPS: amount, rate,
 * budgetPercentage, budget, budgetIsDerived, materialAmount, manpowerAmount,
 * vendorId, vendorName, vendorAmount, committed, variance, budgetRemaining,
 * percentOfParent, actual, revenue -- every one of these is a price, a
 * budgeted/committed/actual money figure, or derived from one.
 *
 * Kept: identity (lineItemId/boqId/sNo/serialNumber/isRootLine/
 * parentLineItemId) and pure scope description (code/category/description/
 * unit/quantity) -- "what the line is and how much of it", never "what it
 * costs".
 */
export type PublicBudgetLine = Pick<
  BudgetLine,
  | "lineItemId" | "boqId" | "sNo" | "serialNumber" | "isRootLine" | "parentLineItemId"
  | "code" | "category" | "description" | "unit" | "quantity"
>

export function toPublicBudgetLine(line: Omit<BudgetLine, "_rawBudget" | "_rawCommitted" | "_rawVariance">): PublicBudgetLine {
  const { lineItemId, boqId, sNo, serialNumber, isRootLine, parentLineItemId, code, category, description, unit, quantity } = line
  return { lineItemId, boqId, sNo, serialNumber, isRootLine, parentLineItemId, code, category, description, unit, quantity }
}

/**
 * The 'attendance_summary' report, redacted. attendanceSummary()'s real
 * return type (construction-reports-service.ts) folds in
 * manpowerCostReport()'s labour cost via `cost` on every row and total, and
 * via costFromStatuses/costFromTrades on the reconciliation -- all money,
 * all DROPPED here.
 *
 * Kept: the headcount figures (present/halfDay/absent/workerDays, by trade
 * and totalled), headcount itself, and the reconciliation's row-count check
 * (ties/rowCountFromStatuses/rowCountFromTrades) with its own cost
 * components removed -- `ties` stays a valid signal ("do the two internal
 * aggregates agree") even with its money half no longer printed publicly.
 */
export type PublicAttendanceSummary = {
  projectId: string
  from: string | null
  to: string | null
  rows: { trade: string; present: number; halfDay: number; absent: number; workerDays: number }[]
  totals: { present: number; halfDay: number; absent: number; workerDays: number }
  headcount: number
  reconciliation: { ties: boolean; rowCountFromStatuses: number; rowCountFromTrades: number }
}

export function toPublicAttendanceSummary(summary: AttendanceSummary): PublicAttendanceSummary {
  const stripCost = ({ present, halfDay, absent, workerDays }: { present: number; halfDay: number; absent: number; workerDays: number }) =>
    ({ present, halfDay, absent, workerDays })
  return {
    projectId: summary.projectId,
    from: summary.from,
    to: summary.to,
    rows: summary.rows.map(({ trade, ...rest }) => ({ trade, ...stripCost(rest) })),
    totals: stripCost(summary.totals),
    headcount: summary.headcount,
    reconciliation: {
      ties: summary.reconciliation.ties,
      rowCountFromStatuses: summary.reconciliation.rowCountFromStatuses,
      rowCountFromTrades: summary.reconciliation.rowCountFromTrades,
    },
  }
}

/**
 * One raw BOQ line item (getBoq()'s `lineItems`, construction-boq-service.ts),
 * redacted for the 'work_progress' public share below. The raw row -- and
 * getBoq()'s own withComputedRate() wrapper -- carry, and this DROPS: rate,
 * amount, breakdownPercentage, materialCost, labourCost, equipmentCost,
 * overheadPercent, profitPercent, budgetPercentage, vendorId, vendorAmount,
 * materialAmount, manpowerAmount, qtyProject, rateProject, qtyContract,
 * rateContract, computedRate, computedBudget. schema.ts's own comment on
 * rateProject: "THE MOST SENSITIVE FIELD IN THE PRODUCT (D91 B1) ... NEVER
 * client-reachable in any surface, export, share link, or API response" --
 * getBoq() (called by this file's 'work_progress' branch, a genuinely public
 * unauthenticated route) was returning it, and every other cost column on
 * the row, in full.
 *
 * Kept: identity (id/boqId/parentLineItemId) and pure scope description
 * (itemCode/description/unit/quantity/category).
 */
export type PublicBoqLineItem = Pick<
  BoqLineItemRow,
  "id" | "boqId" | "parentLineItemId" | "itemCode" | "description" | "unit" | "quantity" | "category"
>

export function toPublicBoqLineItem(item: BoqLineItemRow): PublicBoqLineItem {
  const { id, boqId, parentLineItemId, itemCode, description, unit, quantity, category } = item
  return { id, boqId, parentLineItemId, itemCode, description, unit, quantity, category }
}

// Public route (no auth) -- resolves a token to the underlying report's raw
// ingredients, READ ONLY. Expired/revoked/unknown tokens all fail identically
// (do not distinguish "expired" from "never existed" -- same posture as
// getMeetingByShareToken). Uses the raw `db` export (DATABASE_URL, no RLS)
// ONLY to look up the token row itself -- there is no org context yet at
// that point, by definition, for a public visitor. Every subsequent read
// (the actual report data) goes through the EXISTING, already-orgId-scoped
// service functions (listBoqs/getBoq/listActivities/listCategories/
// listProgressEntries), called with the link's OWN stored orgId -- NEVER
// derived from the request -- so RLS (app_runtime, current_org_id()) still
// applies to every byte of report content a visitor actually sees. A public
// visitor can therefore only ever reach the one org + one report the token
// was minted for, nothing else in the multi-tenant database.
export async function resolveReportShareLink(token: string) {
  // CRR-027/028 CONTRACT: was db.query.reportShareLinks.findFirst() over
  // the raw (RLS-bypassing) client -- narrowed to SECURITY DEFINER
  // compliance.lookup_report_share_link_by_token(text), which does ONLY the
  // exact-token-equality lookup and returns the unfiltered full row.
  // isShareLinkUsable() below is UNCHANGED and still decides usability in
  // application code -- deliberately not baked into the SQL function, since
  // that same predicate is shared by 7 other public token surfaces (see
  // kt/handover/HANDOVER_W-ENV_2026-09-10T2230.json's
  // report_share_links_shape_divergence note). See
  // pm/CRR027_028_CONTRACT_AUDIT_2026-09-10.md §6.
  const found = await lookupReportShareLinkByToken(token)
  if (!isShareLinkUsable(found, new Date()) || !found) {
    throw new ServiceError("This share link is invalid or has expired", 404)
  }
  const link = found

  if (!(SHAREABLE_REPORT_TYPES as readonly string[]).includes(link.reportType)) {
    throw new ServiceError("This share link is invalid or has expired", 404)
  }
  const ref: ReportRef = JSON.parse(link.reportRef)

  // R67 E-12 (R-136): the Project Status document, publicly. The SAME two
  // reads the authenticated screen uses -- the dashboard figures and the BOQ
  // budget line by line -- so a shared link and the screen it was shared from
  // state the same facts. Both are called with the link's OWN stored orgId,
  // never one derived from the request, so RLS still bounds every byte.
  if (link.reportType === "project_status") {
    const [dashboard, variance] = await Promise.all([
      getProjectDashboard({ orgId: link.orgId }, ref.projectId),
      boqBudgetVarianceReport({ orgId: link.orgId }, ref.projectId, {}),
    ])
    // pm-urgent-share-leak (2026-09-12), owner ruling D91 (claude_log 375):
    // "Any unauthenticated share token CAN NEVER CARRY COST." dashboard/lines
    // used to be returned in full -- both real, live cost surfaces (dashboard
    // .budget/.ledgerBudget/.revenue/.expenses/.projectValue/.earnedValue/
    // .percentByValue/.contractValue; every line's amount/rate/vendorAmount/
    // committed/variance/etc) on a route with no auth at all. Redacted to an
    // explicit allowlist -- see toPublicProjectStatusDashboard/
    // toPublicBudgetLine's own comments for the exact fields dropped and why
    // each kept one is safe. `totals` (budget + vendorAmount, both cost) is
    // removed entirely rather than redacted-in-place: there is no
    // customer-safe stand-in for "total budget" that keeps the key name
    // without implying it still means what it used to.
    return {
      reportType: link.reportType,
      projectId: ref.projectId, from: ref.from, to: ref.to,
      boqTitle: variance.boqTitle,
      dashboard: toPublicProjectStatusDashboard(dashboard),
      lines: variance.lines.filter((l) => l.isRootLine).map(toPublicBudgetLine),
    }
  }

  // R67 D-31: the attendance summary resolves through the SAME rule the work
  // progress report does -- the link's OWN stored orgId, never one derived from
  // the request -- so a public visitor still reaches exactly one org's one
  // report and nothing else in the multi-tenant database.
  //
  // pm-urgent-share-leak (2026-09-12), owner ruling D91: this branch had the
  // SAME class of bug -- attendanceSummary() folds in manpowerCostReport()'s
  // labour cost (`cost` on every row/total, costFromStatuses/costFromTrades
  // on the reconciliation), all real money, all on this same unauthenticated
  // route. Redacted the same way -- see toPublicAttendanceSummary's own
  // comment.
  if (link.reportType === "attendance_summary") {
    const summary = await attendanceSummary({ orgId: link.orgId }, ref.projectId, ref.from, ref.to)
    return { reportType: link.reportType, ...toPublicAttendanceSummary(summary) }
  }

  const boqs = await listBoqs({ orgId: link.orgId }, ref.projectId)
  const boqsWithLineItems = await Promise.all(boqs.map((boq) => getBoq({ orgId: link.orgId }, boq.id)))
  const latestBoq = boqsWithLineItems.find((b) => b.status !== "superseded") ?? boqsWithLineItems[0]

  const [activities, categories, entries] = await Promise.all([
    listActivities({ orgId: link.orgId }, { projectId: ref.projectId }),
    listCategories({ orgId: link.orgId }, ref.projectId),
    listProgressEntries({ orgId: link.orgId }, { projectId: ref.projectId }),
  ])

  // pm-urgent-share-leak (2026-09-12), owner ruling D91: this branch (the
  // ORIGINAL shareable report, work_progress) had the SAME class of bug,
  // found in the same pass -- getBoq()'s raw lineItems carry rateProject
  // (schema.ts's own comment: "THE MOST SENSITIVE FIELD IN THE PRODUCT ...
  // NEVER client-reachable in any surface, export, share link, or API
  // response") and every other cost column on the row, unredacted, on this
  // same unauthenticated route. activities/categories/entries were checked
  // too (constructionActivities/constructionCategories have no money
  // columns at all, and listProgressEntries here reads BASE_ENTRY_COLUMNS,
  // not the boqLineRate/boqLineAmount-carrying OBJECT_ENTRY_COLUMNS variant
  // getProgressEntry() uses) -- none of the three needed redaction.
  return {
    reportType: link.reportType,
    projectId: ref.projectId, from: ref.from, to: ref.to,
    boqTitle: latestBoq?.title ?? null,
    lineItems: (latestBoq?.lineItems ?? []).map(toPublicBoqLineItem),
    activities, categories, entries,
  }
}
