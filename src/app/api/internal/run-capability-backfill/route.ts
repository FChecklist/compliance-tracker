// One-time internal trigger for the Capability Registry backfill (Wave 43),
// run as part of the AI OS Certification pass (2026-07-04) after discovering
// via live query that compliance.embeddings had 0 rows in production despite
// this backfill route existing since Wave 43 -- it had never actually been
// run (or was run before migration 0037 added the missing vector column and
// failed silently). Same shared-secret pattern as other one-time internal
// routes this session. Remove after use.
import { NextRequest, NextResponse } from "next/server"
import { backfillCapabilityIndex } from "@/lib/services/capability-backfill-service"

function isAuthorized(request: NextRequest): boolean {
  const secret = process.env.INTERNAL_TEST_SECRET
  if (!secret) return false
  return request.headers.get("authorization") === `Bearer ${secret}`
}

export async function POST(request: NextRequest) {
  if (!isAuthorized(request)) return NextResponse.json({ error: "Unauthorized" }, { status: 401 })
  const body = await request.json().catch(() => ({}))
  const { orgId, userId } = body as { orgId: string; userId: string }
  if (!orgId || !userId) return NextResponse.json({ error: "orgId and userId required" }, { status: 400 })

  try {
    const result = await backfillCapabilityIndex({ orgId, userId })
    return NextResponse.json(result)
  } catch (error) {
    return NextResponse.json({ error: String(error) }, { status: 500 })
  }
}
