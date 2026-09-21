// WO-DPDP-010: shapes real dpdp.obligation + dpdp.obligation_template rows
// into the ObligationRow[] the one-page-per-role view-model/UI expects.
// assignedPersonId is an IDENTITY ID (see listMyObligations's own
// `o.assignedPersonId === identityId` comparison), not an email -- this is
// the join that turns it into the spec's flat "by: email" shape.
import { and, desc, eq, inArray } from "drizzle-orm"
import { dpdpObligation, dpdpObligationTemplate, dpdpIdentity, dpdpStaffGroup, dpdpOrganisation, dpdpEvent, dpdpMembership } from "@/lib/db"
import { withDpdpContext } from "@/lib/db/tenant-scoped"
import type { ObligationRow, RoleKind } from "@/lib/dpdp-onepage/view-model"
import { GRIEVANCE_OFFICER_ROLE_TAG } from "@/lib/dpdp-onepage/view-model"
import { ServiceError } from "./compliance-service"
import { logDpdpEvent } from "./dpdp-event-service"
export { ServiceError }

export async function getOnePageData(orgId: string, viewerIdentityId: string) {
  return withDpdpContext({ orgId }, async (tx) => {
    const org = await tx.query.dpdpOrganisation.findFirst({ where: eq(dpdpOrganisation.id, orgId) })
    if (!org) throw new ServiceError("Organisation not found", 404)
    const membership = await tx.query.dpdpMembership.findFirst({ where: and(eq(dpdpMembership.identityId, viewerIdentityId), eq(dpdpMembership.orgId, orgId)) })
    const obligations = await tx.query.dpdpObligation.findMany({ where: eq(dpdpObligation.orgId, orgId) })

    const templateIds = [...new Set(obligations.map((o) => o.templateId))]
    const templates = templateIds.length
      ? await tx.query.dpdpObligationTemplate.findMany({ where: inArray(dpdpObligationTemplate.id, templateIds) })
      : []
    const templateById = new Map(templates.map((t) => [t.id, t]))

    const personIds = [...new Set(obligations.map((o) => o.assignedPersonId).filter((x): x is string => !!x))]
    const identities = personIds.length
      ? await tx.query.dpdpIdentity.findMany({ where: inArray(dpdpIdentity.id, personIds) })
      : []
    const emailByIdentityId = new Map(identities.map((i) => [i.id, i.primaryEmail]))
    const viewerEmail = emailByIdentityId.get(viewerIdentityId) ?? (await tx.query.dpdpIdentity.findFirst({ where: eq(dpdpIdentity.id, viewerIdentityId) }))?.primaryEmail ?? ""

    const groupIds = [...new Set(obligations.map((o) => o.assignedStaffGroupId).filter((x): x is string => !!x))]
    const groups = groupIds.length
      ? await tx.query.dpdpStaffGroup.findMany({ where: inArray(dpdpStaffGroup.id, groupIds) })
      : []
    const groupById = new Map(groups.map((g) => [g.id, g]))

    const obligationById = new Map(obligations.map((o) => [o.id, o]))

    // WO-DPDP-010: stable order matching the library's own intended
    // sequence (template.key, e.g. "firm-01".."firm-31") -- the query
    // itself has no ORDER BY, so without this the row order (and therefore
    // the visible "#" numbering) can silently shift between renders/reloads
    // whenever Postgres's own unordered result order changes, e.g. after an
    // UPDATE. Found live while testing the Mark Yes action: the row being
    // watched moved from position 1 to a different position mid-test.
    const sortedObligations = [...obligations].sort((a, b) => {
      const ka = templateById.get(a.templateId)?.key ?? ""
      const kb = templateById.get(b.templateId)?.key ?? ""
      return ka.localeCompare(kb)
    })

    const rows: ObligationRow[] = sortedObligations.map((o) => {
      const t = templateById.get(o.templateId)
      const isGroup = !!o.assignedStaffGroupId
      const by = isGroup
        ? groupById.get(o.assignedStaffGroupId!)?.label ?? null
        : o.assignedPersonId ? emailByIdentityId.get(o.assignedPersonId) ?? null : null
      return {
        id: o.id,
        part: t?.part ?? 1,
        what: t?.name ?? "(template missing)",
        dataSet: t?.dataSet ?? null,
        dataTypes: t?.dataTypes ?? null,
        lawCodes: t?.lawCodes ?? null,
        by,
        isGroup,
        groupDone: isGroup ? o.progressDone : undefined,
        groupTotal: isGroup ? o.progressTotal : undefined,
        due: new Date(o.dueOn),
        yes: o.state === "closed" || o.state === "submitted",
        na: o.state === "not_applicable",
        dependsOnObligationId: o.dependsOnObligationId,
        // WO §6 email-digest gap (see view-model.ts's own header comment) --
        // always 0 until dpdp.task/digest_send are joined into this shape.
        sent: 0,
      }
    })

    // WO-DPDP-010 §3/§4: coordinator/Grievance-Officer detection -- the DB's
    // membership.level only ever says owner/staff (see dpdp-session.ts's
    // own DpdpAuthContext type); GO/coordinator are roleTag values on
    // obligations, not first-class identities, so "is this viewer the GO"
    // is answered by asking whether any of THIS org's obligations with that
    // roleTag are actually assigned to them -- not guessed from level.
    // Owner is resolved by the caller (home/page.tsx already knows
    // ctx.level) and always wins over this; a person could technically be
    // both (e.g. the owner named themselves GO), but that's the caller's
    // call, not this function's.
    const goTemplateIds = new Set(templates.filter((t) => t.roleTag === GRIEVANCE_OFFICER_ROLE_TAG).map((t) => t.id))
    const coordTemplateIds = new Set(templates.filter((t) => t.roleTag === "DPDP coordinator").map((t) => t.id))
    const isGO = sortedObligations.some((o) => goTemplateIds.has(o.templateId) && o.state !== "not_applicable" && emailByIdentityId.get(o.assignedPersonId ?? "") === viewerEmail)
    const isCoordinator = sortedObligations.some((o) => coordTemplateIds.has(o.templateId) && o.state !== "not_applicable" && emailByIdentityId.get(o.assignedPersonId ?? "") === viewerEmail)
    const detectedRoleKind: RoleKind | null = isGO ? "go" : isCoordinator ? "coord" : null

    return {
      org, rows, viewerEmail, obligationById,
      firstVisitSeenAt: membership?.firstVisitSeenAt ?? null,
      saidNotMeAt: membership?.saidNotMeAt ?? null,
      membershipId: membership?.id ?? null,
      detectedRoleKind,
    }
  })
}

