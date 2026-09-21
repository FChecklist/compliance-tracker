// WO-DPDP-001 4.3 -- the obligation to-do list: instantiated from the
// versioned library onto a specific org, tracked open/submitted/closed.
// State-transition names mirror the owner-supplied artefact's own handlers
// (data-sub k="done"/"stuck"/"not", data-rev "ok"/"no") exactly -- do not
// rename them without also updating the artefact reference.
import { and, eq } from "drizzle-orm"
import { dpdpObligation, dpdpObligationTemplate, dpdpOrganisation } from "@/lib/db"
import { withDpdpContext, type TenantDb } from "@/lib/db/tenant-scoped"
import { logDpdpEvent } from "./dpdp-event-service"
import { getCurrentLibraryVersion, listObligationTemplates } from "./dpdp-obligation-library"
import { ServiceError } from "./compliance-service"
export { ServiceError }

function addDays(base: Date, days: number): Date {
  const d = new Date(base)
  d.setDate(d.getDate() + days)
  return d
}

/**
 * "We build this with them" -- runs once, right after an org is created
 * (Home screen's own onboarding todo). Idempotent per library version: an
 * org that already has an obligation for a given template+version is
 * skipped, not duplicated.
 */
export async function instantiateObligationsForOrg(orgId: string, actorIdentityId: string) {
  const version = await getCurrentLibraryVersion()
  const allTemplates = await listObligationTemplates(version.id)

  return withDpdpContext({ orgId }, async (tx) => {
    const org = await tx.query.dpdpOrganisation.findFirst({ where: eq(dpdpOrganisation.id, orgId) })
    if (!org) throw new ServiceError("Organisation not found", 404)
    // WO-DPDP-010: the current library version holds BOTH products' templates
    // together (31 firm + 28 institution) -- a template with product=null is
    // library-agnostic (there are none today; every real WO-010 template is
    // tagged) and is included for every org, matching pre-WO-010 behaviour.
    const templates = allTemplates.filter((t) => t.product == null || t.product === org.product)

    const existing = await tx.query.dpdpObligation.findMany({ where: and(eq(dpdpObligation.orgId, orgId), eq(dpdpObligation.libraryVersionUsed, version.id)) })
    const haveTemplateIds = new Set(existing.map((o) => o.templateId))
    const toCreate = templates.filter((t) => !haveTemplateIds.has(t.id))
    if (toCreate.length === 0) return existing

    const now = new Date()
    const created = await tx.insert(dpdpObligation).values(
      toCreate.map((t) => ({
        orgId, templateId: t.id, libraryVersionUsed: version.id, dueOn: addDays(now, t.defaultDays).toISOString().slice(0, 10),
      }))
    ).returning()

    // Resolve depends_on_key (a template-level key, e.g. "firm-30" depends on
    // "firm-29") to a real depends_on_obligation_id on THIS org's instances,
    // now that both sides of the dependency exist as obligation rows.
    const byKey = new Map(templates.map((t) => [t.key, t]))
    const obligationByTemplateId = new Map([...existing, ...created].map((o) => [o.templateId, o]))
    for (const createdObligation of created) {
      const template = templates.find((t) => t.id === createdObligation.templateId)
      if (!template?.dependsOnKey) continue
      const depTemplate = byKey.get(template.dependsOnKey)
      const depObligation = depTemplate && obligationByTemplateId.get(depTemplate.id)
      if (!depObligation) continue
      await tx.update(dpdpObligation).set({ dependsOnObligationId: depObligation.id }).where(eq(dpdpObligation.id, createdObligation.id))
    }

    await logDpdpEvent({ orgId, actorIdentityId, actorLabel: "system", kind: "obligation_assigned", summary: `${created.length} jobs opened from library ${version.version}` }, tx)
    return [...existing, ...created]
  })
}

export type ObligationWithTemplate = typeof dpdpObligation.$inferSelect & { template: typeof dpdpObligationTemplate.$inferSelect | null }

export async function listObligations(orgId: string): Promise<ObligationWithTemplate[]> {
  return withDpdpContext({ orgId }, async (tx) => {
    const obligations = await tx.query.dpdpObligation.findMany({ where: eq(dpdpObligation.orgId, orgId) })
    const out: ObligationWithTemplate[] = []
    for (const o of obligations) {
      const template = await tx.query.dpdpObligationTemplate.findFirst({ where: eq(dpdpObligationTemplate.id, o.templateId) })
      out.push({ ...o, template: template ?? null })
    }
    return out
  })
}

/** For a person's "My jobs" screen -- only what's assigned to them. */
export async function listMyObligations(orgId: string, identityId: string): Promise<ObligationWithTemplate[]> {
  const all = await listObligations(orgId)
  return all.filter((o) => o.assignedPersonId === identityId)
}

async function loadObligationOrThrow(tx: TenantDb, orgId: string, obligationId: string) {
  const obligation = await tx.query.dpdpObligation.findFirst({ where: and(eq(dpdpObligation.id, obligationId), eq(dpdpObligation.orgId, orgId)) })
  if (!obligation) throw new ServiceError("Job not found", 404)
  return obligation
}

export async function assignObligation(orgId: string, actorIdentityId: string, obligationId: string, assignedPersonId: string) {
  return withDpdpContext({ orgId }, async (tx) => {
    await loadObligationOrThrow(tx, orgId, obligationId)
    const [updated] = await tx.update(dpdpObligation).set({ assignedPersonId, state: "open" }).where(eq(dpdpObligation.id, obligationId)).returning()
    await logDpdpEvent({ orgId, actorIdentityId, actorLabel: "Owner", kind: "obligation_assigned", summary: "Assigned a job" }, tx)
    return updated
  })
}

