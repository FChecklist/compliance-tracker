// Priority 15 (PROJEXA GRC depth, Wave 1): service-layer extraction for the
// Risk Register / Audit Management / Policy Library / Vendor Risk surfaces.
// Behavior-identical refactor of src/app/api/{risks,audit-engagements,
// audit-findings,audit-findings/[id],policies,policies/[id],vendor-risk}/
// route.ts's own inline query logic -- these five areas had schema (Wave 21
// risk severity matrix, Wave "Audit — Controls & Framework Library, risk-
// based Audit Management") and working session routes, but (unlike
// compliance-service.ts's own Wave 11 extraction) no shared service
// function a second surface (PROJEXA's /api/v1/projexa/*) could call. This
// mirrors Wave 11's own precedent exactly: lift the logic verbatim into a
// service, then have the original routes call it too, so there is exactly
// one implementation, not two.
import { risks, auditEngagements, auditFindings, policies, approvalRequests, vendorRiskProfiles, users } from "@/lib/db"
import { withTenantContext } from "@/lib/db/tenant-scoped"
import { and, eq, inArray } from "drizzle-orm"
import { ServiceError } from "./compliance-service"
export { ServiceError }
import { logActivity } from "@/lib/audit"
import { resolveModuleRule } from "@/lib/module-rules-resolver"

export type GrcActorCtx = { orgId: string; userId: string } & ({ dbUser: typeof users.$inferSelect; apiKey?: never } | { dbUser?: never; apiKey: { id: string; name: string } })

function actorLogFields(ctx: GrcActorCtx) {
  return ctx.dbUser ? { dbUser: ctx.dbUser } : { apiKey: ctx.apiKey! }
}

// ============================================================
// Risk Register
// ============================================================

// manager rank and above see every risk in the org; below that, only risks
// owned by their own department -- approximates the original mockup's Scope
// axis using this app's existing role ranks rather than a whole separate
// column (verbatim from risks/route.ts).
const BROAD_SCOPE_ROLES = ["admin", "veridian_admin", "branch_manager", "senior_professional", "manager"]

type SeverityBand = { min: number; max: number; label: string }
const DEFAULT_SEVERITY_BANDS: SeverityBand[] = [
  { min: 1, max: 6, label: "low" }, { min: 7, max: 15, label: "medium" }, { min: 16, max: 25, label: "high" },
]

function severityFromScore(score: number, bands: SeverityBand[]): string {
  const match = bands.find((b) => score >= b.min && score <= b.max)
  return match?.label ?? "medium"
}

export async function listRisks(ctx: { orgId: string; dbUser?: typeof users.$inferSelect | null }) {
  const [rows, resolvedMatrix] = await Promise.all([
    withTenantContext({ orgId: ctx.orgId }, (db) => db.query.risks.findMany({ where: eq(risks.orgId, ctx.orgId), orderBy: (t, { desc }) => desc(t.updatedAt) })),
    resolveModuleRule("risks", "severity_matrix", { orgId: ctx.orgId }),
  ])
  const bands = (resolvedMatrix?.value as { bands?: SeverityBand[] } | undefined)?.bands ?? DEFAULT_SEVERITY_BANDS
  // A Bearer-key caller (ctx.dbUser undefined) has no personal role/department
  // to scope by -- treat it the same as a broad-scope role (an API key is
  // already an org-level credential, not a personal one) rather than
  // silently hiding data behind a scope rule that doesn't apply to it.
  const visible = !ctx.dbUser || BROAD_SCOPE_ROLES.includes(ctx.dbUser.role)
    ? rows
    : rows.filter((r) => r.ownerDept === ctx.dbUser!.departmentId || r.ownerId === ctx.dbUser!.id)

  return {
    risks: visible.map((r) => ({
      id: r.id, title: r.title, category: r.category, likelihood: r.likelihood, impact: r.impact,
      severity: severityFromScore(r.likelihood * r.impact, bands),
      status: r.status, ownerId: r.ownerId, ownerDept: r.ownerDept, linkedControlIds: r.linkedControlIds,
      updatedAt: r.updatedAt.toISOString(),
    })),
    totalCount: rows.length,
    hiddenByScope: rows.length - visible.length,
  }
}

export type RiskInput = { title: string; category?: string; likelihood?: number; impact?: number }