/**
 * WO-DPDP-010 §4 "First visit, for every role" -- the client owner's
 * 3-step wizard, steps 1+2 (step 3, policy upload, is folded into the
 * always-visible PolicySection further down the page rather than gating
 * completion, since it's explicitly optional in the spec).
 *
 * Deliberately does NOT call instantiateObligationsForOrg -- that already
 * ran at org-creation time (WO-DPDP-001's "we build this with them"
 * design, which ~20 existing admin pages already depend on existing
 * immediately). Step 1 ("Create the list") is therefore a confirmation of
 * something already true, not a new side effect -- the wizard's real work
 * is step 2: assigning each roleTag area to a real person or group, which
 * previously left every job unassigned until someone used the granular
 * "assign" admin UI by hand.
 */
export async function areasForProduct(product: "firm" | "institution") {
  // Reads only obligation_template -- shared reference data with grants but
  // no RLS (see drizzle/0415's own note), so no tenant context is needed.
  const { db: rawDb } = await import("@/lib/db")
  const { getCurrentLibraryVersion } = await import("./dpdp-obligation-library")
  const version = await getCurrentLibraryVersion()
  const templates = await rawDb.query.dpdpObligationTemplate.findMany({
    where: and(eq(dpdpObligationTemplate.libraryVersionId, version.id), eq(dpdpObligationTemplate.product, product)),
  })
  const seen = new Map<string, { area: string; jobs: string[]; isGroup: boolean }>()
  for (const t of templates.sort((a, b) => a.key.localeCompare(b.key))) {
    if (!t.roleTag || ["OWNER", "CAMGR", "CAPARTNER"].includes(t.roleTag)) continue
    const isGroupJob = !!(t.appliesWhen as { grp?: boolean } | null)?.grp
    if (!seen.has(t.roleTag)) seen.set(t.roleTag, { area: t.roleTag, jobs: [], isGroup: isGroupJob })
    seen.get(t.roleTag)!.jobs.push(t.name)
    if (isGroupJob) seen.get(t.roleTag)!.isGroup = true
  }
  return [...seen.values()]
}

