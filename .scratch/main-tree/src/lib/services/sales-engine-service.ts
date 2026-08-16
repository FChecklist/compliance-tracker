// Wave 109 (Sales Engine): cross-product referral, pipeline & commission
// tracking, attaching to every existing product (grc/office, erp, pms, hr,
// facilities_management, the_firm, forge). Platform-owned entities with no
// org_id -- see schema.ts's own Sales Engine section header for the full
// rationale. Uses the raw (RLS-bypassing) `db` export throughout,
// deliberately never withTenantContext, the same posture auth-guard.ts's
// autoProvisionUser() already uses for organisations/users/departments:
// there is no org (or even org-shaped) tenant context for an external
// sales partner to be scoped into. Every exported function takes an
// already-resolved identity (a partnerId from a validated token, or an
// admin's dbUser) as an explicit argument -- never a client-supplied id
// trusted directly.
import { db, salesPartners, salesReferralLinks, salesReferrals, salesCommissionPlans, salesCommissionAccruals, organisations } from "@/lib/db"
import { eq, and, isNull, sql as drizzleSql } from "drizzle-orm"
import { createId } from "@paralleldrive/cuid2"
import { hasRole, type UserRole } from "@/lib/supabase/auth-guard"
import type { users } from "@/lib/db"
// Gap closure, 2026-07-09 (AUDIT_2026-07-09.md): this module used to define
// its own independent ServiceError class, identical in shape to
// compliance-service.ts's. Two classes with the same name/shape is a real
// footgun for `instanceof` checks (an error thrown by one module would fail
// an `instanceof ServiceError` check against the other's class) even though
// no route currently mixes the two -- re-exporting the canonical one
// closes the risk rather than waiting for it to bite.
export { ServiceError } from "./compliance-service"
import { ServiceError } from "./compliance-service"

type AdminCtx = { dbUser: typeof users.$inferSelect | null }

function requireAdmin(ctx: AdminCtx, minimumRole: UserRole = "veridian_admin") {
  if (!hasRole(ctx.dbUser, minimumRole)) {
    throw new ServiceError(`This action requires ${minimumRole} role or higher`, 403)
  }
}

// productKey is free text on every table (see schema.ts's own comment for
// why a hard FK to product_branches would incorrectly reject 'forge' and
// 'crm') -- validated here against a small hardcoded allowlist instead.
export const KNOWN_PRODUCT_KEYS = ["grc", "erp", "pms", "hr", "crm", "facilities_management", "the_firm", "forge"] as const

function generateToken(): string {
  return createId()
}

// ─── Partner dashboard token resolution ──────────────────────────────────
function assertValidPartnerToken(partner: typeof salesPartners.$inferSelect | undefined) {
  if (!partner || partner.dashboardTokenRevokedAt || partner.dashboardTokenExpiresAt < new Date() || partner.status !== "active") {
    throw new ServiceError("This partner dashboard link is invalid, expired, or revoked", 404)
  }
}

export async function resolvePartnerByToken(token: string) {
  const partner = await db.query.salesPartners.findFirst({ where: eq(salesPartners.dashboardToken, token) })
  assertValidPartnerToken(partner)
  return partner!
}

// ─── Admin: partner CRUD ──────────────────────────────────────────────────
export type CreateSalesPartnerInput = {
  name: string
  email: string
  phone?: string | null
  partnerType: typeof salesPartners.$inferSelect["partnerType"]
  companyName?: string | null
  notes?: string | null
}

