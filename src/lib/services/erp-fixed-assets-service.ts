// Wave B (VERIDIAN Review Framework remediation, "Fixed Assets wiring"
// workstream, 2026-07-17): erp_fixed_assets/erp_asset_categories/
// erp_depreciation_schedules/erp_asset_movements/erp_asset_disposals have
// existed since drizzle/0042 (Wave 49) with zero service/API/UI consumer at
// all -- confirmed by a fresh grep of src/ immediately before this file was
// written. This is the first real service layer on top of that schema:
// asset-category + fixed-asset CRUD, a real configurable depreciation
// engine (straight-line + declining-balance/written-down-value, both
// tested directly as pure functions), period-by-period depreciation
// schedule generation + posting, asset movement tracking, and a real
// approval-gated disposal workflow.
//
// Follows this codebase's own established ERP service conventions exactly
// (studied erp-accounting-service.ts, erp-procurement-workflow-service.ts,
// approval-workflow-service.ts before writing anything here):
// requireErpEnabled() first in every exported function, withTenantContext
// for every DB access (RLS-respecting, never the raw db client),
// logActivity() on every state change, ServiceError for expected failure
// modes, and the shared Approval Workflow Engine (not a bespoke status
// enum) for the one place this module needs a real sign-off gate --
// disposal.
import {
  erpAssetCategories, erpFixedAssets, erpDepreciationSchedules, erpAssetMovements, erpAssetDisposals,
  erpAccounts, departments, users,
} from "@/lib/db"
import { withTenantContext, type TenantDb } from "@/lib/db/tenant-scoped"
import { and, eq, lte } from "drizzle-orm"
import { ServiceError } from "./compliance-service"
export { ServiceError }
import { logActivity } from "@/lib/audit"
import { requireErpEnabled } from "./erp-enablement-service"
import { startApprovalWorkflow } from "./approval-workflow-service"
import { createJournalEntry, voidDraftJournalEntry, type JournalEntryLineInput } from "./erp-accounting-service"
import { isPeriodOpenForDate } from "./erp-financial-report-service"

export type ErpContext = { orgId: string; userId: string; dbUser: typeof users.$inferSelect }
// Matches erp-accounting-service.ts's createJournalEntry / erp-procurement-
// workflow-service.ts's createPurchaseRequisition precedent exactly: "basic
// create" operations accept either a real session user or a server-to-server
// API key actor, while anything that starts an approval workflow or posts to
// the GL (submit/dispose/depreciation-run) keeps requiring a real dbUser.
export type ActorCtx = { orgId: string; userId: string } & (
  | { dbUser: typeof users.$inferSelect; apiKey?: never }
  | { dbUser?: never; apiKey: { id: string; name: string } }
)

function actorLogFields(ctx: ActorCtx) {
  return ctx.dbUser ? { dbUser: ctx.dbUser } : { apiKey: ctx.apiKey! }
}

// ============================================================
// Pure depreciation math -- no DB, no withTenantContext, directly unit
// tested (erp-fixed-assets-service.test.ts). Kept free of any service-layer
// concern so the arithmetic itself can be verified in isolation, matching
// this codebase's own precedent (agent-review-service.ts's
// computeReviewVerdict, model-scorecard-service.ts) of testing the pure
// decision/calculation core directly rather than mocking a database.
// ============================================================

function round2(n: number): number {
  return Math.round((n + Number.EPSILON) * 100) / 100
}

/**
 * Monthly declining-balance rate via the standard geometric formula:
 * rate = 1 - (salvage/cost)^(1/usefulLifeMonths), the same formula real
 * written-down-value depreciation uses (studied frappe/erpnext's public
 * documentation of the method, not their code, matching this schema's own
 * "Adapted from studying frappe/erpnext's real doctype shapes... never
 * their code" precedent). That formula is undefined/degenerate when
 * salvageValue is 0 or negative (it would imply a 100% monthly rate) -- in
 * that case this falls back to the standard double-declining-balance
 * heuristic (2 / usefulLifeMonths), a well-known real-world convention for
 * assets with no residual value, rather than fabricating a rate.
 */
export function computeMonthlyDecliningRate(cost: number, salvageValue: number, usefulLifeMonths: number): number {
  if (!(usefulLifeMonths > 0)) throw new ServiceError("usefulLifeMonths must be a positive number", 400)
  if (!(cost > 0)) throw new ServiceError("purchaseCost must be a positive number", 400)
  const salvage = Math.max(salvageValue, 0)
  if (salvage <= 0) return Math.min(1, 2 / usefulLifeMonths)
  const ratio = Math.min(1, salvage / cost)
  return 1 - Math.pow(ratio, 1 / usefulLifeMonths)
}

export type DepreciationScheduleEntry = {
  period: number
  scheduleDate: string
  depreciationAmount: number
  accumulatedDepreciationAfter: number
}

export type GenerateScheduleInput = {
  method: "straight_line" | "written_down_value"
  purchaseCost: number
  salvageValue: number
  usefulLifeMonths: number
  purchaseDate: string // YYYY-MM-DD
}

/** Last day of the calendar month `monthsAfter` months after purchaseDate's own month (0 = the purchase month itself). */
function endOfPeriodMonth(purchaseDate: string, monthsAfter: number): string {
  const [py, pm] = purchaseDate.split("-").map(Number)
  const total0 = (pm - 1) + monthsAfter
  const year = py + Math.floor(total0 / 12)
  const month0 = ((total0 % 12) + 12) % 12
  return new Date(Date.UTC(year, month0 + 1, 0)).toISOString().slice(0, 10)
}

/** Fraction of the purchase month remaining from (and including) the purchase day -- the mid-period-addition proration factor. */
function firstPeriodProrationFactor(purchaseDate: string): number {
  const [py, pm, pd] = purchaseDate.split("-").map(Number)
  const daysInPurchaseMonth = new Date(Date.UTC(py, pm, 0)).getUTCDate()
  const daysRemaining = daysInPurchaseMonth - pd + 1
  return Math.min(1, Math.max(0, daysRemaining / daysInPurchaseMonth))
}