export async function createRisk(ctx: GrcActorCtx, input: RiskInput) {
  if (!input.title?.trim()) throw new ServiceError("title is required", 400)
  return withTenantContext({ orgId: ctx.orgId, userId: ctx.userId }, async (db) => {
    const [risk] = await db.insert(risks).values({
      title: input.title.trim(), category: (input.category as typeof risks.$inferInsert.category) || "operational",
      likelihood: input.likelihood ? Number(input.likelihood) : 3, impact: input.impact ? Number(input.impact) : 3,
      ownerId: ctx.dbUser?.id ?? null, ownerDept: ctx.dbUser?.departmentId ?? null, orgId: ctx.orgId,
    }).returning()
    await logActivity({ tx: db, action: "create", entityType: "Risk", entityId: risk.id, details: `Risk logged: ${risk.title}`, orgId: ctx.orgId, ...actorLogFields(ctx) })
    return risk
  })
}

const VALID_RISK_STATUSES = ["open", "mitigating", "closed"] as const

/** Priority 15 addition -- risks/route.ts had list+create only, no status transition at all. Mirrors audit-findings' own CAPA-status-cycle precedent below. */
export async function updateRiskStatus(ctx: GrcActorCtx, riskId: string, status: (typeof VALID_RISK_STATUSES)[number]) {
  if (!VALID_RISK_STATUSES.includes(status)) throw new ServiceError(`status must be one of: ${VALID_RISK_STATUSES.join(", ")}`, 400)
  return withTenantContext({ orgId: ctx.orgId, userId: ctx.userId }, async (db) => {
    const existing = await db.query.risks.findFirst({ where: and(eq(risks.id, riskId), eq(risks.orgId, ctx.orgId)) })
    if (!existing) throw new ServiceError("Risk not found", 404)
    const [updated] = await db.update(risks).set({ status, updatedAt: new Date() }).where(eq(risks.id, riskId)).returning()
    await logActivity({ tx: db, action: "status_change", entityType: "Risk", entityId: riskId, details: `Risk "${existing.title}" moved from ${existing.status} to ${status}`, orgId: ctx.orgId, ...actorLogFields(ctx) })
    return updated
  })
}

// ============================================================
// Audit Management (risk-based audit engagements + findings/CAPA)
// ============================================================

export async function listAuditEngagements(ctx: { orgId: string }) {
  const rows = await withTenantContext({ orgId: ctx.orgId }, (db) =>
    db.query.auditEngagements.findMany({ where: eq(auditEngagements.orgId, ctx.orgId), orderBy: (t, { desc }) => desc(t.createdAt), with: { findings: true } })
  )
  return rows.map((e) => ({
    id: e.id, name: e.name, auditType: e.auditType, status: e.status, coversRiskIds: e.coversRiskIds,
    findings: e.findings.map((f) => ({
      id: f.id, title: f.title, severity: f.severity, capaStatus: f.capaStatus,
      ownerId: f.ownerId, dueDate: f.dueDate?.toISOString() ?? null, retestResult: f.retestResult,
    })),
  }))
}

export async function createAuditEngagement(ctx: GrcActorCtx, input: { name: string; auditType?: string; coversRiskIds?: string[] }) {
  if (!input.name?.trim()) throw new ServiceError("name is required", 400)
  return withTenantContext({ orgId: ctx.orgId, userId: ctx.userId }, async (db) => {
    const [engagement] = await db.insert(auditEngagements).values({
      name: input.name.trim(), auditType: input.auditType || "internal", coversRiskIds: input.coversRiskIds ?? [], orgId: ctx.orgId,
    }).returning()
    await logActivity({ tx: db, action: "create", entityType: "AuditEngagement", entityId: engagement.id, details: `Audit planned: ${engagement.name}`, orgId: ctx.orgId, ...actorLogFields(ctx) })
    return engagement
  })
}

export async function createAuditFinding(ctx: GrcActorCtx, input: { auditEngagementId: string; title: string; severity?: string; dueDate?: string; linkedRiskId?: string }) {
  if (!input.auditEngagementId || !input.title?.trim()) throw new ServiceError("auditEngagementId and title are required", 400)
  return withTenantContext({ orgId: ctx.orgId, userId: ctx.userId }, async (db) => {
    const engagement = await db.query.auditEngagements.findFirst({ where: and(eq(auditEngagements.id, input.auditEngagementId), eq(auditEngagements.orgId, ctx.orgId)) })
    if (!engagement) throw new ServiceError("Audit engagement not found", 404)
    const [finding] = await db.insert(auditFindings).values({
      auditEngagementId: input.auditEngagementId, title: input.title.trim(), severity: input.severity || "medium",
      dueDate: input.dueDate ? new Date(input.dueDate) : null, linkedRiskId: input.linkedRiskId, orgId: ctx.orgId,
    }).returning()
    await logActivity({ tx: db, action: "create", entityType: "AuditFinding", entityId: finding.id, details: `Finding recorded on "${engagement.name}": ${finding.title}`, orgId: ctx.orgId, ...actorLogFields(ctx) })
    return finding
  })
}