export async function createSalesPartner(ctx: AdminCtx, input: CreateSalesPartnerInput) {
  requireAdmin(ctx)
  if (!input.name?.trim()) throw new ServiceError("name is required", 400)
  if (!input.email?.trim()) throw new ServiceError("email is required", 400)

  const now = new Date()
  const tokenExpiry = new Date(now)
  tokenExpiry.setFullYear(tokenExpiry.getFullYear() + 5) // long-lived; partners return repeatedly

  const [partner] = await db.insert(salesPartners).values({
    name: input.name.trim(),
    email: input.email.trim().toLowerCase(),
    phone: input.phone ?? null,
    partnerType: input.partnerType,
    companyName: input.companyName ?? null,
    notes: input.notes ?? null,
    dashboardToken: generateToken(),
    dashboardTokenExpiresAt: tokenExpiry,
    createdById: ctx.dbUser?.id ?? null,
  }).returning()

  return partner
}

export async function listSalesPartners(ctx: AdminCtx) {
  requireAdmin(ctx)
  return db.query.salesPartners.findMany({ orderBy: (t, { desc: d }) => d(t.createdAt) })
}

export async function revokePartnerToken(ctx: AdminCtx, partnerId: string) {
  requireAdmin(ctx)
  const [updated] = await db.update(salesPartners).set({ dashboardTokenRevokedAt: new Date(), updatedAt: new Date() }).where(eq(salesPartners.id, partnerId)).returning()
  if (!updated) throw new ServiceError("Partner not found", 404)
  return updated
}

export async function rotatePartnerToken(ctx: AdminCtx, partnerId: string) {
  requireAdmin(ctx)
  const now = new Date()
  const tokenExpiry = new Date(now)
  tokenExpiry.setFullYear(tokenExpiry.getFullYear() + 5)
  const [updated] = await db.update(salesPartners).set({
    dashboardToken: generateToken(), dashboardTokenExpiresAt: tokenExpiry, dashboardTokenRevokedAt: null, updatedAt: now,
  }).where(eq(salesPartners.id, partnerId)).returning()
  if (!updated) throw new ServiceError("Partner not found", 404)
  return updated
}

export async function suspendSalesPartner(ctx: AdminCtx, partnerId: string) {
  requireAdmin(ctx)
  const [updated] = await db.update(salesPartners).set({ status: "suspended", updatedAt: new Date() }).where(eq(salesPartners.id, partnerId)).returning()
  if (!updated) throw new ServiceError("Partner not found", 404)
  return updated
}

// ─── Admin: referral link + commission plan CRUD ─────────────────────────
export async function createReferralLink(ctx: AdminCtx, input: { salesPartnerId: string; productKey?: string | null; label?: string | null }) {
  requireAdmin(ctx)
  if (input.productKey && !KNOWN_PRODUCT_KEYS.includes(input.productKey as (typeof KNOWN_PRODUCT_KEYS)[number])) {
    throw new ServiceError(`Unknown productKey '${input.productKey}'`, 400)
  }
  const partner = await db.query.salesPartners.findFirst({ where: eq(salesPartners.id, input.salesPartnerId) })
  if (!partner) throw new ServiceError("Partner not found", 404)

  const [link] = await db.insert(salesReferralLinks).values({
    salesPartnerId: input.salesPartnerId,
    productKey: input.productKey ?? null,
    label: input.label ?? null,
    token: generateToken(),
  }).returning()
  return link
}

export async function listReferralLinksForPartner(partnerId: string) {
  return db.query.salesReferralLinks.findMany({ where: eq(salesReferralLinks.salesPartnerId, partnerId), orderBy: (t, { desc: d }) => d(t.createdAt) })
}

export type CommissionPlanInput = {
  productKey: string
  partnerType?: typeof salesCommissionPlans.$inferSelect["partnerType"] | null
  commissionType: typeof salesCommissionPlans.$inferSelect["commissionType"]
  rate?: number | null
  flatAmount?: number | null
  currency?: string
}

