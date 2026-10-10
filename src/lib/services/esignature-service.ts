// Wave 86 (Comparison CSV 2 gap analysis: CLM007 "Electronic Contract
// Signing" + DMS012 "Digital Signature Management"). Neither `documents`
// nor `erp_contracts` had any signing capability before this wave. No paid
// e-signature provider integration exists in this environment -- this is a
// real, first-party signing workflow: a tamper-evident audit trail
// (signer identity, IP, user agent, timestamp, and a document-hash
// comparison) rather than a DocuSign/Documenso API wrapper.
import { esignatureRequests, esignatureSigners, documents, erpContracts, constructionChangeOrders, users, db as rawDb } from "@/lib/db"
import { withTenantContext } from "@/lib/db/tenant-scoped"
import { and, eq, inArray, sql } from "drizzle-orm"
import { ServiceError } from "./compliance-service"
export { ServiceError }
import { createId } from "@paralleldrive/cuid2"
import { createHash } from "crypto"
import { createClient } from "@supabase/supabase-js"
import { ErpContext } from "./actor-context"


// A projection of an esignature_signers row carrying only the fields the
// transition logic below needs to see. Kept as a structural type (not the
// full Drizzle row type) so the pure helpers are unit-testable without a
// database -- tests build these by hand the same way
// erp-fixed-assets-service.test.ts exercises generateDepreciationSchedule.
export type SignerProjection = {
  status: string // 'pending' | 'signed' | 'declined' (see esignature_signers.status in schema.ts)
  signOrder: number | null // null = parallel signing, no ordering enforced
}

export type SignatureRequestStatus =
  | "pending"
  | "partially_signed"
  | "completed"
  | "declined"
  | "voided"

/**
 * Pure decision: given the full set of signers as they stand *after* one
 * signer just signed, what (if anything) should the parent
 * esignature_requests.status move to?
 *
 * - everyone signed  -> "completed"
 * - at least one (but not all) signed -> "partially_signed"
 * - nobody signed yet -> null (caller keeps request.status unchanged)
 *
 * Extracted verbatim from the branch that used to live inline at the bottom
 * of submitSignature(); the caller maps null -> "leave it alone" exactly as
 * the original `allSigned ? "completed" : anySigned ? "partially_signed" :
 * request.status` ternary did. Pure (no I/O, no Date.now) so it can be
 * unit-tested the same way generateDepreciationSchedule already is.
 */
export function computeSignatureRequestStatusAfterSign(
  signers: SignerProjection[]
): "completed" | "partially_signed" | null {
  if (signers.length === 0) return null
  const allSigned = signers.every((s) => s.status === "signed")
  if (allSigned) return "completed"
  const anySigned = signers.some((s) => s.status === "signed")
  return anySigned ? "partially_signed" : null
}

/**
 * Pure decision: when a signer event (sign or decline) lands on an
 * e-signature request whose linked entity is a construction change order,
 * should the change order itself transition, and to what?
 *
 * - a *sign* that completes the request (allSigned) approves the change order
 * - a *decline* by any signer rejects the change order immediately
 * - any other event (partial sign, or a sign/decline against a non-change_order
 *   linked entity like 'document' or 'erp_contract') returns null -- no
 *   transition. document/erp_contract have no status field to move.
 *
 * `now` is passed in (rather than read via new Date()) purely so this stays
 * deterministic and testable; the live caller passes `new Date()`. The
 * returned approvedAt mirrors the inline code path it replaces (set only on
 * approval, never on rejection -- matching markChangeOrderRejected()'s own
 * field set). Pure otherwise.
 */
export function changeOrderTransitionAfter(
  event: "sign" | "decline",
  linkedEntityType: string,
  signers: SignerProjection[],
  now: Date
): { status: "approved" | "rejected"; approvedAt?: Date } | null {
  if (linkedEntityType !== "change_order") return null
  if (event === "sign") {
    // Only an all-signed completion approves -- a partial sign leaves the
    // change order at "pending_approval" (matches the allSigned guard in
    // submitSignature's change_order branch).
    if (signers.length > 0 && signers.every((s) => s.status === "signed")) {
      return { status: "approved", approvedAt: now }
    }
    return null
  }
  // event === "decline": any decline rejects immediately, regardless of how
  // many others had already signed (matches declineSignature's unconditional
  // change_order branch -- it doesn't check allSigned/anySigned).
  return { status: "rejected" }
}

