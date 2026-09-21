import { getDpdpAuthContext } from "@/lib/services/dpdp-session"
import { areasForProduct, getOnePageData, getPolicyArtefacts, listOnePageHistory } from "@/lib/services/dpdp-onepage-service"
import { OnePageView } from "../_components/onepage/OnePageView"
import { Timeline } from "../_components/onepage/Timeline"
import { PolicySection } from "../_components/onepage/PolicySection"
import { FirstVisitWizard } from "../_components/onepage/FirstVisitWizard"
import { markOnePageJobDone, saveFirstVisitAssignments } from "./actions"
import type { ViewerContext } from "@/lib/dpdp-onepage/view-model"

// WO-DPDP-010 §3/§4: the one-page-per-role experience replaces this page's
// previous separate owner-dashboard/staff-todo branches. Coordinator/
// Grievance-Officer detection is answered by getOnePageData's
// detectedRoleKind (does any of THIS org's obligations tagged with that
// role actually name this viewer's email) rather than a DB identity field
// -- CA/parent detection is still a separate, not-yet-built gap (there is
// no CA-firm or parent-token concept wired into this route yet).
export default async function DpdpHomePage() {
  const ctx = await getDpdpAuthContext()
  if (!ctx) return null

  const { org, rows, viewerEmail, firstVisitSeenAt, membershipId, detectedRoleKind } = await getOnePageData(ctx.orgId, ctx.identityId)
  const viewer: ViewerContext = { kind: ctx.level === "owner" ? "owner" : (detectedRoleKind ?? "staff"), me: viewerEmail }

  // WO-DPDP-010 §4: first visit, owner only for now (coordinator/GO/CA/
  // parent first-visit screens are a separate, not-yet-built gap -- see the
  // header comment above and ACTIVE-CLAIMS.yaml).
  if (viewer.kind === "owner" && !firstVisitSeenAt && membershipId) {
    const areas = await areasForProduct((org.product as "firm" | "institution") ?? "firm")
    async function handleComplete(assignments: Array<{ area: string; emails: string[]; na: boolean }>) {
      "use server"
      await saveFirstVisitAssignments(membershipId!, assignments)
    }
    return <FirstVisitWizard orgName={org.name} rows={rows} areas={areas} ownerEmail={viewerEmail} onComplete={handleComplete} />
  }

  if (viewer.kind === "staff") {
    return <OnePageView orgName={org.name} rows={rows} viewer={viewer} onMarkYes={markOnePageJobDone} />
  }

  const [history, policy] = await Promise.all([listOnePageHistory(ctx.orgId), getPolicyArtefacts(ctx.orgId)])
  return (
    <>
      <OnePageView orgName={org.name} rows={rows} viewer={viewer} onMarkYes={markOnePageJobDone} />
      {org.product === "firm" && <PolicySection versions={policy.versions} />}
      <div className="dpdp-onepage">
        <div className="max-w-[1240px] mx-auto px-5 pb-14">
          <div className="mb-3" style={{ fontFamily: "Sora, sans-serif", fontSize: 20, fontWeight: 700, color: "var(--dpdp-ink)" }}>🕘 History</div>
          <Timeline entries={history.map((h) => ({ who: h.actorLabel, what: h.summary, at: h.occurredAt, isNew: Date.now() - h.occurredAt.getTime() < 3_600_000 }))} />
        </div>
      </div>
    </>
  )
}