export async function createOrUpdateCommissionPlan(ctx: AdminCtx, input: CommissionPlanInput) {
  requireAdmin(ctx)
  if (!KNOWN_PRODUCT_KEYS.includes(input.productKey as (typeof KNOWN_PRODUCT_KEYS)[number])) {
    throw new ServiceError(`Unknown productKey '${input.productKey}'`, 400)
  }
  if (input.commissionType === "percentage" && (input.rate == null || input.rate <= 0)) {
    throw new ServiceError("rate is required for a percentage commission plan", 400)
  }
  if (input.commissionType === "flat" && (input.flatAmount == null || input.flatAmount <= 0)) {
    throw new ServiceError("flatAmount is required for a flat commission plan", 400)
  }

  const [plan] = await db.insert(salesCommissionPlans).values({
    productKey: input.productKey,
    partnerType: input.partnerType ?? null,
    commissionType: input.commissionType,
    rate: input.rate != null ? String(input.rate) : null,
    flatAmount: input.flatAmount != null ? String(input.flatAmount) : null,
    currency: input.currency ?? "INR",
    createdById: ctx.dbUser?.id ?? null,
  }).returning()
  return plan
}

export async function listCommissionPlans(ctx: AdminCtx) {
  requireAdmin(ctx)
  return db.query.salesCommissionPlans.findMany({ orderBy: (t, { asc }) => asc(t.productKey) })
}

// ─── Public: /r/[token] redirect handler ─────────────────────────────────
export async function resolveReferralLinkAndRecordClick(linkToken: string) {
  const link = await db.query.salesReferralLinks.findFirst({ where: and(eq(salesReferralLinks.token, linkToken), eq(salesReferralLinks.isActive, true)) })
  if (!link) throw new ServiceError("This referral link is invalid or has been deactivated", 404)

  await db.update(salesReferralLinks).set({ clickCount: drizzleSql`${salesReferralLinks.clickCount} + 1` }).where(eq(salesReferralLinks.id, link.id))
  await db.insert(salesReferrals).values({
    salesPartnerId: link.salesPartnerId,
    salesReferralLinkId: link.id,
    productKey: link.productKey,
    status: "clicked",
  })
  return link
}

// ─── Called from autoProvisionUser() at signup+org-creation time ─────────
// Resolves the most recent unclaimed 'clicked' referral for this link
// token and advances it to org_provisioned in one step, since signup and
// org creation now happen in the same request (autoProvisionUser already
// does both). Fails silently (returns null) on a stale/invalid ref token
// -- this must never block a real signup.
export async function recordReferralSignupAndOrgProvisioned(input: {
  refToken: string
  authUserId: string
  orgId: string
  ipAddress?: string | null
  userAgent?: string | null
}) {
  const link = await db.query.salesReferralLinks.findFirst({ where: eq(salesReferralLinks.token, input.refToken) })
  if (!link) return null

  const referral = await db.query.salesReferrals.findFirst({
    where: and(eq(salesReferrals.salesReferralLinkId, link.id), eq(salesReferrals.status, "clicked"), isNull(salesReferrals.authUserId)),
    orderBy: (t, { desc: d }) => d(t.clickedAt),
  })
  if (!referral) return null

  const now = new Date()
  const [updated] = await db.update(salesReferrals).set({
    status: "org_provisioned",
    authUserId: input.authUserId,
    orgId: input.orgId,
    ipAddress: input.ipAddress ?? null,
    userAgent: input.userAgent ?? null,
    signupCompletedAt: now,
    orgProvisionedAt: now,
  }).where(eq(salesReferrals.id, referral.id)).returning()

  return updated
}

// ─── "Paid" milestone: organisations.plan moving off 'free' ──────────────
// Call this wherever an org's plan is recorded as changing (an admin
// plan-change action, or a future billing-system hook) -- not a new
// cron/webhook this wave.
export async function markReferralPaidIfApplicable(orgId: string, newPlan: string) {
  if (newPlan === "free") return null
  const referral = await db.query.salesReferrals.findFirst({ where: and(eq(salesReferrals.orgId, orgId), eq(salesReferrals.status, "org_provisioned")) })
  if (!referral) return null

  const [updated] = await db.update(salesReferrals).set({ status: "paid", paidAt: new Date() }).where(eq(salesReferrals.id, referral.id)).returning()
  await accrueCommissionForReferral(referral.id, referral.productKey, referral.salesPartnerId)
  return updated
}