/**
 * Generates a full period-by-period (monthly) depreciation schedule from
 * scratch, starting the month an asset is purchased/capitalized. Both
 * supported methods:
 *
 * - straight_line: (cost - salvage) / usefulLifeMonths per full month. The
 *   FIRST period is prorated by the fraction of the purchase month
 *   remaining (mid-period-addition handling -- an asset bought on the 20th
 *   of a 30-day month only depreciates 11/30 of a normal month in period
 *   1), and a trailing "true-up" period is appended to absorb exactly the
 *   shortfall that proration created, so the schedule always sums to
 *   exactly (cost - salvage) regardless of purchase day -- never silently
 *   under- or over-depreciates an asset.
 * - written_down_value (declining balance): each period depreciates
 *   currentBookValue * monthlyRate (period 1 also prorated by the same
 *   mid-period factor), capped so the running total never exceeds
 *   (cost - salvage) -- the cap on the final period is what makes a
 *   declining-balance schedule terminate exactly at the salvage value
 *   instead of asymptotically approaching it forever.
 *
 * Edge cases handled explicitly (both covered by
 * erp-fixed-assets-service.test.ts): a fully-depreciated-at-acquisition
 * asset (salvageValue >= purchaseCost) returns an empty schedule -- there is
 * nothing left to depreciate, this is not an error. A mid-period addition
 * (purchaseDate not on the 1st) prorates period 1 for both methods.
 */
export function generateDepreciationSchedule(input: GenerateScheduleInput): DepreciationScheduleEntry[] {
  const { method, purchaseCost, salvageValue, usefulLifeMonths, purchaseDate } = input
  if (!(usefulLifeMonths > 0)) throw new ServiceError("usefulLifeMonths must be a positive number to generate a depreciation schedule", 400)
  if (!(purchaseCost > 0)) throw new ServiceError("purchaseCost must be a positive number", 400)
  if (salvageValue < 0) throw new ServiceError("salvageValue cannot be negative", 400)

  const depreciableBase = round2(purchaseCost - salvageValue)
  if (depreciableBase <= 0) return [] // fully depreciated at acquisition -- e.g. salvageValue >= purchaseCost

  const firstFactor = firstPeriodProrationFactor(purchaseDate)
  const entries: DepreciationScheduleEntry[] = []
  let accumulated = 0

  if (method === "straight_line") {
    const monthlyAmount = depreciableBase / usefulLifeMonths
    const maxPeriods = usefulLifeMonths + 1 // +1 true-up period absorbs the first-period proration shortfall
    for (let k = 1; k <= maxPeriods; k++) {
      const remaining = round2(depreciableBase - accumulated)
      if (remaining <= 0) break
      let amount: number
      if (k === maxPeriods) {
        amount = remaining // last period: absorb every cent of remaining rounding/proration drift
      } else if (k === 1) {
        amount = round2(monthlyAmount * firstFactor)
      } else {
        amount = round2(Math.min(monthlyAmount, remaining))
      }
      if (amount <= 0) continue // a purchase on day 1 (firstFactor === 1) needs no true-up period at all
      accumulated = round2(accumulated + amount)
      entries.push({ period: k, scheduleDate: endOfPeriodMonth(purchaseDate, k - 1), depreciationAmount: amount, accumulatedDepreciationAfter: accumulated })
    }
  } else {
    const monthlyRate = computeMonthlyDecliningRate(purchaseCost, salvageValue, usefulLifeMonths)
    let bookValue = purchaseCost
    const maxPeriods = usefulLifeMonths + 1 // +1 true-up period, same rationale as straight_line above
    for (let k = 1; k <= maxPeriods; k++) {
      const maxAllowed = round2(depreciableBase - accumulated)
      if (maxAllowed <= 0) break
      const periodFactor = k === 1 ? firstFactor : 1
      let amount = round2(bookValue * monthlyRate * periodFactor)
      if (amount > maxAllowed) amount = maxAllowed // final period converges exactly to salvage value, never overshoots
      if (amount <= 0) continue
      accumulated = round2(accumulated + amount)
      bookValue = round2(bookValue - amount)
      entries.push({ period: k, scheduleDate: endOfPeriodMonth(purchaseDate, k - 1), depreciationAmount: amount, accumulatedDepreciationAfter: accumulated })
    }
  }
  return entries
}

// ============================================================
// Asset Categories
// ============================================================

export type AssetCategoryInput = {
  categoryName: string
  defaultDepreciationMethod?: "straight_line" | "written_down_value"
  defaultUsefulLifeMonths?: number
  assetAccountId?: string
  depreciationExpenseAccountId?: string
  accumulatedDepreciationAccountId?: string
}

export async function listAssetCategories(ctx: { orgId: string }) {
  await requireErpEnabled(ctx.orgId)
  return withTenantContext({ orgId: ctx.orgId }, (db) =>
    db.query.erpAssetCategories.findMany({ where: eq(erpAssetCategories.orgId, ctx.orgId), orderBy: (t, { asc }) => asc(t.categoryName) })
  )
}

async function validateAccountIds(db: TenantDb, orgId: string, accountIds: (string | undefined)[]) {
  const ids = [...new Set(accountIds.filter((id): id is string => Boolean(id)))]
  if (ids.length === 0) return
  const accounts = await db.query.erpAccounts.findMany({ where: eq(erpAccounts.orgId, orgId) })
  const validIds = new Set(accounts.map((a) => a.id))
  for (const id of ids) {
    if (!validIds.has(id)) throw new ServiceError("One or more accounts were not found in this organisation", 400)
  }
}

