import { approvalRequests, users } from "@/lib/db"
import { withTenantContext } from "@/lib/db/tenant-scoped"
import { NextResponse } from "next/server"
import { eq, desc } from "drizzle-orm"
import { requireAuth } from "@/lib/supabase/auth-guard"

export async function GET() {
  const { response, orgId } = await requireAuth()
  if (response) return response
  if (!orgId) return NextResponse.json({ approvals: [] })

  const rows = await withTenantContext({ orgId }, (db) =>
    db.query.approvalRequests.findMany({
      orderBy: desc(approvalRequests.createdAt),
      with: { requestedBy: { columns: { name: true } } },
    })
  )
  return NextResponse.json({
    approvals: rows.map((a) => ({
      id: a.id, requestType: a.requestType, entityType: a.entityType, entityId: a.entityId,
      description: a.description, status: a.status, requestedByName: a.requestedBy?.name ?? "Unknown",
      createdAt: a.createdAt.toISOString(),
    })),
  })
}
