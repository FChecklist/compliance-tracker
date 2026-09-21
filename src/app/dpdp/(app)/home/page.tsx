import { getDpdpAuthContext } from "@/lib/services/dpdp-session"
import { getOnePageData } from "@/lib/services/dpdp-onepage-service"
import { OnePageView } from "../_components/onepage/OnePageView"
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
  if (!org) return null

  const viewer: ViewerContext = { kind: ctx.level === "owner" ? "owner" : "staff", me: viewerEmail }

  return <OnePageView orgName={org.name} rows={rows} viewer={viewer} onMarkYes={markOnePageJobDone} />
}
