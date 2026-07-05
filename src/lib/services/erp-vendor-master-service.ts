// Wave 80 (Vendor Master enhancements, COMPARISON_CSV_GAP_ANALYSIS.md
// backlog #1): banking details, qualification workflow, sanction/blacklist
// screening, and a self-service vendor portal. KYC document tracking
// deliberately has no functions here -- it's the existing generic
// document-service.ts (linkedEntityType='erp_supplier') + POST /api/documents,
// which already works with zero new code.
import { erpSuppliers, erpSupplierBankAccounts, erpSupplierQualifications, erpSupplierSanctionChecks, erpSupplierPortalLinks, documents, db } from "@/lib/db"
import { withTenantContext } from "@/lib/db/tenant-scoped"
import { eq, and, desc } from "drizzle-orm"
import { createId } from "@paralleldrive/cuid2"
import { encryptApiKey } from "@/lib/ai-config-crypto"
import { ServiceError } from "./compliance-service"
export { ServiceError }

export type VendorMasterContext = { orgId: string; userId: string }

function maskBankAccount(row: typeof erpSupplierBankAccounts.$inferSelect) {
  const { accountNumberEncrypted: _omit, ...rest } = row
  return { ...rest, accountNumberMasked: `••••${row.accountNumberLast4}` }
}

// ─── Banking details ──────────────────────────────────────────────────────
export async function addBankAccount(
  ctx: VendorMasterContext,
  supplierId: string,
  input: { accountHolderName: string; bankName: string; accountNumber: string; ifscCode?: string; accountType?: string; isPrimary?: boolean }
) {
  const accountNumber = input.accountNumber?.trim()
  if (!accountNumber || accountNumber.length < 4) throw new ServiceError("A valid account number is required", 400)

  const accountNumberEncrypted = await encryptApiKey(accountNumber)
  const accountNumberLast4 = accountNumber.slice(-4)

  return withTenantContext({ orgId: ctx.orgId, userId: ctx.userId }, async (db) => {
    const supplier = await db.query.erpSuppliers.findFirst({ where: and(eq(erpSuppliers.id, supplierId), eq(erpSuppliers.orgId, ctx.orgId)) })
    if (!supplier) throw new ServiceError("Supplier not found", 404)

    if (input.isPrimary) {
      await db.update(erpSupplierBankAccounts).set({ isPrimary: false }).where(eq(erpSupplierBankAccounts.supplierId, supplierId))
    }

    const [account] = await db.insert(erpSupplierBankAccounts).values({
      orgId: ctx.orgId, supplierId,
      accountHolderName: input.accountHolderName.trim(), bankName: input.bankName.trim(),
      accountNumberEncrypted, accountNumberLast4,
      ifscCode: input.ifscCode?.trim() || null, accountType: input.accountType || "savings",
      isPrimary: input.isPrimary ?? false, createdById: ctx.userId,
    }).returning()
    return maskBankAccount(account)
  })
}

export async function listBankAccounts(ctx: { orgId: string }, supplierId: string) {
  return withTenantContext({ orgId: ctx.orgId }, async (db) => {
    const rows = await db.query.erpSupplierBankAccounts.findMany({
      where: and(eq(erpSupplierBankAccounts.supplierId, supplierId), eq(erpSupplierBankAccounts.orgId, ctx.orgId)),
      orderBy: desc(erpSupplierBankAccounts.createdAt),
    })
    return rows.map(maskBankAccount)
  })
}

// ─── Qualification workflow ───────────────────────────────────────────────
export async function recordQualificationReview(
  ctx: VendorMasterContext,
  supplierId: string,
  input: { status: "in_review" | "qualified" | "rejected"; criteria?: Record<string, unknown>; score?: number; notes?: string }
) {
  return withTenantContext({ orgId: ctx.orgId, userId: ctx.userId }, async (db) => {
    const supplier = await db.query.erpSuppliers.findFirst({ where: and(eq(erpSuppliers.id, supplierId), eq(erpSuppliers.orgId, ctx.orgId)) })
    if (!supplier) throw new ServiceError("Supplier not found", 404)

    const [review] = await db.insert(erpSupplierQualifications).values({
      orgId: ctx.orgId, supplierId, status: input.status,
      criteria: input.criteria ?? {}, score: input.score != null ? String(input.score) : null,
      notes: input.notes ?? null, reviewedById: ctx.userId,
    }).returning()

    await db.update(erpSuppliers).set({ qualificationStatus: input.status }).where(eq(erpSuppliers.id, supplierId))
    return review
  })
}

