import { approvalRequests } from "@/lib/db"
import { withTenantContext } from "@/lib/db/tenant-scoped"
import { NextResponse } from "next/server"
import { eq, and, desc } from "drizzle-orm"
import { requireAuth } from "@/lib/supabase/auth-guard"
import { listMyPendingApprovals } from "@/lib/services/approval-workflow-service"
import { listDraftedCommunications } from "@/lib/services/communication-drafting-service"
import { listQuotations } from "@/lib/services/erp-selling-service"
import { listChangeOrdersAwaitingApproval } from "@/lib/services/construction-change-order-service"

// Priority 18a (VERI Chat second-screen unification): "everything currently
// waiting on the current user's decision" was scattered across 5 real,
// independently-built mechanisms with zero shared list -- the single-step
// approvalRequests queue (/approvals), the multi-step approval-workflow-
// service.ts engine (/approval-workflows/pending), drafted-communications
// email-draft approve/reject, and (found during this build, NOT previously
// surfaced anywhere) erp_quotations/construction_change_orders status
// transitions, each with their own status enum and no shared queue at all.
// This route is a thin, read-only aggregator over all five -- it creates no
// new approval logic, just normalizes each service's own list call into one
// shape so the panel can render one feed. Every actual decision (approve/
// reject) still goes through each mechanism's own existing, unchanged route.
export type UnifiedApprovalItem = {
  id: string
  kind: "approval_request" | "workflow_step" | "drafted_communication" | "quotation" | "change_order"
  title: string
  sub: string
  createdAt: string
  entityType?: string
  entityId?: string
}

export async function GET() {
  const { response, dbUser, orgId } = await requireAuth()
  if (response) return response
  if (!orgId || !dbUser) return NextResponse.json({ items: [] })

  const items: UnifiedApprovalItem[] = []

  // Each source is independently optional -- e.g. listQuotations() throws
  // when the 'erp' product branch isn't enabled for this org (requireErpEnabled),
  // which must never blank out the other 4 real sources. Matches this
  // panel's own existing per-fetch .catch(() => {}) resilience convention.
  await Promise.allSettled([
    (async () => {
      const requests = await withTenantContext({ orgId }, (db) =>
        db.query.approvalRequests.findMany({
          where: and(eq(approvalRequests.orgId, orgId), eq(approvalRequests.status, "pending")),
          orderBy: desc(approvalRequests.createdAt),
          with: { requestedBy: { columns: { name: true } } },
        })
      )
      for (const r of requests) {
        items.push({
          id: r.id, kind: "approval_request",
          title: r.requestType.replace(/_/g, " "),
          sub: `${r.description ?? "—"} · requested by ${r.requestedBy?.name ?? "Unknown"}`,
          createdAt: r.createdAt.toISOString(),
        })
      }
    })(),
    (async () => {
      const steps = await listMyPendingApprovals({ orgId, userId: dbUser.id, dbUser })
      for (const s of steps) {
        items.push({
          id: s.id, kind: "workflow_step",
          title: s.instance.entityType.replace(/_/g, " "),
          sub: `${s.approvalsReceived}/${s.requiredApprovals} approvals · requires ${s.approverRole.replace(/_/g, " ")}+`,
          createdAt: s.createdAt.toISOString(),
          entityType: s.instance.entityType, entityId: s.instance.entityId,
        })
      }
    })(),
    (async () => {
      const drafts = await listDraftedCommunications({ orgId }, { status: "pending_approval" })
      for (const d of drafts) {
        if (d.userId !== dbUser.id) continue // per-user inbox -- see drafted_communications.userId's own schema comment
        items.push({
          id: d.id, kind: "drafted_communication",
          title: `Email draft: ${d.subject}`,
          sub: `To ${(d.recipientEmails as string[]).join(", ") || "—"}`,
          createdAt: d.createdAt.toISOString(),
        })
      }
    })(),
    (async () => {
      const quotations = await listQuotations({ orgId }, { status: "pending_approval", pageSize: 50 })
      for (const q of quotations.items) {
        items.push({
          id: q.id, kind: "quotation",
          title: `Quotation ${q.quotationNumber}`,
          sub: `${q.customer?.customerName ?? "—"} · ${q.grandTotal ?? "0"}`,
          createdAt: q.quotationDate ? new Date(q.quotationDate).toISOString() : new Date().toISOString(),
        })
      }
    })(),
    (async () => {
      const changeOrders = await listChangeOrdersAwaitingApproval({ orgId })
      for (const c of changeOrders) {
        items.push({
          id: c.id, kind: "change_order",
          title: `Change order #${c.number}: ${c.title}`,
          sub: c.reason ?? "—",
          createdAt: c.createdAt.toISOString(),
        })
      }
    })(),
  ])

  items.sort((a, b) => new Date(b.createdAt).getTime() - new Date(a.createdAt).getTime())
  return NextResponse.json({ items })
}
