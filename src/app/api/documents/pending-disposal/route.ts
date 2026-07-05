import { NextResponse } from "next/server"
import { requireAuth } from "@/lib/supabase/auth-guard"
import { listPendingDisposal } from "@/lib/services/document-service"

export async function GET() {
  const { response, orgId } = await requireAuth()
  if (response) return response
  if (!orgId) return NextResponse.json({ documents: [] })

  const documents = await listPendingDisposal({ orgId })
  return NextResponse.json({ documents })
}