const BUCKET = "compliance-documents"
const TOKEN_VALIDITY_DAYS = 30

function getStorageAdminClient() {
  return createClient(process.env.NEXT_PUBLIC_SUPABASE_URL!, process.env.SUPABASE_SERVICE_ROLE_KEY!)
}

/**
 * For 'document': SHA-256 of the actual file bytes in the private storage
 * bucket. For 'erp_contract' (a DB record, not a file): SHA-256 of a
 * canonical JSON snapshot of its key terms -- either way, this baseline is
 * compared against each signer's own hash-at-signing-time to detect
 * tampering between when a request was created and when it was signed.
 */
async function computeDocumentHash(orgId: string, linkedEntityType: string, linkedEntityId: string): Promise<string> {
  if (linkedEntityType === "document") {
    const doc = await withTenantContext({ orgId }, (db) =>
      db.query.documents.findFirst({ where: and(eq(documents.id, linkedEntityId), eq(documents.orgId, orgId)) })
    )
    if (!doc) throw new ServiceError("Document not found", 404)
    const admin = getStorageAdminClient()
    const { data, error } = await admin.storage.from(BUCKET).download(doc.fileUrl)
    if (error || !data) throw new ServiceError("Failed to read document contents for hashing", 500)
    const bytes = Buffer.from(await data.arrayBuffer())
    return createHash("sha256").update(bytes).digest("hex")
  }

  if (linkedEntityType === "erp_contract") {
    const contract = await withTenantContext({ orgId }, (db) =>
      db.query.erpContracts.findFirst({ where: and(eq(erpContracts.id, linkedEntityId), eq(erpContracts.orgId, orgId)) })
    )
    if (!contract) throw new ServiceError("Contract not found", 404)
    const canonical = JSON.stringify({
      title: contract.title, contractType: contract.contractType, startDate: contract.startDate, endDate: contract.endDate,
      contractValue: contract.contractValue, currencyId: contract.currencyId, status: contract.status,
    })
    return createHash("sha256").update(canonical).digest("hex")
  }

  // Wave 141 (PROJEXA gap analysis: Change Orders): same canonical-JSON-
  // snapshot approach as erp_contract above -- a Change Order is a DB
  // record, not a file, so there's no bytes to hash directly.
  if (linkedEntityType === "change_order") {
    const changeOrder = await withTenantContext({ orgId }, (db) =>
      db.query.constructionChangeOrders.findFirst({ where: and(eq(constructionChangeOrders.id, linkedEntityId), eq(constructionChangeOrders.orgId, orgId)) })
    )
    if (!changeOrder) throw new ServiceError("Change order not found", 404)
    const canonical = JSON.stringify({
      title: changeOrder.title, description: changeOrder.description, reason: changeOrder.reason,
      costImpact: changeOrder.costImpact, scheduleImpactDays: changeOrder.scheduleImpactDays, status: changeOrder.status,
    })
    return createHash("sha256").update(canonical).digest("hex")
  }

  throw new ServiceError("Unsupported linkedEntityType for e-signature", 400)
}