export async function createAssetCategory(ctx: ErpContext, input: AssetCategoryInput) {
  await requireErpEnabled(ctx.orgId)
  if (!input.categoryName?.trim()) throw new ServiceError("categoryName is required", 400)
  if (input.defaultUsefulLifeMonths !== undefined && !(input.defaultUsefulLifeMonths > 0)) {
    throw new ServiceError("defaultUsefulLifeMonths must be a positive number", 400)
  }

  return withTenantContext({ orgId: ctx.orgId, userId: ctx.userId }, async (db) => {
    await validateAccountIds(db, ctx.orgId, [input.assetAccountId, input.depreciationExpenseAccountId, input.accumulatedDepreciationAccountId])

    const [category] = await db.insert(erpAssetCategories).values({
      orgId: ctx.orgId,
      categoryName: input.categoryName,
      defaultDepreciationMethod: input.defaultDepreciationMethod ?? "straight_line",
      defaultUsefulLifeMonths: input.defaultUsefulLifeMonths,
      assetAccountId: input.assetAccountId,
      depreciationExpenseAccountId: input.depreciationExpenseAccountId,
      accumulatedDepreciationAccountId: input.accumulatedDepreciationAccountId,
    }).returning()

    await logActivity({ tx: db, orgId: ctx.orgId, dbUser: ctx.dbUser, action: "erp_asset_category.created", entityType: "erp_asset_category", entityId: category.id })
    return category
  })
}

export async function updateAssetCategory(ctx: ErpContext, categoryId: string, input: Partial<AssetCategoryInput>) {
  await requireErpEnabled(ctx.orgId)
  return withTenantContext({ orgId: ctx.orgId, userId: ctx.userId }, async (db) => {
    const existing = await db.query.erpAssetCategories.findFirst({ where: and(eq(erpAssetCategories.id, categoryId), eq(erpAssetCategories.orgId, ctx.orgId)) })
    if (!existing) throw new ServiceError("Asset category not found", 404)
    await validateAccountIds(db, ctx.orgId, [input.assetAccountId, input.depreciationExpenseAccountId, input.accumulatedDepreciationAccountId])

    const [updated] = await db.update(erpAssetCategories).set({
      categoryName: input.categoryName ?? existing.categoryName,
      defaultDepreciationMethod: input.defaultDepreciationMethod ?? existing.defaultDepreciationMethod,
      defaultUsefulLifeMonths: input.defaultUsefulLifeMonths ?? existing.defaultUsefulLifeMonths,
      assetAccountId: input.assetAccountId ?? existing.assetAccountId,
      depreciationExpenseAccountId: input.depreciationExpenseAccountId ?? existing.depreciationExpenseAccountId,
      accumulatedDepreciationAccountId: input.accumulatedDepreciationAccountId ?? existing.accumulatedDepreciationAccountId,
    }).where(eq(erpAssetCategories.id, categoryId)).returning()

    await logActivity({ tx: db, orgId: ctx.orgId, dbUser: ctx.dbUser, action: "erp_asset_category.updated", entityType: "erp_asset_category", entityId: categoryId })
    return updated
  })
}

// ============================================================
// Fixed Assets
// ============================================================

export type FixedAssetInput = {
  assetName: string
  assetCategoryId: string
  departmentId?: string
  custodianUserId?: string
  location?: string
  purchaseDate: string
  purchaseCost: number
  depreciationMethod?: "straight_line" | "written_down_value"
  usefulLifeMonths?: number
  salvageValue?: number
}

export async function listFixedAssets(ctx: { orgId: string }, filters: { status?: string; assetCategoryId?: string; departmentId?: string } = {}) {
  await requireErpEnabled(ctx.orgId)
  return withTenantContext({ orgId: ctx.orgId }, (db) => {
    const conditions = [eq(erpFixedAssets.orgId, ctx.orgId)]
    if (filters.status) conditions.push(eq(erpFixedAssets.status, filters.status as typeof erpFixedAssets.$inferSelect.status))
    if (filters.assetCategoryId) conditions.push(eq(erpFixedAssets.assetCategoryId, filters.assetCategoryId))
    if (filters.departmentId) conditions.push(eq(erpFixedAssets.departmentId, filters.departmentId))
    return db.query.erpFixedAssets.findMany({ where: and(...conditions), orderBy: (t, { desc }) => desc(t.purchaseDate), with: { category: true } })
  })
}

export async function getFixedAsset(ctx: { orgId: string }, assetId: string) {
  await requireErpEnabled(ctx.orgId)
  return withTenantContext({ orgId: ctx.orgId }, async (db) => {
    const asset = await db.query.erpFixedAssets.findFirst({
      where: and(eq(erpFixedAssets.id, assetId), eq(erpFixedAssets.orgId, ctx.orgId)),
      with: { category: true },
    })
    if (!asset) throw new ServiceError("Fixed asset not found", 404)
    return asset
  })
}

