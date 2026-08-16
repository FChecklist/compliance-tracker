import { NextResponse } from "next/server"
import { requireAuth } from "@/lib/supabase/auth-guard"
import { requirePermissionForUser } from "@/lib/services/permission-service"
import { submitJournalEntry, ServiceError } from "@/lib/services/erp-accounting-service"

// VERIDIAN Review Framework remediation (Wave 4, Track 2: Access Control /
// Role-Based Permissions): previously gated only by requireAuth() -- now
// requires at least "manager" rank (ERP_ACTION_ROLES["erp.journal_entries.submit"]).
// "manager" (not "member") because submitJournalEntry is the action that
// actually POSTS the entry to the general ledger -- financially final,
// hard to cleanly reverse (reversal needs a fresh reversing JE, not an
// edit), and matches every existing precedent in this codebase for GL-
// posting/approval-style actions (fixed_assets.dispose, quotations.approve,
// sales_orders.update_status).
export async function POST(_request: Request, { params }: { params: Promise<{ id: string }> }) {
  const { response, dbUser, orgId } = await requireAuth()
  if (response) return response
  if (!orgId || !dbUser) return NextResponse.json({ error: "No organisation found" }, { status: 400 })
  const roleErr = requirePermissionForUser(dbUser, "erp.journal_entries.submit")
  if (roleErr) return roleErr

  try {
    const { id } = await params
    const result = await submitJournalEntry({ orgId, userId: dbUser.id, dbUser }, id)

    if (!result.pendingApproval) {
      try {
        const { deliverWebhook } = await import("@/lib/webhook-deliver")
        await deliverWebhook(orgId, "erp_journal_entry.submitted", { journalEntryId: id, totalDebit: result.totalDebit })
      } catch (webhookError) {
        console.error("Webhook delivery error (non-fatal):", webhookError)
      }
    }

    return NextResponse.json(result)
  } catch (error) {
    if (error instanceof ServiceError) return NextResponse.json({ error: error.message }, { status: error.status })
    console.error("Journal entry submit error:", error)
    return NextResponse.json({ error: "Failed to submit journal entry" }, { status: 500 })
  }
}
