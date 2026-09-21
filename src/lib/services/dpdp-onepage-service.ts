// WO-DPDP-010: shapes real dpdp.obligation + dpdp.obligation_template rows
// into the ObligationRow[] the one-page-per-role view-model/UI expects.
// assignedPersonId is an IDENTITY ID (see listMyObligations's own
// `o.assignedPersonId === identityId` comparison), not an email -- this is
// the join that turns it into the spec's flat "by: email" shape.
import { eq, inArray } from "drizzle-orm"
import { dpdpObligation, dpdpObligationTemplate, dpdpIdentity, dpdpStaffGroup, dpdpOrganisation } from "@/lib/db"
import { withDpdpContext } from "@/lib/db/tenant-scoped"
import type { ObligationRow } from "@/lib/dpdp-onepage/view-model"

export async function getOnePageData(orgId: string, viewerIdentityId: string) {
  return withDpdpContext({ orgId }, async (tx) => {
    const org = await tx.query.dpdpOrganisation.findFirst({ where: eq(dpdpOrganisation.id, orgId) })
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