/** "Done — send it" -- the person doing the work says it's done; nothing closes until someone else checks it. */
export async function submitObligation(orgId: string, actorIdentityId: string, actorLabel: string, obligationId: string, note: string) {
  return withDpdpContext({ orgId }, async (tx) => {
    const obligation = await loadObligationOrThrow(tx, orgId, obligationId)
    if (obligation.state === "closed") throw new ServiceError("Already closed", 409)
    const [updated] = await tx.update(dpdpObligation).set({ state: "submitted", progressDone: obligation.progressTotal }).where(eq(dpdpObligation.id, obligationId)).returning()
    await logDpdpEvent({ orgId, actorIdentityId, actorLabel, kind: "obligation_submitted", summary: "Said it is done", detail: note }, tx)
    return updated
  })
}

/** "I am stuck" -- emails whoever set the job. Does not change state (the artefact's own copy: nobody has to admit confusion in front of their boss, but the job itself stays open). */
export async function markObligationStuck(orgId: string, actorIdentityId: string, actorLabel: string, obligationId: string, question: string) {
  return withDpdpContext({ orgId }, async (tx) => {
    await loadObligationOrThrow(tx, orgId, obligationId)
    await logDpdpEvent({ orgId, actorIdentityId, actorLabel, kind: "obligation_stuck", summary: "Said they are stuck", detail: question }, tx)
    return true
  })
}

/** "Not my job" -- sends it back to open/unassigned so the owner can give it to someone else. */
export async function markObligationNotMyJob(orgId: string, actorIdentityId: string, actorLabel: string, obligationId: string, reason: string) {
  return withDpdpContext({ orgId }, async (tx) => {
    await loadObligationOrThrow(tx, orgId, obligationId)
    const [updated] = await tx.update(dpdpObligation).set({ state: "open", assignedPersonId: null }).where(eq(dpdpObligation.id, obligationId)).returning()
    await logDpdpEvent({ orgId, actorIdentityId, actorLabel, kind: "obligation_not_my_job", summary: "Sent back — not their job", detail: reason }, tx)
    return updated
  })
}

/** "Looks right — accept" -- the reviewer's own check, never automatic. */
export async function acceptObligation(orgId: string, actorIdentityId: string, actorLabel: string, obligationId: string) {
  return withDpdpContext({ orgId }, async (tx) => {
    const obligation = await loadObligationOrThrow(tx, orgId, obligationId)
    if (obligation.state !== "submitted") throw new ServiceError("Nothing to accept — it hasn't been submitted", 409)
    const [updated] = await tx.update(dpdpObligation).set({ state: "closed", closedAt: new Date(), closedBy: actorIdentityId }).where(eq(dpdpObligation.id, obligationId)).returning()
    await logDpdpEvent({ orgId, actorIdentityId, actorLabel, kind: "obligation_accepted", summary: "Accepted — checked the proof" }, tx)
    return updated
  })
}

/** "Not enough — send back", with a written reason each time (edge case: two rejections copy the person's boss -- left for Phase 2's route layer to wire into notifications, not duplicated here). */
export async function rejectObligation(orgId: string, actorIdentityId: string, actorLabel: string, obligationId: string, reason: string) {
  if (!reason.trim()) throw new ServiceError("A reason is required", 400)
  return withDpdpContext({ orgId }, async (tx) => {
    const obligation = await loadObligationOrThrow(tx, orgId, obligationId)
    if (obligation.state !== "submitted") throw new ServiceError("Nothing to send back — it hasn't been submitted", 409)
    const [updated] = await tx.update(dpdpObligation).set({ state: "open" }).where(eq(dpdpObligation.id, obligationId)).returning()
    await logDpdpEvent({ orgId, actorIdentityId, actorLabel, kind: "obligation_sent_back", summary: "Sent back — not enough", detail: reason }, tx)
    return updated
  })
}

export async function listSubmittedForReview(orgId: string): Promise<ObligationWithTemplate[]> {
  const all = await listObligations(orgId)
  return all.filter((o) => o.state === "submitted")
}

// WO-DPDP-010's one-page-per-role "Mark Yes" -- a single-step yes, distinct
// from the older submit->accept two-step review workflow above (that
// workflow still exists for the granular admin pages; this is the simpler
// binary model veridian-dpdp.html specifies: "Mark Yes" closes the job
// outright, gated only by the escalation chain (blocked() in the
// view-model), never by a separate reviewer-accept step).
export async function markObligationDone(orgId: string, actorIdentityId: string, actorLabel: string, obligationId: string) {
  return withDpdpContext({ orgId }, async (tx) => {
    const obligation = await loadObligationOrThrow(tx, orgId, obligationId)
    if (obligation.dependsOnObligationId) {
      const dep = await tx.query.dpdpObligation.findFirst({ where: eq(dpdpObligation.id, obligation.dependsOnObligationId) })
      if (dep && dep.state !== "closed") throw new ServiceError("Waiting — the step before this one isn't done yet", 409)
    }
    const [updated] = await tx.update(dpdpObligation).set({ state: "closed", progressDone: obligation.progressTotal, closedAt: new Date(), closedBy: actorIdentityId }).where(eq(dpdpObligation.id, obligationId)).returning()
    await logDpdpEvent({ orgId, actorIdentityId, actorLabel, kind: "obligation_accepted", summary: `Said Yes to "${(await tx.query.dpdpObligationTemplate.findFirst({ where: eq(dpdpObligationTemplate.id, obligation.templateId) }))?.name ?? "a job"}"` }, tx)
    return updated
  })
}
