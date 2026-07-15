// Priority 15 (PROJEXA Accounting module, Wave 1): thin ALIASING route over
// erp-bank-reconciliation-service.ts -- read-only for this wave: lists bank
// statement imports and, given ?importId=, that import's own lines (with
// matched/unmatched/ignored status). Importing a new statement (file
// upload) and matching/ignoring a line are real write actions in the
// underlying service (importBankStatement/matchLine/ignoreLine) but need a
// file-upload UI PROJEXA doesn't have yet -- deliberately left for a
// follow-up rather than a half-working upload form.
import { NextRequest, NextResponse } from "next/server"
import { requireAuthOrApiKey } from "@/lib/supabase/auth-guard"
import { listImports, listLines, ServiceError } from "@/lib/services/erp-bank-reconciliation-service"

export async function GET(request: NextRequest) {
  const ctx = await requireAuthOrApiKey(request)
  if (ctx.response) return ctx.response
  if (!ctx.orgId) return NextResponse.json({ imports: [] })

  try {
    const importId = request.nextUrl.searchParams.get("importId")
    if (importId) {
      const lines = await listLines({ orgId: ctx.orgId }, importId)
      return NextResponse.json({ lines })
    }
    const imports = await listImports({ orgId: ctx.orgId })
    return NextResponse.json({ imports })
  } catch (error) {
    if (error instanceof ServiceError) return NextResponse.json({ error: error.message }, { status: error.status })
    console.error("v1 projexa bank-reconciliation error:", error)
    return NextResponse.json({ error: "Failed to fetch bank reconciliation data" }, { status: 500 })
  }
}