export async function createFixedAsset(ctx: ActorCtx, input: FixedAssetInput) {
  await requireErpEnabled(ctx.orgId)
  if (!input.assetName?.trim()) throw new ServiceError("assetName is required", 400)
  if (!input.assetCategoryId) throw new ServiceError("assetCategoryId is required", 400)
  if (!input.purchaseDate) throw new ServiceError("purchaseDate is required", 400)
  if (!(input.purchaseCost > 0)) throw new ServiceError("purchaseCost must be a positive number", 400)
  if (input.usefulLifeMonths !== undefined && !(input.usefulLifeMonths > 0)) throw new ServiceError("usefulLifeMonths must be a positive number", 400)
  if (input.salvageValue !== undefined && input.salvageValue < 0) throw new ServiceError("salvageValue cannot be negative", 400)

  return withTenantContext({ orgId: ctx.orgId, userId: ctx.userId }, async (db) => {
    const category = await db.query.erpAssetCategories.findFirst({ where: and(eq(erpAssetCategories.id, input.assetCategoryId), eq(erpAssetCategories.orgId, ctx.orgId)) })
    if (!category) throw new ServiceError("Asset category not found", 404)

    if (input.departmentId) {
      const dept = await db.query.departments.findFirst({ where: and(eq(departments.id, input.departmentId), eq(departments.orgId, ctx.orgId)) })
      if (!dept) throw new ServiceError("Department not found", 404)
    }
    if (input.custodianUserId) {
      const custodian = await db.query.users.findFirst({ where: and(eq(users.id, input.custodianUserId), eq(users.orgId, ctx.orgId)) })
      if (!custodian) throw new ServiceError("Custodian user not found in this organisation", 404)
    }

    const [asset] = await db.insert(erpFixedAssets).values({
      orgId: ctx.orgId,
      assetName: input.assetName,
      assetCategoryId: input.assetCategoryId,
      departmentId: input.departmentId,
      custodianUserId: input.custodianUserId,
      location: input.location,
      purchaseDate: input.purchaseDate,
      purchaseCost: input.purchaseCost.toString(),
      depreciationMethod: input.depreciationMethod ?? category.defaultDepreciationMethod,
      usefulLifeMonths: input.usefulLifeMonths ?? category.defaultUsefulLifeMonths,
      salvageValue: (input.salvageValue ?? 0).toString(),
      status: "draft",
      currentValue: input.purchaseCost.toString(),
      accumulatedDepreciation: "0",
    }).returning()

    await logActivity({ tx: db, orgId: ctx.orgId, ...actorLogFields(ctx), action: "erp_fixed_asset.created", entityType: "erp_fixed_asset", entityId: asset.id })
    return asset
  })
}

export async function updateFixedAsset(ctx: ErpContext, assetId: string, input: Partial<FixedAssetInput>) {
  await requireErpEnabled(ctx.orgId)
  const asset = await getFixedAsset(ctx, assetId)
  if (asset.status !== "draft") throw new ServiceError("Only a draft (not yet capitalized) asset can be edited", 409)

  return withTenantContext({ orgId: ctx.orgId, userId: ctx.userId }, async (db) => {
    if (input.departmentId) {
      const dept = await db.query.departments.findFirst({ where: and(eq(departments.id, input.departmentId), eq(departments.orgId, ctx.orgId)) })
      if (!dept) throw new ServiceError("Department not found", 404)
    }
    if (input.custodianUserId) {
      const custodian = await db.query.users.findFirst({ where: and(eq(users.id, input.custodianUserId), eq(users.orgId, ctx.orgId)) })
      if (!custodian) throw new ServiceError("Custodian user not found in this organisation", 404)
    }

    const purchaseCost = input.purchaseCost ?? Number(asset.purchaseCost)
    const [updated] = await db.update(erpFixedAssets).set({
      assetName: input.assetName ?? asset.assetName,
      departmentId: input.departmentId ?? asset.departmentId,
      custodianUserId: input.custodianUserId ?? asset.custodianUserId,
      location: input.location ?? asset.location,
      purchaseDate: input.purchaseDate ?? asset.purchaseDate,
      purchaseCost: purchaseCost.toString(),
      currentValue: purchaseCost.toString(),
      depreciationMethod: input.depreciationMethod ?? asset.depreciationMethod,
      usefulLifeMonths: input.usefulLifeMonths ?? asset.usefulLifeMonths,
      salvageValue: (input.salvageValue ?? Number(asset.salvageValue)).toString(),
      updatedAt: new Date(),
    }).where(eq(erpFixedAssets.id, assetId)).returning()

    await logActivity({ tx: db, orgId: ctx.orgId, dbUser: ctx.dbUser, action: "erp_fixed_asset.updated", entityType: "erp_fixed_asset", entityId: assetId })
    return updated
  })
}

/**
 * Capitalizes a draft asset: generates its full depreciation schedule up
 * front (every period computed once, matching how a real fixed-asset
 * register behaves -- not recomputed lazily on each run), optionally posts
 * the acquisition journal entry (debit the category's Asset Account, credit
 * a caller-supplied source account -- e.g. Bank/Cash/Accounts Payable), and
 * moves status draft -> in_use. There is deliberately no approval gate on
 * acquisition itself -- the funds to BUY the asset would already have gone
 * through Buying/Payment approval upstream of this module; this module's
 * own approval gate is reserved for DISPOSAL (see initiateAssetDisposal),
 * per the Owner's brief.
 */
