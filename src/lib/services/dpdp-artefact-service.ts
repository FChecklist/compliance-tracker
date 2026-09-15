// WO-DPDP-001 4.4 -- evidence, bitemporal, IMG-001/002/003/004.
// UPDATE is column-restricted at the DB grant level (drizzle/0415) to
// exactly the columns this file ever sets after INSERT: effective_to,
// superseded_by_id, lifecycle_state, redacted_at/by/reason, updated_at.
// Anything else (filename, sha256, t_activity, ...) is genuinely immutable
// once written -- a bug here that tried to change one would fail with a
// Postgres permission error, not silently succeed.
import { and, eq, isNull } from "drizzle-orm"
import { dpdpArtefact, dpdpArtefactFlag, dpdpObligation } from "@/lib/db"
import { withDpdpContext } from "@/lib/db/tenant-scoped"
import { logDpdpEvent } from "./dpdp-event-service"
import { ServiceError } from "./compliance-service"
export { ServiceError }

// A gap this large between when the file says it was made (t_exif / the
// document's own stated date) and when it landed here raises a flag but
// never blocks the upload -- work order 4.4's own rule.
const SUSPICIOUS_GAP_DAYS = 3

export type UploadArtefactInput = {
  orgId: string; obligationId: string; uploadedBy: string; filename: string; mime?: string; sizeBytes?: number
  sha256?: string; tActivity?: Date; tDocumentStated?: Date; tExif?: Date; tFileModified?: Date
  device?: string; geo?: string
}

export async function uploadArtefact(input: UploadArtefactInput) {
  return withDpdpContext({ orgId: input.orgId }, async (tx) => {
    const obligation = await tx.query.dpdpObligation.findFirst({ where: and(eq(dpdpObligation.id, input.obligationId), eq(dpdpObligation.orgId, input.orgId)) })
    if (!obligation) throw new ServiceError("Job not found", 404)

    const [artefact] = await tx.insert(dpdpArtefact).values({
      obligationId: input.obligationId, orgId: input.orgId, filename: input.filename, mime: input.mime, sizeBytes: input.sizeBytes,
      sha256: input.sha256, tActivity: input.tActivity, tDocumentStated: input.tDocumentStated, tExif: input.tExif, tFileModified: input.tFileModified,
      tSubmitted: new Date(), lifecycleState: "CANDIDATE", device: input.device, geo: input.geo, uploadedBy: input.uploadedBy,
    }).returning()

    const reference = input.tExif ?? input.tDocumentStated
    if (input.tActivity && reference) {
      const gapMs = Math.abs(input.tActivity.getTime() - reference.getTime())
      if (gapMs > SUSPICIOUS_GAP_DAYS * 24 * 60 * 60 * 1000) {
        await tx.insert(dpdpArtefactFlag).values({ artefactId: artefact.id, kind: "date_gap", detail: `Activity date and file date differ by more than ${SUSPICIOUS_GAP_DAYS} days` })
      }
    }

    await logDpdpEvent({ orgId: input.orgId, actorIdentityId: input.uploadedBy, actorLabel: "system", kind: "artefact_uploaded", summary: `Uploaded ${input.filename}` }, tx)
    return artefact
  })
}

/**
 * Acceptance moves a CANDIDATE straight to ACTIVE (this product has no
 * separate manual "CONFIRMED" review step distinct from the obligation's
 * own accept/reject -- accepting the obligation IS confirming its proof).
 * If a prior ACTIVE artefact exists for the same obligation, it is
 * superseded (IMG-003: SUPERSEDED requires a pointer, set here in the same
 * transaction as the new row's insert so the CHECK constraint is never
 * seen half-satisfied).
 */
export async function acceptArtefact(orgId: string, acceptedBy: string, artefactId: string) {
  return withDpdpContext({ orgId }, async (tx) => {
    const artefact = await tx.query.dpdpArtefact.findFirst({ where: and(eq(dpdpArtefact.id, artefactId), eq(dpdpArtefact.orgId, orgId)) })
    if (!artefact) throw new ServiceError("Not found", 404)

    const prior = await tx.query.dpdpArtefact.findFirst({
      where: and(eq(dpdpArtefact.obligationId, artefact.obligationId), eq(dpdpArtefact.lifecycleState, "ACTIVE"), isNull(dpdpArtefact.effectiveTo)),
    })
    if (prior) {
      await tx.update(dpdpArtefact).set({ lifecycleState: "SUPERSEDED", supersededById: artefact.id, effectiveTo: new Date(), updatedAt: new Date() }).where(eq(dpdpArtefact.id, prior.id))
      await logDpdpEvent({ orgId, actorIdentityId: acceptedBy, actorLabel: "system", kind: "artefact_superseded", summary: `Superseded by ${artefact.filename}` }, tx)
    }

    const [updated] = await tx.update(dpdpArtefact).set({ lifecycleState: "ACTIVE", tAccepted: new Date(), acceptedBy, updatedAt: new Date() }).where(eq(dpdpArtefact.id, artefactId)).returning()
    await logDpdpEvent({ orgId, actorIdentityId: acceptedBy, actorLabel: "system", kind: "artefact_accepted", summary: `Accepted ${artefact.filename}` }, tx)
    return updated
  })
}

export async function listArtefactsForObligation(orgId: string, obligationId: string) {
  return withDpdpContext({ orgId }, (tx) => tx.query.dpdpArtefact.findMany({ where: and(eq(dpdpArtefact.obligationId, obligationId), eq(dpdpArtefact.orgId, orgId)) }))
}

/**
 * IMG-002, as-of recall: "what was the position on 13 May 2027" -- the
 * exact query pattern the work order names, run against whichever
 * obligation's evidence the caller asks for.
 */
export async function artefactAsOf(orgId: string, obligationId: string, asOf: Date) {
  return withDpdpContext({ orgId }, async (tx) => {
    const rows = await tx.query.dpdpArtefact.findMany({ where: and(eq(dpdpArtefact.obligationId, obligationId), eq(dpdpArtefact.orgId, orgId)) })
    return rows.find((r) => r.effectiveFrom <= asOf && (r.effectiveTo === null || r.effectiveTo > asOf)) ?? null
  })
}

/**
 * IMG-004 mechanism: blanks the display-facing fields (filename, geo,
 * device -- deliberately NOT sha256/t_* timestamps, which are the forensic
 * record that the redaction itself happened at a real, unaltered point in
 * time) and stamps who/when/why. This is the MECHANISM only -- whether
 * this should ever actually be invoked on a given row is B4 in the work
 * order, reserved to Rajat/counsel, not decided here. Do not wire a UI
 * button to this without that sign-off existing first.
 */
export async function redactArtefact(orgId: string, redactedBy: string, artefactId: string, reason: string) {
  if (!reason.trim()) throw new ServiceError("A reason is required for redaction", 400)
  return withDpdpContext({ orgId }, async (tx) => {
    const artefact = await tx.query.dpdpArtefact.findFirst({ where: and(eq(dpdpArtefact.id, artefactId), eq(dpdpArtefact.orgId, orgId)) })
    if (!artefact) throw new ServiceError("Not found", 404)
    const [updated] = await tx.update(dpdpArtefact).set({
      filename: "[redacted]", device: null, geo: null, redactedAt: new Date(), redactedBy, redactionReason: reason, updatedAt: new Date(),
    }).where(eq(dpdpArtefact.id, artefactId)).returning()
    await logDpdpEvent({ orgId, actorIdentityId: redactedBy, actorLabel: "system", kind: "artefact_redacted", summary: "Redacted an artefact", detail: reason }, tx)
    return updated
  })
}