const CAPA_STATUSES = ["open", "in_progress", "closed"]

/** Advances a finding's remediation (CAPA) status one step forward -- open -> in_progress -> closed, matching audit-findings/[id]/route.ts's own cycle-forward behavior verbatim. */
export async function advanceAuditFindingCapaStatus(ctx: GrcActorCtx, findingId: string) {
  return withTenantContext({ orgId: ctx.orgId, userId: ctx.userId }, async (db) => {
    const existing = await db.query.auditFindings.findFirst({ where: and(eq(auditFindings.id, findingId), eq(auditFindings.orgId, ctx.orgId)) })
    if (!existing) throw new ServiceError("Finding not found", 404)
    const idx = CAPA_STATUSES.indexOf(existing.capaStatus)
    const nextStatus = CAPA_STATUSES[Math.min(idx + 1, CAPA_STATUSES.length - 1)]
    const [updated] = await db.update(auditFindings).set({
      capaStatus: nextStatus as typeof auditFindings.$inferSelect.capaStatus,
      retestResult: nextStatus === "closed" ? "passed" : existing.retestResult,
      updatedAt: new Date(),
    }).where(eq(auditFindings.id, findingId)).returning()
    await logActivity({ tx: db, action: "status_change", entityType: "AuditFinding", entityId: findingId, details: `CAPA for "${existing.title}" moved to ${nextStatus}`, orgId: ctx.orgId, ...actorLogFields(ctx) })
    return updated
  })
}

// ============================================================
// Policy Library (maker-checker publish workflow)
// ============================================================

export async function listPolicies(ctx: { orgId: string }) {
  const rows = await withTenantContext({ orgId: ctx.orgId }, (db) => db.query.policies.findMany({ where: eq(policies.orgId, ctx.orgId), orderBy: (t, { asc }) => asc(t.title) }))
  return rows.map((p) => ({ id: p.id, title: p.title, category: p.category, version: p.version, status: p.status, attestationRate: p.attestationRate, history: p.history }))
}

export async function createPolicy(ctx: GrcActorCtx, input: { title: string; category?: string }) {
  if (!input.title?.trim()) throw new ServiceError("title is required", 400)
  const editorName = ctx.dbUser?.name ?? ctx.apiKey?.name ?? "PROJEXA"
  return withTenantContext({ orgId: ctx.orgId, userId: ctx.userId }, async (db) => {
    const [policy] = await db.insert(policies).values({
      title: input.title.trim(), category: input.category || "governance",
      history: [{ version: "v1.0", date: new Date().toLocaleDateString("en-IN"), editedBy: editorName, note: "Initial draft" }],
      orgId: ctx.orgId, createdById: ctx.userId,
    }).returning()
    await logActivity({ tx: db, action: "create", entityType: "Policy", entityId: policy.id, details: `New policy drafted: ${policy.title}`, orgId: ctx.orgId, ...actorLogFields(ctx) })
    return policy
  })
}

/** action='edit': bumps the minor version and appends to history. action='request_publish': opens a maker-checker approval request rather than publishing directly -- only POST /api/approvals/[id]/decide (VERIDIAN-side) actually flips status to 'published'. Verbatim from policies/[id]/route.ts. */
export async function updatePolicy(ctx: GrcActorCtx, policyId: string, action: "edit" | "request_publish", note?: string) {
  const editorName = ctx.dbUser?.name ?? ctx.apiKey?.name ?? "PROJEXA"
  return withTenantContext({ orgId: ctx.orgId, userId: ctx.userId }, async (db) => {
    const existing = await db.query.policies.findFirst({ where: and(eq(policies.id, policyId), eq(policies.orgId, ctx.orgId)) })
    if (!existing) throw new ServiceError("Policy not found", 404)

    if (action === "edit") {
      const [major, minor] = existing.version.replace("v", "").split(".").map(Number)
      const newVersion = `v${major}.${(minor || 0) + 1}`
      const history = Array.isArray(existing.history) ? existing.history : []
      const [updated] = await db.update(policies).set({
        version: newVersion,
        history: [{ version: newVersion, date: new Date().toLocaleDateString("en-IN"), editedBy: editorName, note: note || "Updated" }, ...history],
        updatedAt: new Date(),
      }).where(eq(policies.id, policyId)).returning()
      await logActivity({ tx: db, action: "update", entityType: "Policy", entityId: policyId, details: `"${existing.title}" updated to ${newVersion}`, orgId: ctx.orgId, ...actorLogFields(ctx) })
      return updated
    }

    // request_publish
    if (existing.status === "published") return existing
    const [approval] = await db.insert(approvalRequests).values({
      requestType: "policy_publish", entityType: "Policy", entityId: policyId,
      description: `${existing.title} (${existing.version})`, requestedById: ctx.userId, orgId: ctx.orgId,
    }).returning()
    await db.update(policies).set({ status: "under_review", updatedAt: new Date() }).where(eq(policies.id, policyId))
    await logActivity({ tx: db, action: "update", entityType: "Policy", entityId: policyId, details: `Publish requested for "${existing.title}" -- approval #${approval.id}`, orgId: ctx.orgId, ...actorLogFields(ctx) })
    return { ...existing, status: "under_review" as const }
  })
}