export async function listQualificationReviews(ctx: { orgId: string }, supplierId: string) {
  return withTenantContext({ orgId: ctx.orgId }, (db) =>
    db.query.erpSupplierQualifications.findMany({
      where: and(eq(erpSupplierQualifications.supplierId, supplierId), eq(erpSupplierQualifications.orgId, ctx.orgId)),
      orderBy: desc(erpSupplierQualifications.createdAt),
    })
  )
}

// ─── Sanction / blacklist screening ────────────────────────────────────────
// A human records the outcome of a check performed against an external list
// (UN/OFAC/RBI caution list/etc) -- no live sanctions-API integration exists
// in this environment (no API key), so this is a real screening-log data
// model and workflow, not an automated live check.
export async function recordSanctionCheck(
  ctx: VendorMasterContext,
  supplierId: string,
  input: { listsChecked: string[]; matchFound: boolean; matchDetails?: string; resultStatus: "clear" | "flagged" | "blocked" }
) {
  return withTenantContext({ orgId: ctx.orgId, userId: ctx.userId }, async (db) => {
    const supplier = await db.query.erpSuppliers.findFirst({ where: and(eq(erpSuppliers.id, supplierId), eq(erpSuppliers.orgId, ctx.orgId)) })
    if (!supplier) throw new ServiceError("Supplier not found", 404)

    const [check] = await db.insert(erpSupplierSanctionChecks).values({
      orgId: ctx.orgId, supplierId, checkedById: ctx.userId,
      listsChecked: input.listsChecked, matchFound: input.matchFound,
      matchDetails: input.matchDetails ?? null, resultStatus: input.resultStatus,
    }).returning()

    await db.update(erpSuppliers).set({ sanctionScreeningStatus: input.resultStatus, sanctionScreenedAt: new Date() }).where(eq(erpSuppliers.id, supplierId))
    return check
  })
}

export async function listSanctionChecks(ctx: { orgId: string }, supplierId: string) {
  return withTenantContext({ orgId: ctx.orgId }, (db) =>
    db.query.erpSupplierSanctionChecks.findMany({
      where: and(eq(erpSupplierSanctionChecks.supplierId, supplierId), eq(erpSupplierSanctionChecks.orgId, ctx.orgId)),
      orderBy: desc(erpSupplierSanctionChecks.createdAt),
    })
  )
}

// ─── Vendor self-service portal ────────────────────────────────────────────
// Tokenized, time-limited, individually revocable -- identical shape to
// conversationShareLinks (Wave 36).
export async function createPortalLink(ctx: VendorMasterContext, supplierId: string, expiresInHours = 720) {
  return withTenantContext({ orgId: ctx.orgId, userId: ctx.userId }, async (db) => {
    const supplier = await db.query.erpSuppliers.findFirst({ where: and(eq(erpSuppliers.id, supplierId), eq(erpSuppliers.orgId, ctx.orgId)) })
    if (!supplier) throw new ServiceError("Supplier not found", 404)

    const expiresAt = new Date(Date.now() + expiresInHours * 60 * 60 * 1000)
    const [link] = await db.insert(erpSupplierPortalLinks).values({
      orgId: ctx.orgId, supplierId, token: createId(), createdById: ctx.userId, expiresAt,
    }).returning()
    return link
  })
}

export async function listPortalLinks(ctx: { orgId: string }, supplierId: string) {
  return withTenantContext({ orgId: ctx.orgId }, (db) =>
    db.query.erpSupplierPortalLinks.findMany({
      where: and(eq(erpSupplierPortalLinks.supplierId, supplierId), eq(erpSupplierPortalLinks.orgId, ctx.orgId)),
      orderBy: desc(erpSupplierPortalLinks.createdAt),
    })
  )
}