export async function createSignatureRequest(
  ctx: ErpContext,
  input: { linkedEntityType: "document" | "erp_contract" | "change_order"; linkedEntityId: string; title: string; signers: { name: string; email: string; order?: number }[] }
) {
  if (!input.signers?.length) throw new ServiceError("At least one signer is required", 400)

  const documentHash = await computeDocumentHash(ctx.orgId, input.linkedEntityType, input.linkedEntityId)

  return withTenantContext({ orgId: ctx.orgId, userId: ctx.userId }, async (db) => {
    const [request] = await db.insert(esignatureRequests).values({
      orgId: ctx.orgId, linkedEntityType: input.linkedEntityType, linkedEntityId: input.linkedEntityId,
      title: input.title, documentHash, createdById: ctx.userId,
    }).returning()

    const tokenExpiresAt = new Date(Date.now() + TOKEN_VALIDITY_DAYS * 24 * 60 * 60 * 1000)
    await db.insert(esignatureSigners).values(
      input.signers.map((s) => ({
        orgId: ctx.orgId, requestId: request.id, name: s.name, email: s.email, signOrder: s.order,
        accessToken: `esig_${createId()}`, tokenExpiresAt,
      }))
    )

    return request
  })
}

export async function listSignatureRequests(ctx: { orgId: string }, filters: { linkedEntityType?: string; linkedEntityId?: string } = {}) {
  return withTenantContext({ orgId: ctx.orgId }, (db) => {
    const conditions = [eq(esignatureRequests.orgId, ctx.orgId)]
    if (filters.linkedEntityType) conditions.push(eq(esignatureRequests.linkedEntityType, filters.linkedEntityType))
    if (filters.linkedEntityId) conditions.push(eq(esignatureRequests.linkedEntityId, filters.linkedEntityId))
    return db.query.esignatureRequests.findMany({
      where: and(...conditions),
      orderBy: (t, { desc }) => desc(t.createdAt),
      with: { signers: true },
    })
  })
}

// R66 code-quality fix: an additive batched sibling to listSignatureRequests
// above, NOT a replacement -- that function's single-linkedEntityId
// signature is used elsewhere (e.g. the v1/projexa/change-orders/[id]/
// signature-status alias route) and changing its contract to accept an
// array risks breaking those callers with no way to verify locally in this
// pass. This exists so a caller with many entity IDs (e.g.
// veri-chat/approvals/route.ts's change-order aggregation) can fetch all of
// them in one query instead of one query per ID. Returns only the latest
// (first, since ordered desc) request per linkedEntityId, matching how
// listSignatureRequests(...)[0] was already being used at every N+1 call
// site this was introduced to fix.
export async function listLatestSignatureRequestsForEntities(
  ctx: { orgId: string },
  filters: { linkedEntityType: string; linkedEntityIds: string[] }
) {
  if (filters.linkedEntityIds.length === 0) return new Map<string, Awaited<ReturnType<typeof listSignatureRequests>>[number]>()
  return withTenantContext({ orgId: ctx.orgId }, async (db) => {
    const rows = await db.query.esignatureRequests.findMany({
      where: and(
        eq(esignatureRequests.orgId, ctx.orgId),
        eq(esignatureRequests.linkedEntityType, filters.linkedEntityType),
        inArray(esignatureRequests.linkedEntityId, filters.linkedEntityIds)
      ),
      orderBy: (t, { desc }) => desc(t.createdAt),
      with: { signers: true },
    })
    const latestByEntityId = new Map<string, (typeof rows)[number]>()
    for (const row of rows) {
      if (!row.linkedEntityId) continue
      if (!latestByEntityId.has(row.linkedEntityId)) latestByEntityId.set(row.linkedEntityId, row)
    }
    return latestByEntityId
  })
}

export async function getSignatureRequest(ctx: { orgId: string }, requestId: string) {
  return withTenantContext({ orgId: ctx.orgId }, async (db) => {
    const request = await db.query.esignatureRequests.findFirst({
      where: and(eq(esignatureRequests.id, requestId), eq(esignatureRequests.orgId, ctx.orgId)),
      with: { signers: true },
    })
    if (!request) throw new ServiceError("Signature request not found", 404)
    return request
  })
}

export async function voidSignatureRequest(ctx: { orgId: string }, requestId: string) {
  return withTenantContext({ orgId: ctx.orgId }, async (db) => {
    const request = await db.query.esignatureRequests.findFirst({ where: and(eq(esignatureRequests.id, requestId), eq(esignatureRequests.orgId, ctx.orgId)) })
    if (!request) throw new ServiceError("Signature request not found", 404)
    if (request.status === "completed") throw new ServiceError("A completed signature request cannot be voided", 409)
    const [updated] = await db.update(esignatureRequests).set({ status: "voided" }).where(eq(esignatureRequests.id, requestId)).returning()
    return updated
  })
}