export async function submitFixedAsset(ctx: ErpContext, assetId: string, input: { sourceAccountId?: string } = {}) {
  await requireErpEnabled(ctx.orgId)
  const asset = await getFixedAsset(ctx, assetId)
  if (asset.status !== "draft") throw new ServiceError("Only a draft asset can be submitted (capitalized)", 409)
  if (!asset.usefulLifeMonths || asset.usefulLifeMonths <= 0) {
    throw new ServiceError("This asset needs a positive usefulLifeMonths (set on the asset or its category) before it can be capitalized", 400)
  }

  const schedule = generateDepreciationSchedule({
    method: asset.depreciationMethod,
    purchaseCost: Number(asset.purchaseCost),
    salvageValue: Number(asset.salvageValue),
    usefulLifeMonths: asset.usefulLifeMonths,
    purchaseDate: asset.purchaseDate,
  })

  let journalEntryId: string | undefined
  if (input.sourceAccountId) {
    if (!asset.category.assetAccountId) {
      throw new ServiceError("This asset's category has no Asset Account configured -- set one on the category before posting an acquisition entry, or submit without a sourceAccountId to skip GL posting", 400)
    }
    // VERIDIAN Review Framework remediation: this module posts to the GL
    // (createJournalEntry) but, unlike every other GL-posting ERP service
    // in this codebase (erp-accounting-service.ts's submitJournalEntry,
    // erp-cash-service.ts, erp-invoicing-service.ts,
    // erp-payment-entries-service.ts -- all call isPeriodOpenForDate before
    // posting), this one never checked whether the posting date's
    // accounting period was still open. Without this, an asset could be
    // capitalized with an acquisition entry silently backdated into an
    // already-closed period. Closes the gap with the SAME existing helper
    // those other services already call, not a new check reinvented here.
    const periodOpen = await isPeriodOpenForDate(ctx, asset.purchaseDate)
    if (!periodOpen) {
      throw new ServiceError(`The accounting period covering ${asset.purchaseDate} is closed -- cannot post this asset's acquisition entry`, 409)
    }
    const lines: JournalEntryLineInput[] = [
      { accountId: asset.category.assetAccountId, debit: Number(asset.purchaseCost) },
      { accountId: input.sourceAccountId, credit: Number(asset.purchaseCost) },
    ]
    const je = await createJournalEntry({ orgId: ctx.orgId, userId: ctx.userId, dbUser: ctx.dbUser }, {
      postingDate: asset.purchaseDate,
      userRemark: `Asset acquisition: ${asset.assetName}`,
      referenceType: "erp_fixed_asset",
      referenceId: asset.id,
      lines,
    })
    journalEntryId = je.id
  }

  return withTenantContext({ orgId: ctx.orgId, userId: ctx.userId }, async (db) => {
    if (schedule.length > 0) {
      await db.insert(erpDepreciationSchedules).values(schedule.map((e) => ({
        assetId: asset.id,
        scheduleDate: e.scheduleDate,
        depreciationAmount: e.depreciationAmount.toString(),
        accumulatedDepreciationAfter: e.accumulatedDepreciationAfter.toString(),
        isPosted: false,
      })))
    }

    const [updated] = await db.update(erpFixedAssets).set({
      status: "in_use",
      journalEntryId: journalEntryId ?? asset.journalEntryId,
      updatedAt: new Date(),
    }).where(eq(erpFixedAssets.id, asset.id)).returning()

    await logActivity({ tx: db, orgId: ctx.orgId, dbUser: ctx.dbUser, action: "erp_fixed_asset.submitted", entityType: "erp_fixed_asset", entityId: asset.id })
    return { ...updated, scheduleCount: schedule.length }
  })
}

// ============================================================
// Depreciation schedule + runs
// ============================================================

export async function listDepreciationSchedule(ctx: { orgId: string }, assetId: string) {
  await requireErpEnabled(ctx.orgId)
  await getFixedAsset(ctx, assetId) // org-scope + existence check
  return withTenantContext({ orgId: ctx.orgId }, (db) =>
    db.query.erpDepreciationSchedules.findMany({ where: eq(erpDepreciationSchedules.assetId, assetId), orderBy: (t, { asc }) => asc(t.scheduleDate) })
  )
}

export type DepreciationRunResult = { scheduleId: string; assetId: string; journalEntryId?: string; depreciationAmount: number }
export type DepreciationRunFailure = { scheduleId: string; assetId: string; error: string }

/**
 * Posts every unposted depreciation-schedule row (optionally scoped to one
 * asset) whose scheduleDate <= asOfDate -- the real "depreciation run" a
 * firm executes monthly (or per its own fiscal calendar) to push
 * accumulated depreciation into the GL. Each schedule row posts its own
 * balanced journal entry (debit the category's Depreciation Expense
 * account, credit its Accumulated Depreciation account) and updates the
 * asset's own accumulatedDepreciation/currentValue -- never batches
 * multiple assets' depreciation into a single journal entry, so every
 * asset's postings stay independently auditable. An asset whose category
 * has no expense/accumulated-depreciation accounts configured still has its
 * schedule row marked posted and its accumulatedDepreciation/currentValue
 * updated -- it just has no journalEntryId, an honest "tracked but not
 * posted to the GL" state rather than silently skipping it.
 */