export type AreaAssignment = { area: string; emails: string[]; na: boolean }

/**
 * Saves step 2's "who looks after what" answers: assigns every obligation
 * whose template.roleTag matches an area to that area's person (or, for a
 * group area, creates/updates a dpdp.staff_group and assigns to it), marks
 * "doesn't apply" areas' obligations not_applicable, and marks this
 * membership's first visit seen. History event per area, matching the
 * spec's own "Named X as Y" / "Marked '...' as not applicable" copy.
 */
export async function completeOwnerFirstVisit(
  orgId: string, actorIdentityId: string, actorLabel: string, membershipId: string, assignments: AreaAssignment[]
) {
  return withDpdpContext({ orgId }, async (tx) => {
    const obligations = await tx.query.dpdpObligation.findMany({ where: eq(dpdpObligation.orgId, orgId) })
    const templateIds = [...new Set(obligations.map((o) => o.templateId))]
    const templates = templateIds.length ? await tx.query.dpdpObligationTemplate.findMany({ where: inArray(dpdpObligationTemplate.id, templateIds) }) : []
    const templateById = new Map(templates.map((t) => [t.id, t]))
    const { dpdpIdentityEmail } = await import("@/lib/db")

    async function findOrCreateIdentityByEmail(rawEmail: string) {
      const email = rawEmail.trim().toLowerCase()
      const existingEmail = await tx.query.dpdpIdentityEmail.findFirst({ where: eq(dpdpIdentityEmail.email, email) })
      if (existingEmail) return existingEmail.identityId
      const [identity] = await tx.insert(dpdpIdentity).values({ primaryEmail: email }).returning()
      await tx.insert(dpdpIdentityEmail).values({ identityId: identity.id, email, isPrimary: true })
      return identity.id
    }

    // Every real person this function names needs a dpdp.membership row in
    // THIS org, not just an obligation.assigned_person_id pointing at their
    // identity -- getDpdpAuthContext() (the only way anyone signs into
    // /dpdp/home) requires a membership row to exist and returns null
    // without one. Found live: a person named individually as Grievance
    // Officer (the non-group branch below) got assigned_person_id set
    // correctly but NO membership row, so they could never actually sign
    // in to see the page they'd just been given jobs on -- the group
    // branch already created one correctly; this was only missing here.
    async function findOrCreateMembership(identityId: string) {
      const existing = await tx.query.dpdpMembership.findFirst({ where: and(eq(dpdpMembership.identityId, identityId), eq(dpdpMembership.orgId, orgId)) })
      if (existing) return existing
      const [created] = await tx.insert(dpdpMembership).values({ identityId, orgId, level: "staff", joinedVia: "named_in_role" }).returning()
      return created
    }

    for (const a of assignments) {
      const matchingObligations = obligations.filter((o) => templateById.get(o.templateId)?.roleTag === a.area)
      if (!matchingObligations.length) continue

      if (a.na) {
        for (const o of matchingObligations) await tx.update(dpdpObligation).set({ state: "not_applicable", naReason: "Marked ‘doesn’t apply’ at first visit" }).where(eq(dpdpObligation.id, o.id))
        await logDpdpEvent({ orgId, actorIdentityId, actorLabel, kind: "obligation_not_my_job", summary: `Marked "${a.area}" as not applicable` }, tx)
        continue
      }
      if (!a.emails.length) continue

      const areaInfo = templateById.get(matchingObligations[0].templateId)
      const isGroup = !!(areaInfo?.appliesWhen as { grp?: boolean } | null)?.grp
      if (isGroup) {
        let group = await tx.query.dpdpStaffGroup.findFirst({ where: and(eq(dpdpStaffGroup.orgId, orgId), eq(dpdpStaffGroup.label, a.area)) })
        if (!group) { [group] = await tx.insert(dpdpStaffGroup).values({ orgId, label: a.area }).returning() }
        const { dpdpStaffGroupMember } = await import("@/lib/db")
        let memberCount = 0
        for (const rawEmail of a.emails) {
          if (!rawEmail.trim()) continue
          const memberIdentityId = await findOrCreateIdentityByEmail(rawEmail)
          const membership = await findOrCreateMembership(memberIdentityId)
          const existingGroupMember = await tx.query.dpdpStaffGroupMember.findFirst({ where: and(eq(dpdpStaffGroupMember.groupId, group!.id), eq(dpdpStaffGroupMember.membershipId, membership!.id)) })
          if (!existingGroupMember) await tx.insert(dpdpStaffGroupMember).values({ groupId: group!.id, membershipId: membership!.id })
          memberCount++
        }
        for (const o of matchingObligations) await tx.update(dpdpObligation).set({ assignedStaffGroupId: group!.id, progressTotal: memberCount || 1 }).where(eq(dpdpObligation.id, o.id))
        await logDpdpEvent({ orgId, actorIdentityId, actorLabel, kind: "membership_named_in_role", summary: `Named ${memberCount} people to "${a.area}"` }, tx)
        continue
      }

      const email = a.emails[0].trim().toLowerCase()
      const identityId = await findOrCreateIdentityByEmail(email)
      await findOrCreateMembership(identityId)
      for (const o of matchingObligations) await tx.update(dpdpObligation).set({ assignedPersonId: identityId }).where(eq(dpdpObligation.id, o.id))
      // fromArea jobs ("Name the Grievance Officer" / "Name a DPDP
      // coordinator") are auto-done the moment the owner names someone,
      // credited to the owner -- spec's own ex.fromArea behaviour.
      const fromAreaObligations = matchingObligations.filter((o) => (templateById.get(o.templateId)?.appliesWhen as { fromArea?: boolean } | null)?.fromArea)
      for (const o of fromAreaObligations) await tx.update(dpdpObligation).set({ state: "closed", progressDone: o.progressTotal, closedAt: new Date(), closedBy: actorIdentityId }).where(eq(dpdpObligation.id, o.id))
      await logDpdpEvent({ orgId, actorIdentityId, actorLabel, kind: "membership_named_in_role", summary: `Named ${email} as ${a.area}` }, tx)
    }

    await tx.update(dpdpMembership).set({ firstVisitSeenAt: new Date() }).where(eq(dpdpMembership.id, membershipId))
  })
}