// ============================================================
// Vendor / Third-Party Risk
// ============================================================

export async function listVendorRiskProfiles(ctx: { orgId: string }) {
  const rows = await withTenantContext({ orgId: ctx.orgId }, (db) => db.query.vendorRiskProfiles.findMany({ where: eq(vendorRiskProfiles.orgId, ctx.orgId), orderBy: (t, { asc }) => asc(t.name) }))
  return rows.map((v) => ({ id: v.id, name: v.name, riskTier: v.riskTier, riskScore: v.riskScore, riskFactors: v.riskFactors, certifications: v.certifications, lastAssessedDate: v.lastAssessedDate?.toISOString() ?? null }))
}

export async function createVendorRiskProfile(ctx: GrcActorCtx, input: { name: string; riskTier?: string }) {
  if (!input.name?.trim()) throw new ServiceError("name is required", 400)
  return withTenantContext({ orgId: ctx.orgId, userId: ctx.userId }, async (db) => {
    const [vendor] = await db.insert(vendorRiskProfiles).values({ name: input.name.trim(), riskTier: input.riskTier || "medium", orgId: ctx.orgId }).returning()
    await logActivity({ tx: db, action: "create", entityType: "VendorRiskProfile", entityId: vendor.id, details: `Vendor added for risk assessment: ${vendor.name}`, orgId: ctx.orgId, ...actorLogFields(ctx) })
    return vendor
  })
}

// ============================================================
// GRC Dashboard rollup -- risk heatmap + audit/policy/fraud status summary
// ============================================================

export async function getGrcDashboard(ctx: { orgId: string }) {
  const [riskData, engagements, policyRows, vendorRows] = await Promise.all([
    listRisks({ orgId: ctx.orgId }),
    listAuditEngagements({ orgId: ctx.orgId }),
    listPolicies({ orgId: ctx.orgId }),
    listVendorRiskProfiles({ orgId: ctx.orgId }),
  ])

  const riskByCategory: Record<string, number> = {}
  const riskBySeverity: Record<string, number> = { low: 0, medium: 0, high: 0 }
  const riskHeatmap: { likelihood: number; impact: number; count: number }[] = []
  const heatmapKey = new Map<string, number>()
  for (const r of riskData.risks) {
    if (r.status === "closed") continue
    riskByCategory[r.category] = (riskByCategory[r.category] ?? 0) + 1
    riskBySeverity[r.severity] = (riskBySeverity[r.severity] ?? 0) + 1
    const key = `${r.likelihood}:${r.impact}`
    heatmapKey.set(key, (heatmapKey.get(key) ?? 0) + 1)
  }
  for (const [key, count] of heatmapKey.entries()) {
    const [likelihood, impact] = key.split(":").map(Number)
    riskHeatmap.push({ likelihood, impact, count })
  }

  const allFindings = engagements.flatMap((e) => e.findings)
  const openFindings = allFindings.filter((f) => f.capaStatus !== "closed")
  const overdueFindings = openFindings.filter((f) => f.dueDate && new Date(f.dueDate).getTime() < Date.now())

  return {
    risks: {
      openCount: riskData.risks.filter((r) => r.status !== "closed").length,
      totalCount: riskData.totalCount,
      byCategory: riskByCategory,
      bySeverity: riskBySeverity,
      heatmap: riskHeatmap,
    },
    audit: {
      engagementCount: engagements.length,
      openFindingsCount: openFindings.length,
      overdueFindingsCount: overdueFindings.length,
    },
    policies: {
      totalCount: policyRows.length,
      draftCount: policyRows.filter((p) => p.status === "draft").length,
      underReviewCount: policyRows.filter((p) => p.status === "under_review").length,
      publishedCount: policyRows.filter((p) => p.status === "published").length,
    },
    vendorRisk: {
      totalCount: vendorRows.length,
      highTierCount: vendorRows.filter((v) => v.riskTier === "high").length,
    },
  }
}