export async function runDepreciationBatch(ctx: ErpContext, input: { asOfDate: string; assetId?: string }): Promise<{ postedCount: number; results: DepreciationRunResult[]; skippedClosedPeriod: string[]; failed: DepreciationRunFailure[] }> {
  await requireErpEnabled(ctx.orgId)
  if (!input.asOfDate) throw new ServiceError("asOfDate is required", 400)

  const pending = await withTenantContext({ orgId: ctx.orgId }, (db) => {
    const conditions = [eq(erpDepreciationSchedules.isPosted, false), lte(erpDepreciationSchedules.scheduleDate, input.asOfDate)]
    if (input.assetId) conditions.push(eq(erpDepreciationSchedules.assetId, input.assetId))
    return db.query.erpDepreciationSchedules.findMany({ where: and(...conditions), orderBy: (t, { asc }) => asc(t.scheduleDate) })
  })

  const results: DepreciationRunResult[] = []
  const skippedClosedPeriod: string[] = []
  const failed: DepreciationRunFailure[] = []
  for (const row of pending) {
    // Schedule rows aren't directly orgId-tagged -- resolve + org-scope the
    // owning asset per row, and silently skip (never cross-post) any row
    // whose asset doesn't actually belong to this org.
    const asset = await withTenantContext({ orgId: ctx.orgId }, (db) =>
      db.query.erpFixedAssets.findFirst({ where: and(eq(erpFixedAssets.id, row.assetId), eq(erpFixedAssets.orgId, ctx.orgId)) })
    )
    if (!asset || asset.status !== "in_use") continue // disposed/scrapped/draft assets never depreciate further

    // VERIDIAN Review Framework remediation: matches submitFixedAsset's own
    // new isPeriodOpenForDate gate above -- a depreciation run must not
    // silently post into an already-closed accounting period either.
    // Unlike submitFixedAsset (a single-document action that throws),
    // this function already has an established "skip ineligible rows and
    // keep going" convention (the asset-not-found/not-in_use check just
    // above) -- a closed-period row is skipped the same way, so one closed
    // period never aborts an entire org-wide depreciation run.
    const periodOpen = await isPeriodOpenForDate(ctx, row.scheduleDate)
    if (!periodOpen) { skippedClosedPeriod.push(row.id); continue }

    const category = await withTenantContext({ orgId: ctx.orgId }, (db) =>
      db.query.erpAssetCategories.findFirst({ where: eq(erpAssetCategories.id, asset.assetCategoryId) })
    )

    let journalEntryId: string | undefined
    if (category?.depreciationExpenseAccountId && category?.accumulatedDepreciationAccountId) {
      const je = await createJournalEntry({ orgId: ctx.orgId, userId: ctx.userId, dbUser: ctx.dbUser }, {
        postingDate: row.scheduleDate,
        userRemark: `Depreciation: ${asset.assetName}`,
        referenceType: "erp_depreciation_schedule",
        referenceId: row.id,
        lines: [
          { accountId: category.depreciationExpenseAccountId, debit: Number(row.depreciationAmount) },
          { accountId: category.accumulatedDepreciationAccountId, credit: Number(row.depreciationAmount) },
        ],
      })
      journalEntryId = je.id
    }

    // Automatic Rollback & Recovery (VERIDIAN Review Framework gap closure,
    // 2026-07-18): createJournalEntry above already committed in its own
    // transaction. If this second, separate write throws, the schedule row
    // stays isPosted:false -- the exact condition the `pending` query above
    // re-selects on the next run -- so without the compensating void below,
    // a retry would post a SECOND depreciation JE for the same row. Caught
    // and skipped (not rethrown) rather than aborting the whole batch,
    // matching this function's own existing "one bad row never aborts the
    // rest" convention (asset-not-found/closed-period above).
    try {
      await withTenantContext({ orgId: ctx.orgId, userId: ctx.userId }, async (db) => {
        await db.update(erpDepreciationSchedules).set({ isPosted: true, journalEntryId }).where(eq(erpDepreciationSchedules.id, row.id))
        const newAccumulated = round2(Number(row.accumulatedDepreciationAfter))
        const newCurrentValue = round2(Number(asset.purchaseCost) - newAccumulated)
        await db.update(erpFixedAssets).set({ accumulatedDepreciation: newAccumulated.toString(), currentValue: newCurrentValue.toString(), updatedAt: new Date() }).where(eq(erpFixedAssets.id, asset.id))
        await logActivity({ tx: db, orgId: ctx.orgId, dbUser: ctx.dbUser, action: "erp_depreciation_schedule.posted", entityType: "erp_depreciation_schedule", entityId: row.id })
      })
    } catch (error) {
      if (journalEntryId) {
        await voidDraftJournalEntry(ctx, journalEntryId, `runDepreciationBatch follow-up write failed for schedule ${row.id}`).catch(() => {})
      }
      failed.push({ scheduleId: row.id, assetId: asset.id, error: error instanceof Error ? error.message : String(error) })
      continue
    }

    results.push({ scheduleId: row.id, assetId: asset.id, journalEntryId, depreciationAmount: Number(row.depreciationAmount) })
  }

  return { postedCount: results.length, results, skippedClosedPeriod, failed }
}

// ============================================================
// Asset Movements (transfers between locations/departments/custodians)
// ============================================================

export type AssetMovementInput = { movementDate: string; toLocation?: string; toCustodianId?: string; purpose?: string }

export async function listAssetMovements(ctx: { orgId: string }, assetId: string) {
  await requireErpEnabled(ctx.orgId)
  await getFixedAsset(ctx, assetId) // org-scope + existence check
  return withTenantContext({ orgId: ctx.orgId }, (db) =>
    db.query.erpAssetMovements.findMany({ where: eq(erpAssetMovements.assetId, assetId), orderBy: (t, { desc }) => desc(t.movementDate) })
  )
}

export async function createAssetMovement(ctx: ErpContext, assetId: string, input: AssetMovementInput) {
  await requireErpEnabled(ctx.orgId)
  const asset = await getFixedAsset(ctx, assetId)
  if (asset.status === "draft") throw new ServiceError("A draft (not yet capitalized) asset cannot be moved", 409)
  if (asset.status === "disposed" || asset.status === "scrapped") throw new ServiceError("A disposed asset cannot be moved", 409)
  if (!input.movementDate) throw new ServiceError("movementDate is required", 400)
  if (!input.toLocation && !input.toCustodianId) throw new ServiceError("toLocation or toCustodianId is required", 400)

  return withTenantContext({ orgId: ctx.orgId, userId: ctx.userId }, async (db) => {
    if (input.toCustodianId) {
      const custodian = await db.query.users.findFirst({ where: and(eq(users.id, input.toCustodianId), eq(users.orgId, ctx.orgId)) })
      if (!custodian) throw new ServiceError("Custodian user not found in this organisation", 404)
    }

    const [movement] = await db.insert(erpAssetMovements).values({
      assetId,
      movementDate: input.movementDate,
      fromLocation: asset.location,
      toLocation: input.toLocation ?? asset.location,
      fromCustodianId: asset.custodianUserId,
      toCustodianId: input.toCustodianId ?? asset.custodianUserId,
      purpose: input.purpose,
      createdById: ctx.userId,
    }).returning()

    await db.update(erpFixedAssets).set({
      location: input.toLocation ?? asset.location,
      custodianUserId: input.toCustodianId ?? asset.custodianUserId,
      updatedAt: new Date(),
    }).where(eq(erpFixedAssets.id, assetId))

    await logActivity({ tx: db, orgId: ctx.orgId, dbUser: ctx.dbUser, action: "erp_asset_movement.created", entityType: "erp_asset_movement", entityId: movement.id })
    return movement
  })
}

