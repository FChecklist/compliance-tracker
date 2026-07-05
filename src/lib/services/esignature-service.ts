// Wave 86 (Comparison CSV 2 gap analysis: CLM007 "Electronic Contract
// Signing" + DMS012 "Digital Signature Management"). Neither `documents`
// nor `erp_contracts` had any signing capability before this wave. No paid
// e-signature provider integration exists in this environment -- this is a
// real, first-party signing workflow: a tamper-evident audit trail
// (signer identity, IP, user agent, timestamp, and a document-hash
// comparison) rather than a DocuSign/Documenso API wrapper.
import { esignatureRequests, esignatureSigners, documents, erpContracts, users, db as rawDb } from "@/lib/db"
import { withTenantContext } from "@/lib/db/tenant-scoped"
import { and, eq } from "drizzle-orm"
import { ServiceError } from "./compliance-service"
export { ServiceError }
import { createId } from "@paralleldrive/cuid2"
import { createHash } from "crypto"
import { createClient } from "@supabase/supabase-js"

export type ErpContext = { orgId: string; userId: string; dbUser: typeof users.$inferSelect }

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

  throw new ServiceError("Unsupported linkedEntityType for e-signature", 400)
}

export async function createSignatureRequest(
  ctx: ErpContext,
  input: { linkedEntityType: "document" | "erp_contract"; linkedEntityId: string; title: string; signers: { name: string; email: string; order?: number }[] }
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

async function resolveSignerFromToken(token: string) {
  const signer = await rawDb.query.esignatureSigners.findFirst({ where: eq(esignatureSigners.accessToken, token) })
  if (!signer) throw new ServiceError("This signing link is invalid", 404)
  if (signer.tokenExpiresAt < new Date()) throw new ServiceError("This signing link has expired", 410)
  return signer
}

export async function getSigningSession(token: string) {
  const signer = await resolveSignerFromToken(token)
  const request = await rawDb.query.esignatureRequests.findFirst({ where: eq(esignatureRequests.id, signer.requestId) })
  if (!request) throw new ServiceError("Signature request not found", 404)
  if (request.status === "voided") throw new ServiceError("This signature request has been voided", 409)

  const allSigners = await rawDb.query.esignatureSigners.findMany({ where: eq(esignatureSigners.requestId, request.id) })
  const isMyTurn = signer.signOrder == null || !allSigners.some((s) => (s.signOrder ?? Infinity) < signer.signOrder! && s.status === "pending")

  return {
    requestTitle: request.title, requestStatus: request.status,
    signerName: signer.name, signerStatus: signer.status, signerId: signer.id,
    isMyTurn,
  }
}

export async function submitSignature(token: string, input: { signatureImageData: string; signatureMethod: "drawn" | "typed"; ipAddress?: string; userAgent?: string }) {
  const signer = await resolveSignerFromToken(token)
  if (signer.status !== "pending") throw new ServiceError("This signature has already been recorded", 409)

  const request = await rawDb.query.esignatureRequests.findFirst({ where: eq(esignatureRequests.id, signer.requestId) })
  if (!request) throw new ServiceError("Signature request not found", 404)
  if (request.status === "voided") throw new ServiceError("This signature request has been voided", 409)

  if (signer.signOrder != null) {
    const allSigners = await rawDb.query.esignatureSigners.findMany({ where: eq(esignatureSigners.requestId, request.id) })
    const outOfTurn = allSigners.some((s) => (s.signOrder ?? Infinity) < signer.signOrder! && s.status === "pending")
    if (outOfTurn) throw new ServiceError("An earlier signer in the sequence has not signed yet", 409)
  }

  // Recompute the hash right now -- comparing it against the request's
  // baseline documentHash is how a later audit detects whether the
  // underlying document/contract changed between request creation and
  // this signature.
  const documentHashAtSigning = await computeDocumentHash(request.orgId, request.linkedEntityType, request.linkedEntityId)

  const [updatedSigner] = await rawDb.update(esignatureSigners).set({
    status: "signed", signatureImageData: input.signatureImageData, signatureMethod: input.signatureMethod,
    signedAt: new Date(), ipAddress: input.ipAddress, userAgent: input.userAgent, documentHashAtSigning,
  }).where(eq(esignatureSigners.id, signer.id)).returning()

  const remainingSigners = await rawDb.query.esignatureSigners.findMany({ where: eq(esignatureSigners.requestId, request.id) })
  const allSigned = remainingSigners.every((s) => s.status === "signed")
  const anySigned = remainingSigners.some((s) => s.status === "signed")
  await rawDb.update(esignatureRequests).set({
    status: allSigned ? "completed" : anySigned ? "partially_signed" : request.status,
    completedAt: allSigned ? new Date() : undefined,
  }).where(eq(esignatureRequests.id, request.id))

  return updatedSigner
}

export async function declineSignature(token: string, reason?: string) {
  const signer = await resolveSignerFromToken(token)
  if (signer.status !== "pending") throw new ServiceError("This signer has already responded", 409)

  const [updatedSigner] = await rawDb.update(esignatureSigners).set({
    status: "declined", declinedAt: new Date(), declineReason: reason,
  }).where(eq(esignatureSigners.id, signer.id)).returning()

  await rawDb.update(esignatureRequests).set({ status: "declined" }).where(eq(esignatureRequests.id, signer.requestId))
  return updatedSigner
}
