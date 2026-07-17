import { NextResponse } from "next/server"
import { requireAuth } from "@/lib/supabase/auth-guard"
import { requirePermissionForUser } from "@/lib/services/permission-service"
import { submitJournalEntry, ServiceError } from "@/lib/services/erp-accounting-service"

export async function POST(_request: Request, { params }: { params: Promise<{ id: string }> }) {
  const { response, dbUser, orgId } = await requireAuth()
  if (response) return response
  if (!orgId || !dbUser) return NextResponse.json({ error: "No organisation found" }, { status: 400 })
  // manager: posts the entry to the general ledger, hard to undo once posted
  const roleErr = requirePermissionForUser(dbUser, "erp.general_ledger.submit")
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
