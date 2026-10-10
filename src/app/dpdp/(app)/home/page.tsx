import { getDpdpAuthContext } from "@/lib/services/dpdp-session"
import { areasForProduct, getOnePageData, getPolicyArtefacts, listOnePageHistory } from "@/lib/services/dpdp-onepage-service"
import { OnePageView } from "../_components/onepage/OnePageView"
import { Timeline } from "../_components/onepage/Timeline"
import { PolicySection } from "../_components/onepage/PolicySection"
import { FirstVisitWizard } from "../_components/onepage/FirstVisitWizard"
import { RoleWelcome } from "../_components/onepage/RoleWelcome"
import { NotMeWaiting } from "../_components/onepage/NotMeWaiting"
import { acknowledgeOnePageWelcome, answerOnePageGroupJob, flagOnePageNotMe, markOnePageJobDone, saveFirstVisitAssignments } from "./actions"
import type { ViewerContext } from "@/lib/dpdp-onepage/view-model"

// WO-DPDP-010 §3/§4: the one-page-per-role experience replaces this page's
// previous separate owner-dashboard/staff-todo branches. Coordinator/
// Grievance-Officer/CA-partner/CA-manager detection is answered by
// getOnePageData's detectedRoleKind (does any of THIS org's obligations
// tagged with that role actually name this viewer's email) rather than a
// DB identity field -- parent detection is still a separate, not-yet-built
// gap (there is no parent-token concept wired into this route yet).
export default async function DpdpHomePage() {
  const ctx = await getDpdpAuthContext()
  if (!ctx) return null

  const { org, rows, viewerEmail, firstVisitSeenAt, saidNotMeAt, membershipId, detectedRoleKind, detectedCaSub } = await getOnePageData(ctx.orgId, ctx.identityId)
  const viewer: ViewerContext = { kind: ctx.level === "owner" ? "owner" : (detectedRoleKind ?? "staff"), me: viewerEmail, caSub: detectedCaSub ?? undefined }

  // WO-DPDP-010 §4: first visit, owner only for now (parent first-visit
  // screens are a separate, not-yet-built gap -- see ACTIVE-CLAIMS.yaml).
  if (viewer.kind === "owner" && !firstVisitSeenAt && membershipId) {
    const areas = await areasForProduct((org.product as "firm" | "institution") ?? "firm")
    async function handleComplete(assignments: Array<{ area: string; emails: string[]; na: boolean }>) {
      "use server"
      await saveFirstVisitAssignments(membershipId!, assignments)
    }
    return <FirstVisitWizard orgName={org.name} rows={rows} areas={areas} ownerEmail={viewerEmail} onComplete={handleComplete} />
  }

  // WO-DPDP-010 §4: the generic welcome screen for everyone else named into
  // a role (GO, coordinator, or any other assigned area). Comes before the
  // "This isn't me" check below since acknowledging IS how saidNotMeAt gets
  // set in the first place.
  if (viewer.kind !== "owner" && !firstVisitSeenAt && membershipId) {
    const jobCount = rows.filter((r) => (r.by === viewerEmail || (r.isGroup && r.viewerIsGroupMember)) && !r.na).length
    async function handleAcknowledge() {
      "use server"
      await acknowledgeOnePageWelcome(membershipId!)
    }
    async function handleNotMe() {
      "use server"
      await flagOnePageNotMe(membershipId!)
    }
    return <RoleWelcome orgName={org.name} roleKind={viewer.kind} caSub={viewer.caSub} jobCount={jobCount} onAcknowledge={handleAcknowledge} onNotMe={handleNotMe} />
  }

  // Still assigned live jobs after saying "this isn't me" -- the owner
  // hasn't reassigned yet. Recomputed from the real obligations every load,
  // not a one-time flag, so this stops showing the moment they do.
  if (viewer.kind !== "owner" && saidNotMeAt) {
    const stillAssigned = rows.some((r) => r.by === viewerEmail && !r.na)
    if (stillAssigned) return <NotMeWaiting orgName={org.name} />
  }

  if (viewer.kind === "staff") {
    return <OnePageView orgName={org.name} rows={rows} viewer={viewer} onMarkYes={markOnePageJobDone} onAnswerGroup={answerOnePageGroupJob} />
  }

  const [history, policy] = await Promise.all([listOnePageHistory(ctx.orgId), getPolicyArtefacts(ctx.orgId)])
  return (
    <>
      <OnePageView orgName={org.name} rows={rows} viewer={viewer} onMarkYes={markOnePageJobDone} onAnswerGroup={answerOnePageGroupJob} />
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