// ============================================================
// Public (no auth) -- tokenized signer access, same RLS-bypass rationale as
// getSupplierPortalData()/getGuestConversation() elsewhere in this codebase.
// ============================================================

// D3 (2026-10-10): the old lookup read esignature_signers through the shared db handle, which only finds a row when the connecting role bypasses RLS
// (postgres does, app_runtime does not -> a valid link answered 404). The token -> (signer, org) mapping now goes through ONE narrow SECURITY DEFINER
// function (drizzle/0745), and every other read/write runs inside withTenantContext({ orgId }), so RLS stays on. The raw fallback below only fires when the
// function is not installed yet (Postgres 42883), so the code can be deployed before the migration is applied.
type ResolvedSigner = { signer: typeof esignatureSigners.$inferSelect; orgId: string }

async function lookupSignerOrg(token: string): Promise<{ signerId: string; orgId: string } | null> {
  try {
    const rows = (await rawDb.execute(sql`SELECT signer_id, org_id FROM compliance.esign_resolve_signer(${token})`)) as unknown as Array<{ signer_id: string; org_id: string }>
    const row = rows[0]
    return row ? { signerId: row.signer_id, orgId: row.org_id } : null
  } catch (err) {
    const e = err as { code?: string; cause?: { code?: string } }
    if ((e?.code ?? e?.cause?.code) !== "42883") throw err
    const signer = await rawDb.query.esignatureSigners.findFirst({ where: eq(esignatureSigners.accessToken, token) })
    return signer ? { signerId: signer.id, orgId: signer.orgId } : null
  }
}

export async function resolveSignerFromToken(token: string): Promise<ResolvedSigner> {
  const hit = await lookupSignerOrg(token)
  if (!hit) throw new ServiceError("This signing link is invalid", 404)
  const signer = await withTenantContext({ orgId: hit.orgId }, (db) => db.query.esignatureSigners.findFirst({ where: and(eq(esignatureSigners.id, hit.signerId), eq(esignatureSigners.orgId, hit.orgId)) }))
  if (!signer) throw new ServiceError("This signing link is invalid", 404)
  if (signer.tokenExpiresAt < new Date()) throw new ServiceError("This signing link has expired", 410)
  return { signer, orgId: hit.orgId }
}

export async function getSigningSession(token: string) {
  const { signer, orgId } = await resolveSignerFromToken(token)
  return withTenantContext({ orgId }, async (db) => {
    const request = await db.query.esignatureRequests.findFirst({ where: eq(esignatureRequests.id, signer.requestId) })
    if (!request) throw new ServiceError("Signature request not found", 404)
    if (request.status === "voided") throw new ServiceError("This signature request has been voided", 409)

    const allSigners = await db.query.esignatureSigners.findMany({ where: eq(esignatureSigners.requestId, request.id) })
    const isMyTurn = signer.signOrder == null || !allSigners.some((s) => (s.signOrder ?? Infinity) < signer.signOrder! && s.status === "pending")

    return {
      requestTitle: request.title, requestStatus: request.status,
      signerName: signer.name, signerStatus: signer.status, signerId: signer.id,
      isMyTurn,
    }
  })
}