// ============================================================
// Asset Disposal (sale / scrap / write-off) -- the one place this module
// gates on a real approval step (Owner's brief: "requiring a real
// authenticated user at manager rank or above, not just an API key,
// matching this codebase's existing convention" -- studied
// src/app/api/documents/[id]/dispose/route.ts, the closest existing
// analog, which gates its own disposal action with exactly
// `requireRole(dbUser, "manager")` at the route layer; the route in this
// wave, src/app/api/erp/fixed-assets/[id]/disposals/route.ts, follows that
// same precedent). initiateAssetDisposal itself additionally only accepts
// ErpContext (a real dbUser), never an ActorCtx api-key actor, matching
// submitJournalEntry/submitPurchaseRequisition's identical "starts an
// approval-workflow instance -> requires a real user" precedent.
// ============================================================

export type AssetDisposalInput = { disposalDate: string; disposalType: "sale" | "scrap" | "write_off"; saleValue?: number }

export async function listAssetDisposals(ctx: { orgId: string }, assetId: string) {
  await requireErpEnabled(ctx.orgId)
  await getFixedAsset(ctx, assetId) // org-scope + existence check
  return withTenantContext({ orgId: ctx.orgId }, (db) =>
    db.query.erpAssetDisposals.findMany({ where: eq(erpAssetDisposals.assetId, assetId), orderBy: (t, { desc }) => desc(t.createdAt) })
  )
}

export async function initiateAssetDisposal(ctx: ErpContext, assetId: string, input: AssetDisposalInput) {
  await requireErpEnabled(ctx.orgId)
  const asset = await getFixedAsset(ctx, assetId)
  if (asset.status !== "in_use") throw new ServiceError("Only an in-use asset can be disposed", 409)
  if (!input.disposalDate) throw new ServiceError("disposalDate is required", 400)
  if (!["sale", "scrap", "write_off"].includes(input.disposalType)) {
    throw new ServiceError("disposalType must be 'sale', 'scrap', or 'write_off'", 400)
  }
  if (input.disposalType === "sale" && !(input.saleValue! > 0)) {
    throw new ServiceError("saleValue is required and must be positive for a sale disposal", 400)
  }

  const existingPending = await withTenantContext({ orgId: ctx.orgId }, (db) =>
    db.query.erpAssetDisposals.findFirst({ where: and(eq(erpAssetDisposals.assetId, assetId), eq(erpAssetDisposals.status, "pending")) })
  )
  if (existingPending) throw new ServiceError("This asset already has a disposal pending approval", 409)

  const disposal = await withTenantContext({ orgId: ctx.orgId, userId: ctx.userId }, async (db) => {
    const [row] = await db.insert(erpAssetDisposals).values({
      assetId,
      disposalDate: input.disposalDate,
      disposalType: input.disposalType,
      saleValue: input.saleValue !== undefined ? input.saleValue.toString() : undefined,
      status: "pending",
      createdById: ctx.userId,
    }).returning()
    await logActivity({ tx: db, orgId: ctx.orgId, dbUser: ctx.dbUser, action: "erp_asset_disposal.created", entityType: "erp_asset_disposal", entityId: row.id })
    return row
  })

  const netBookValue = round2(Number(asset.purchaseCost) - Number(asset.accumulatedDepreciation))
  const instance = await startApprovalWorkflow(ctx, {
    entityType: "erp_asset_disposal",
    entityId: disposal.id,
    entityData: { netBookValue, saleValue: input.saleValue ?? 0 },
  })

  if (!instance) {
    const finalized = await finalizeAssetDisposal(ctx, disposal.id)
    return { ...finalized, pendingApproval: false }
  }
  return { ...disposal, pendingApproval: true, approvalInstanceId: instance.id }
}

/**
 * Posts the disposal journal entry (asset write-off against its category's
 * Asset Account + Accumulated Depreciation account, plus a gain/loss line
 * when a sale's proceeds differ from the asset's net book value) and marks
 * the asset disposed (sale) or scrapped (scrap/write-off). Called either
 * directly by initiateAssetDisposal (no approval workflow configured for
 * this org -> auto-finalize, matching every other module's own
 * no-workflow-configured default) or from the approval-decide route once a
 * disposal's workflow instance reaches 'approved'.
 *
 * Deliberately out of scope: posting the actual cash/bank receipt for a
 * sale disposal -- that is Payment Entries' own boundary (a separate Wave B
 * workstream), not this module's. This function only posts the asset
 * write-off + any gain/loss, honestly, never a fabricated cash-side entry.
 */