// Resolves the most-specific matching active commission plan
// (partner-type-specific row wins over the product's null-partnerType
// default row) and inserts one 'accrued' ledger row. Percentage plans
// need dealValue supplied by the caller (organisations has no price/ARR
// column today -- see out-of-scope note) -- if none is supplied for a
// percentage plan, the accrual is skipped rather than guessing an amount.
async function accrueCommissionForReferral(referralId: string, productKey: string | null, salesPartnerId: string, dealValue?: number) {
  if (!productKey) return null

  const referral = await db.query.salesReferrals.findFirst({ where: eq(salesReferrals.id, referralId) })
  const partner = await db.query.salesPartners.findFirst({ where: eq(salesPartners.id, salesPartnerId) })
  if (!partner) return null

  const plans = await db.query.salesCommissionPlans.findMany({ where: and(eq(salesCommissionPlans.productKey, productKey), eq(salesCommissionPlans.isActive, true)) })
  const specific = plans.find((p) => p.partnerType === partner.partnerType)
  const plan = specific ?? plans.find((p) => p.partnerType === null)
  if (!plan) return null

  let amount: number | null = null
  if (plan.commissionType === "flat" && plan.flatAmount != null) {
    amount = Number(plan.flatAmount)
  } else if (plan.commissionType === "percentage" && plan.rate != null && dealValue != null) {
    amount = Math.round(dealValue * (Number(plan.rate) / 100) * 100) / 100
  }
  if (amount == null) return null // percentage plan with no dealValue supplied -- skip rather than guess

  const [accrual] = await db.insert(salesCommissionAccruals).values({
    salesReferralId: referralId,
    salesPartnerId,
    productKey,
    salesCommissionPlanId: plan.id,
    dealValue: dealValue != null ? String(dealValue) : null,
    amount: String(amount),
    currency: plan.currency,
    status: "accrued",
  }).returning()

  void referral // referenced for clarity that this runs in the referral's context; not otherwise needed
  return accrual
}

// ─── Admin: manual commission status transitions (append-only) ──────────
export async function markCommissionPaid(ctx: AdminCtx, accrualId: string, note?: string) {
  requireAdmin(ctx)
  const existing = await db.query.salesCommissionAccruals.findFirst({ where: eq(salesCommissionAccruals.id, accrualId) })
  if (!existing) throw new ServiceError("Commission accrual not found", 404)
  if (existing.status !== "accrued") throw new ServiceError(`Cannot mark a '${existing.status}' accrual as paid`, 409)

  const [row] = await db.insert(salesCommissionAccruals).values({
    salesReferralId: existing.salesReferralId,
    salesPartnerId: existing.salesPartnerId,
    productKey: existing.productKey,
    salesCommissionPlanId: existing.salesCommissionPlanId,
    dealValue: existing.dealValue,
    amount: existing.amount,
    currency: existing.currency,
    status: "paid",
    note: note ?? null,
    recordedById: ctx.dbUser?.id ?? null,
  }).returning()
  return row
}

export async function voidCommissionAccrual(ctx: AdminCtx, accrualId: string, note: string) {
  requireAdmin(ctx)
  if (!note?.trim()) throw new ServiceError("A note is required to void a commission accrual", 400)
  const existing = await db.query.salesCommissionAccruals.findFirst({ where: eq(salesCommissionAccruals.id, accrualId) })
  if (!existing) throw new ServiceError("Commission accrual not found", 404)

  const [row] = await db.insert(salesCommissionAccruals).values({
    salesReferralId: existing.salesReferralId,
    salesPartnerId: existing.salesPartnerId,
    productKey: existing.productKey,
    salesCommissionPlanId: existing.salesCommissionPlanId,
    amount: "0",
    currency: existing.currency,
    status: "void",
    note: note.trim(),
    recordedById: ctx.dbUser?.id ?? null,
  }).returning()
  return row
}

