import { getDpdpAuthContext } from "@/lib/services/dpdp-session"
import { getOnePageData, getPolicyArtefacts, listOnePageHistory } from "@/lib/services/dpdp-onepage-service"
import { OnePageView } from "../_components/onepage/OnePageView"
import { Timeline } from "../_components/onepage/Timeline"
import { PolicySection } from "../_components/onepage/PolicySection"
import { markOnePageJobDone } from "./actions"
import type { ViewerContext } from "@/lib/dpdp-onepage/view-model"

// WO-DPDP-010 §3: the one-page-per-role experience replaces this page's
// previous separate owner-dashboard/staff-todo branches. Coordinator/
// Grievance-Officer/CA/parent role detection (beyond the DB's plain
// owner/staff membership level) is not yet built -- tracked as a known gap,
// not silently guessed at -- so today every non-owner membership renders as
// "staff" (the spec's own narrowest, safest role view).
export default async function DpdpHomePage() {
  const ctx = await getDpdpAuthContext()
  if (!ctx) return null

  const { org, rows, viewerEmail } = await getOnePageData(ctx.orgId, ctx.identityId)
  const viewer: ViewerContext = { kind: ctx.level === "owner" ? "owner" : "staff", me: viewerEmail }

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