/**
 * WO-DPDP-010 §4 "First visit, for every role" -- the generic welcome screen
 * for anyone who was NAMED into a role (Grievance Officer, DPDP coordinator,
 * or any other assigned area) but isn't the client owner: confirms they've
 * seen it, same firstVisitSeenAt gate home/page.tsx already uses for the
 * owner's own wizard.
 */
export async function acknowledgeRoleWelcome(orgId: string, actorIdentityId: string, actorLabel: string, membershipId: string) {
  return withDpdpContext({ orgId }, async (tx) => {
    await tx.update(dpdpMembership).set({ firstVisitSeenAt: new Date() }).where(eq(dpdpMembership.id, membershipId))
    await logDpdpEvent({ orgId, actorIdentityId, actorLabel, kind: "membership_first_visit_acknowledged", summary: `${actorLabel} saw their DPDP jobs for the first time` }, tx)
  })
}

/**
 * The welcome screen's "This isn't me" escape hatch: the org named the wrong
 * email for a role. Sets BOTH firstVisitSeenAt (so the welcome screen itself
 * doesn't loop) and saidNotMeAt, and logs it so it's visible in the owner's
 * History -- this is the only signal the owner gets that a reassignment is
 * needed, since there's no separate notification/inbox for it yet.
 * home/page.tsx re-checks saidNotMeAt against the viewer's CURRENT live
 * assignment count on every load, not a one-time flag: once the owner
 * reassigns the jobs away from this person, myAssignedCount naturally drops
 * to 0 and the "waiting on the owner" screen stops showing itself, with no
 * separate code path needed to clear saidNotMeAt.
 */
