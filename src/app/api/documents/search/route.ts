import { NextRequest, NextResponse } from "next/server"
import { requireAuth } from "@/lib/supabase/auth-guard"
import { searchDocuments } from "@/lib/services/document-service"

export async function GET(request: NextRequest) {
  const { response, orgId } = await requireAuth()
  if (response) return response
  if (!orgId) return NextResponse.json({ documents: [] })

  const query = request.nextUrl.searchParams.get("q") ?? ""
  const documents = await searchDocuments({ orgId }, query)
  return NextResponse.json({ documents })
}