// ─── Partner dashboard read model ────────────────────────────────────────
export async function getPartnerDashboard(partnerId: string) {
  const [links, referrals, accruals] = await Promise.all([
    db.query.salesReferralLinks.findMany({ where: eq(salesReferralLinks.salesPartnerId, partnerId), orderBy: (t, { desc: d }) => d(t.createdAt) }),
    db.query.salesReferrals.findMany({ where: eq(salesReferrals.salesPartnerId, partnerId), orderBy: (t, { desc: d }) => d(t.clickedAt), limit: 50 }),
    db.query.salesCommissionAccruals.findMany({ where: eq(salesCommissionAccruals.salesPartnerId, partnerId), orderBy: (t, { desc: d }) => d(t.createdAt) }),
  ])

  const pipelineByStatus: Record<string, number> = {}
  for (const r of referrals) pipelineByStatus[r.status] = (pipelineByStatus[r.status] ?? 0) + 1

  // Latest-row-per-referralId aggregation (append-only ledger convention)
  const latestByReferral = new Map<string, typeof accruals[number]>()
  for (const a of accruals) {
    const existing = latestByReferral.get(a.salesReferralId)
    if (!existing || a.createdAt > existing.createdAt) latestByReferral.set(a.salesReferralId, a)
  }
  let accruedTotal = 0
  let paidTotal = 0
  for (const a of latestByReferral.values()) {
    if (a.status === "accrued") accruedTotal += Number(a.amount)
    if (a.status === "paid") paidTotal += Number(a.amount)
  }

  return {
    links: links.map((l) => ({ id: l.id, token: l.token, productKey: l.productKey, label: l.label, isActive: l.isActive, clickCount: l.clickCount })),
    pipelineByStatus,
    commission: { accrued: accruedTotal, paid: paidTotal, pending: Math.max(0, accruedTotal - paidTotal) },
    recentReferrals: referrals.map((r) => ({ id: r.id, productKey: r.productKey, status: r.status, clickedAt: r.clickedAt, paidAt: r.paidAt })),
  }
}

// ─── Owner-only /sales-hq aggregate view ─────────────────────────────────
export async function getPlatformSalesOverview(ctx: AdminCtx) {
  requireAdmin(ctx)
  const [partners, referrals, accruals, plans] = await Promise.all([
    db.query.salesPartners.findMany({ orderBy: (t, { desc: d }) => d(t.createdAt) }),
    db.query.salesReferrals.findMany(),
    db.query.salesCommissionAccruals.findMany(),
    db.query.salesCommissionPlans.findMany(),
  ])

  const referralsByStatus: Record<string, number> = {}
  for (const r of referrals) referralsByStatus[r.status] = (referralsByStatus[r.status] ?? 0) + 1

  const latestByReferral = new Map<string, typeof accruals[number]>()
  for (const a of accruals) {
    const existing = latestByReferral.get(a.salesReferralId)
    if (!existing || a.createdAt > existing.createdAt) latestByReferral.set(a.salesReferralId, a)
  }
  const liabilityByProduct: Record<string, { accrued: number; paid: number }> = {}
  for (const a of latestByReferral.values()) {
    liabilityByProduct[a.productKey] ??= { accrued: 0, paid: 0 }
    if (a.status === "accrued") liabilityByProduct[a.productKey].accrued += Number(a.amount)
    if (a.status === "paid") liabilityByProduct[a.productKey].paid += Number(a.amount)
  }

  return { partners, referralsByStatus, liabilityByProduct, plans }
}

// Resolve an org's current plan -- used by the /sales-hq admin action that
// records a plan change (see markReferralPaidIfApplicable's own caller).
export async function getOrgPlan(orgId: string) {
  const org = await db.query.organisations.findFirst({ where: eq(organisations.id, orgId) })
  return org?.plan ?? null
}