export async function finalizeAssetDisposal(ctx: { orgId: string; userId: string; dbUser: typeof users.$inferSelect }, disposalId: string) {
  await requireErpEnabled(ctx.orgId)
  const disposal = await withTenantContext({ orgId: ctx.orgId }, (db) => db.query.erpAssetDisposals.findFirst({ where: eq(erpAssetDisposals.id, disposalId) }))
  if (!disposal) throw new ServiceError("Disposal not found", 404)
  if (disposal.status !== "pending") throw new ServiceError("Only a disposal pending approval can be finalized", 409)

  const asset = await withTenantContext({ orgId: ctx.orgId }, (db) =>
    db.query.erpFixedAssets.findFirst({ where: and(eq(erpFixedAssets.id, disposal.assetId), eq(erpFixedAssets.orgId, ctx.orgId)) })
  )
  if (!asset) throw new ServiceError("Asset not found", 404)
  const category = await withTenantContext({ orgId: ctx.orgId }, (db) => db.query.erpAssetCategories.findFirst({ where: eq(erpAssetCategories.id, asset.assetCategoryId) }))

  const netBookValue = round2(Number(asset.purchaseCost) - Number(asset.accumulatedDepreciation))
  // Defense-in-depth invariant guard (VERIDIAN Review Framework
  // remediation): generateDepreciationSchedule already caps accumulated
  // depreciation at (purchaseCost - salvageValue) by construction (see that
  // function's own comment + erp-fixed-assets-service.test.ts's coverage
  // of it), so netBookValue should never actually go negative through this
  // module's own normal code path. This check exists purely as a cheap,
  // explicit safety net against a future regression (e.g. a manual data
  // fix, or a future change to the schedule engine) rather than silently
  // assuming the invariant will always hold -- refuses to post a disposal
  // that would represent an asset disposed below zero net value.
  if (netBookValue < 0) {
    throw new ServiceError(`Asset ${asset.assetName} has a negative net book value (${netBookValue}) -- refusing to post a disposal; this indicates a data-integrity issue upstream of this disposal, not something a disposal can fix`, 409)
  }
  const saleValue = round2(Number(disposal.saleValue ?? 0))
  const gainLoss = round2(saleValue - netBookValue) // positive = gain on disposal, negative = loss

  // VERIDIAN Review Framework remediation: same isPeriodOpenForDate gate as
  // submitFixedAsset/runDepreciationBatch above -- a disposal must not
  // silently post its write-off/gain-loss entry into an already-closed
  // accounting period either. Folded into the existing GL-posting
  // condition below (not a separate throw) so a closed period degrades
  // the exact same way the missing-accounts case already does: the
  // disposal itself still completes, "tracked but not posted to the GL"
  // -- consistent with this function's own existing honesty convention,
  // not a new posture invented here.
  const periodOpenForDisposal = await isPeriodOpenForDate(ctx, disposal.disposalDate)

  let journalEntryId: string | undefined
  if (category?.assetAccountId && category?.accumulatedDepreciationAccountId && periodOpenForDisposal) {
    const lines: JournalEntryLineInput[] = [
      { accountId: category.accumulatedDepreciationAccountId, debit: Number(asset.accumulatedDepreciation) },
      { accountId: category.assetAccountId, credit: Number(asset.purchaseCost) },
    ]
    // Reuses the category's own Depreciation Expense account as the
    // gain/loss-on-disposal line when no dedicated account is configured --
    // an honest, documented limitation (this schema has no separate
    // gain/loss-on-disposal account field), not a fabricated account.
    if (Math.abs(gainLoss) > 0.01 && category.depreciationExpenseAccountId) {
      if (gainLoss > 0) lines.push({ accountId: category.depreciationExpenseAccountId, credit: Math.abs(gainLoss) })
      else lines.push({ accountId: category.depreciationExpenseAccountId, debit: Math.abs(gainLoss) })
    }
    const totalDebit = lines.reduce((s, l) => s + (l.debit ?? 0), 0)
    const totalCredit = lines.reduce((s, l) => s + (l.credit ?? 0), 0)
    if (Math.abs(totalDebit - totalCredit) <= 0.01) {
      const je = await createJournalEntry({ orgId: ctx.orgId, userId: ctx.userId, dbUser: ctx.dbUser }, {
        postingDate: disposal.disposalDate,
        userRemark: `Disposal (${disposal.disposalType}): ${asset.assetName}`,
        referenceType: "erp_asset_disposal",
        referenceId: disposal.id,
        lines,
      })
      journalEntryId = je.id
    }
    // If debits/credits don't balance (gain/loss line couldn't be posted
    // cleanly, e.g. rounding beyond the 0.01 tolerance), this deliberately
    // skips GL posting rather than pushing an unbalanced entry -- the
    // disposal itself still completes (see below), same "tracked but not
    // posted to the GL" honesty as runDepreciationBatch's own
    // no-accounts-configured branch.
  }

  // Automatic Rollback & Recovery (VERIDIAN Review Framework gap closure,
  // 2026-07-18): createJournalEntry above already committed independently.
  // If this final write throws, `disposal.status` stays 'pending' (this
  // function's own re-entry guard above), so it's safely retriable -- but
  // without voiding the just-created JE first, that retry would post a
  // SECOND write-off/gain-loss entry for the same disposal. Void it, then
  // rethrow the original error unchanged (single-document action, same
  // "throw and let the caller see the real failure" convention as
  // submitFixedAsset).
  try {
    return await withTenantContext({ orgId: ctx.orgId, userId: ctx.userId }, async (db) => {
      await db.update(erpAssetDisposals).set({ status: "completed", journalEntryId }).where(eq(erpAssetDisposals.id, disposalId))
      const [updatedAsset] = await db.update(erpFixedAssets).set({
        status: disposal.disposalType === "sale" ? "disposed" : "scrapped",
        currentValue: "0",
        updatedAt: new Date(),
      }).where(eq(erpFixedAssets.id, asset.id)).returning()

      await logActivity({ tx: db, orgId: ctx.orgId, dbUser: ctx.dbUser, action: "erp_asset_disposal.completed", entityType: "erp_asset_disposal", entityId: disposalId })
      return { ...updatedAsset, disposalId, journalEntryId, gainLoss }
    })
  } catch (error) {
    if (journalEntryId) {
      await voidDraftJournalEntry(ctx, journalEntryId, `finalizeAssetDisposal follow-up write failed for disposal ${disposalId}`).catch(() => {})
    }
    throw error
  }
}

/** Called from the approval-decide route once a disposal's workflow instance is rejected -- the disposal stays a real, visible 'rejected' record rather than lingering forever as 'pending'; the asset itself is untouched, still 'in_use'. */
export async function markAssetDisposalRejectedFromApproval(ctx: { orgId: string; userId: string; dbUser: typeof users.$inferSelect }, disposalId: string) {
  await requireErpEnabled(ctx.orgId)
  return withTenantContext({ orgId: ctx.orgId, userId: ctx.userId }, async (db) => {
    const [updated] = await db.update(erpAssetDisposals).set({ status: "rejected" }).where(eq(erpAssetDisposals.id, disposalId)).returning()
    if (!updated) throw new ServiceError("Disposal not found", 404)
    await logActivity({ tx: db, orgId: ctx.orgId, dbUser: ctx.dbUser, action: "erp_asset_disposal.rejected", entityType: "erp_asset_disposal", entityId: disposalId })
    return updated
  })
}