export async function flagNotMe(orgId: string, actorIdentityId: string, actorLabel: string, membershipId: string) {
  return withDpdpContext({ orgId }, async (tx) => {
    const now = new Date()
    await tx.update(dpdpMembership).set({ firstVisitSeenAt: now, saidNotMeAt: now }).where(eq(dpdpMembership.id, membershipId))
    await logDpdpEvent({ orgId, actorIdentityId, actorLabel, kind: "membership_said_not_me", summary: `${actorLabel} said this isn't them -- needs reassigning` }, tx)
  })
}

/** WO-DPDP-010's History timeline -- newest first, capped since the UI only ever shows the last 15 (spec's own vHistory()). Kept here (not dpdp-event-service.ts) rather than modifying a file with no ServiceError reference of its own. */
export async function listOnePageHistory(orgId: string, limit = 15) {
  return withDpdpContext({ orgId }, (tx) =>
    tx.query.dpdpEvent.findMany({ where: eq(dpdpEvent.orgId, orgId), orderBy: desc(dpdpEvent.occurredAt), limit })
  )
}

/**
 * WO-DPDP-010's "DPDP policy" section -- every version, no file bytes (WO
 * §1's own "no document storage" rule; dpdp.artefact already enforces this
 * at the DB grant level, see dpdp-artefact-service.ts's header). Finds the
 * org's "Publish a privacy policy on the website" obligation (firm product
 * only -- the institution library has no equivalent job, matching the
 * spec's own "most schools don't have one, that's fine" framing) and
 * returns its artefact history, oldest first so "current" is simply the
 * last element.
 */
export async function getPolicyArtefacts(orgId: string) {
  return withDpdpContext({ orgId }, async (tx) => {
    // Find the specific "privacy policy" obligation by its template's key
    // (firm-15) -- a plain filter since Drizzle's relational `with` can't
    // join through obligation_template's business key in one query here.
    const all = await tx.query.dpdpObligation.findMany({ where: eq(dpdpObligation.orgId, orgId) })
    const templateIds = [...new Set(all.map((o) => o.templateId))]
    const templates = templateIds.length ? await tx.query.dpdpObligationTemplate.findMany({ where: inArray(dpdpObligationTemplate.id, templateIds) }) : []
    const policyTemplate = templates.find((t) => t.key === "firm-15")
    const policyObligation = policyTemplate ? all.find((o) => o.templateId === policyTemplate.id) : undefined
    if (!policyObligation) return { obligationId: null as string | null, versions: [] as Array<{ id: string; filename: string; uploadedAt: Date; uploadedBy: string; sha256: string; current: boolean }> }

    const { dpdpArtefact } = await import("@/lib/db")
    const artefacts = await tx.query.dpdpArtefact.findMany({ where: eq(dpdpArtefact.obligationId, policyObligation.id) })
    const sorted = [...artefacts].sort((a, b) => (a.tUploaded?.getTime() ?? 0) - (b.tUploaded?.getTime() ?? 0))
    return {
      obligationId: policyObligation.id as string | null,
      versions: sorted.map((a, i) => ({ id: a.id, filename: a.filename, uploadedAt: a.tUploaded ?? new Date(0), uploadedBy: a.uploadedBy ?? "unknown", sha256: a.sha256 ?? "", current: i === sorted.length - 1 })),
    }
  })
}