export async function revokePortalLink(ctx: { orgId: string }, linkId: string) {
  return withTenantContext({ orgId: ctx.orgId }, async (db) => {
    const link = await db.query.erpSupplierPortalLinks.findFirst({ where: and(eq(erpSupplierPortalLinks.id, linkId), eq(erpSupplierPortalLinks.orgId, ctx.orgId)) })
    if (!link) throw new ServiceError("Portal link not found", 404)
    const [updated] = await db.update(erpSupplierPortalLinks).set({ revokedAt: new Date() }).where(eq(erpSupplierPortalLinks.id, linkId)).returning()
    return updated
  })
}

function assertValidToken(link: typeof erpSupplierPortalLinks.$inferSelect | undefined) {
  if (!link || link.revokedAt || link.expiresAt < new Date()) {
    throw new ServiceError("This vendor portal link is invalid or has expired", 404)
  }
}

// Public route (no auth) -- resolves a token to the vendor's own read-only
// view of their master data. Uses the raw `db` export (the `postgres` role,
// bypassing RLS) since there's no session/org context to run
// withTenantContext against -- the same legitimate, pre-existing pattern
// getSharedConversation() (Wave 36) already uses.
export async function getSupplierPortalData(token: string) {
  const link = await db.query.erpSupplierPortalLinks.findFirst({ where: eq(erpSupplierPortalLinks.token, token) })
  assertValidToken(link)

  const supplier = await db.query.erpSuppliers.findFirst({ where: eq(erpSuppliers.id, link!.supplierId) })
  if (!supplier) throw new ServiceError("This vendor portal link is invalid or has expired", 404)

  const [bankAccounts, kycDocuments] = await Promise.all([
    db.query.erpSupplierBankAccounts.findMany({ where: eq(erpSupplierBankAccounts.supplierId, supplier.id), orderBy: (t, { desc }) => desc(t.createdAt) }),
    db.query.documents.findMany({
      where: and(eq(documents.linkedEntityType, "erp_supplier"), eq(documents.linkedEntityId, supplier.id), eq(documents.isLatestVersion, true)),
      orderBy: (t, { desc }) => desc(t.createdAt),
    }),
  ])

  return {
    supplierName: supplier.supplierName,
    qualificationStatus: supplier.qualificationStatus,
    sanctionScreeningStatus: supplier.sanctionScreeningStatus,
    bankAccounts: bankAccounts.map(maskBankAccount),
    kycDocuments: kycDocuments.map((d) => ({ id: d.id, name: d.name, category: d.category, expiryDate: d.expiryDate, createdAt: d.createdAt })),
  }
}

// Vendor self-service submission of their own new bank account, through the
// portal token -- no auth session, same RLS-bypass posture as the read path
// above. isPrimary is never accepted here: a vendor self-submitting a
// "primary" designation with no human review would silently redirect real
// payments, so a submitted account always lands as non-primary pending an
// internal user promoting it via the authenticated addBankAccount path.
export async function submitBankAccountViaPortal(
  token: string,
  input: { accountHolderName: string; bankName: string; accountNumber: string; ifscCode?: string; accountType?: string }
) {
  const link = await db.query.erpSupplierPortalLinks.findFirst({ where: eq(erpSupplierPortalLinks.token, token) })
  assertValidToken(link)

  const accountNumber = input.accountNumber?.trim()
  if (!accountNumber || accountNumber.length < 4) throw new ServiceError("A valid account number is required", 400)
  if (!input.accountHolderName?.trim() || !input.bankName?.trim()) throw new ServiceError("Account holder name and bank name are required", 400)

  const accountNumberEncrypted = await encryptApiKey(accountNumber)
  const [account] = await db.insert(erpSupplierBankAccounts).values({
    orgId: link!.orgId, supplierId: link!.supplierId,
    accountHolderName: input.accountHolderName.trim(), bankName: input.bankName.trim(),
    accountNumberEncrypted, accountNumberLast4: accountNumber.slice(-4),
    ifscCode: input.ifscCode?.trim() || null, accountType: input.accountType || "savings",
    isPrimary: false,
  }).returning()
  return maskBankAccount(account)
}
