// WO-DPDP-010: shapes real dpdp.obligation + dpdp.obligation_template rows
// into the ObligationRow[] the one-page-per-role view-model/UI expects.
// assignedPersonId is an IDENTITY ID (see listMyObligations's own
// `o.assignedPersonId === identityId` comparison), not an email -- this is
// the join that turns it into the spec's flat "by: email" shape.
import { desc, eq, inArray } from "drizzle-orm"
import { dpdpObligation, dpdpObligationTemplate, dpdpIdentity, dpdpStaffGroup, dpdpOrganisation, dpdpEvent } from "@/lib/db"
import { withDpdpContext } from "@/lib/db/tenant-scoped"
import type { ObligationRow } from "@/lib/dpdp-onepage/view-model"
import { ServiceError } from "./compliance-service"
export { ServiceError }

export async function getOnePageData(orgId: string, viewerIdentityId: string) {
  return withDpdpContext({ orgId }, async (tx) => {
    const org = await tx.query.dpdpOrganisation.findFirst({ where: eq(dpdpOrganisation.id, orgId) })
    if (!org) throw new ServiceError("Organisation not found", 404)
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

    const rows: ObligationRow[] = obligations.map((o) => {
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

    return { org, rows, viewerEmail, obligationById }
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
