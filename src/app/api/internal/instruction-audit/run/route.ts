import { NextRequest, NextResponse } from "next/server"
import { runInstructionMismatchAudit } from "@/lib/loops/instruction-mismatch-audit"

/**
 * Cron-triggered entry point for Wave 12's instruction-mismatch audit.
 * Same shared-secret pattern as /api/internal/loops/run -- there's no user
 * session for a scheduled job. Deliberately its own route rather than
 * folded into loops/run, since this isn't part of the Wave 5 loop taxonomy
 * (see instruction-mismatch-audit.ts for why).
 */
function isAuthorized(request: NextRequest): boolean {
  const secret = process.env.CRON_SECRET
  if (!secret) return false
  return request.headers.get("authorization") === `Bearer ${secret}`
}

export async function GET(request: NextRequest) {
  if (!isAuthorized(request)) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 })
  }
  try {
    const result = await runInstructionMismatchAudit()
    return NextResponse.json({ ranAt: new Date().toISOString(), result })
  } catch (error) {
    console.error("Instruction mismatch audit run failed:", error)
    return NextResponse.json({ error: "Instruction mismatch audit run failed" }, { status: 500 })
  }
}

export async function POST(request: NextRequest) {
  return GET(request)
}