export async function submitSignature(token: string, input: { signatureImageData: string; signatureMethod: "drawn" | "typed"; ipAddress?: string; userAgent?: string }) {
  const { signer, orgId } = await resolveSignerFromToken(token)
  if (signer.status !== "pending") throw new ServiceError("This signature has already been recorded", 409)

  // Read phase. computeDocumentHash opens its own tenant transaction, so it must run AFTER this one closes (no nesting).
  const request = await withTenantContext({ orgId }, async (db) => {
    const r = await db.query.esignatureRequests.findFirst({ where: eq(esignatureRequests.id, signer.requestId) })
    if (!r) throw new ServiceError("Signature request not found", 404)
    if (r.status === "voided") throw new ServiceError("This signature request has been voided", 409)
    if (signer.signOrder != null) {
      const allSigners = await db.query.esignatureSigners.findMany({ where: eq(esignatureSigners.requestId, r.id) })
      const outOfTurn = allSigners.some((s) => (s.signOrder ?? Infinity) < signer.signOrder! && s.status === "pending")
      if (outOfTurn) throw new ServiceError("An earlier signer in the sequence has not signed yet", 409)
    }
    return r
  })

  // Recompute the hash right now -- comparing it against the request's baseline documentHash is how a later audit detects whether the underlying
  // document/contract changed between request creation and this signature.
  const documentHashAtSigning = await computeDocumentHash(request.orgId, request.linkedEntityType, request.linkedEntityId)

  // Write phase: one transaction, so the signer row, the request status and the change-order transition land together or not at all.
  return withTenantContext({ orgId }, async (db) => {
    const [updatedSigner] = await db.update(esignatureSigners).set({
      status: "signed", signatureImageData: input.signatureImageData, signatureMethod: input.signatureMethod,
      signedAt: new Date(), ipAddress: input.ipAddress, userAgent: input.userAgent, documentHashAtSigning,
    }).where(eq(esignatureSigners.id, signer.id)).returning()

    const remainingSigners = await db.query.esignatureSigners.findMany({ where: eq(esignatureSigners.requestId, request.id) })
    // The request-status transition is decided by the pure computeSignatureRequestStatusAfterSign() helper (above); null means "no change".
    const newStatus = computeSignatureRequestStatusAfterSign(remainingSigners)
    await db.update(esignatureRequests).set({
      status: newStatus ?? request.status,
      completedAt: newStatus === "completed" ? new Date() : undefined,
    }).where(eq(esignatureRequests.id, request.id))

    // A change order sent for approval must leave "pending_approval" once every signer has signed (Wave 141). The transition is decided by the pure
    // changeOrderTransitionAfter() helper (above); approvedById is deliberately left untouched (an external signer, not a real dbUser, did this).
    const coTransition = changeOrderTransitionAfter("sign", request.linkedEntityType, remainingSigners, new Date())
    if (coTransition) {
      await db.update(constructionChangeOrders).set({
        status: coTransition.status,
        ...(coTransition.approvedAt ? { approvedAt: coTransition.approvedAt } : {}),
      }).where(and(eq(constructionChangeOrders.id, request.linkedEntityId), eq(constructionChangeOrders.orgId, request.orgId)))
    }

    return updatedSigner
  })
}

export async function declineSignature(token: string, reason?: string) {
  const { signer, orgId } = await resolveSignerFromToken(token)
  if (signer.status !== "pending") throw new ServiceError("This signer has already responded", 409)

  return withTenantContext({ orgId }, async (db) => {
    const request = await db.query.esignatureRequests.findFirst({ where: eq(esignatureRequests.id, signer.requestId) })
    if (!request) throw new ServiceError("Signature request not found", 404)

    const [updatedSigner] = await db.update(esignatureSigners).set({
      status: "declined", declinedAt: new Date(), declineReason: reason,
    }).where(eq(esignatureSigners.id, signer.id)).returning()

    await db.update(esignatureRequests).set({ status: "declined" }).where(eq(esignatureRequests.id, request.id))

    // A decline rejects the linked change order instead of leaving it at "pending_approval" (changeOrderTransitionAfter: {status:"rejected"}, no approvedAt).
    const coTransition = changeOrderTransitionAfter("decline", request.linkedEntityType, [], new Date())
    if (coTransition) {
      await db.update(constructionChangeOrders).set({
        status: coTransition.status,
        ...(coTransition.approvedAt ? { approvedAt: coTransition.approvedAt } : {}),
      }).where(and(eq(constructionChangeOrders.id, request.linkedEntityId), eq(constructionChangeOrders.orgId, request.orgId)))
    }

    return updatedSigner
  })
}
