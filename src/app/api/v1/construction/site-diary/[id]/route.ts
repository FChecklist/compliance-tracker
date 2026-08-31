// Real-screen conversion (2026-08-30): single-entry GET for the Site Diary
// Object Page. Wrapped in the same REQUEST_TIMEOUT_MS pattern as the
// sibling list route (route.ts's own header explains why -- a real
// production timeout incident, A4S14_sitediary_01) for consistency, even
// though a single-row lookup by id is far less likely to hit it.
import { NextRequest, NextResponse } from "next/server"
import { requireAuthOrApiKey } from "@/lib/supabase/auth-guard"
import { getSiteDiary, ServiceError } from "@/lib/services/construction-site-diary-service"

const REQUEST_TIMEOUT_MS = 15_000

async function withRequestTimeout<T>(fn: () => Promise<T>): Promise<T> {
  const timedOut = Symbol("timed-out")
  let timer: ReturnType<typeof setTimeout>
  const result = await Promise.race([
    fn(),
    new Promise<typeof timedOut>((resolve) => {
      timer = setTimeout(() => resolve(timedOut), REQUEST_TIMEOUT_MS)
    }),
  ])
  clearTimeout(timer!)
  if (result === timedOut) throw new ServiceError("Site diary request did not respond in time", 504)
  return result as T
}

export async function GET(request: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  try {
    return await withRequestTimeout(async () => {
      const ctx = await requireAuthOrApiKey(request)
      if (ctx.response) return ctx.response
      if (!ctx.orgId) return NextResponse.json({ error: "No organisation on this account" }, { status: 400 })

      const { id } = await params
      const diary = await getSiteDiary({ orgId: ctx.orgId }, id)
      return NextResponse.json(diary)
    })
  } catch (error) {
    if (error instanceof ServiceError) return NextResponse.json({ error: error.message }, { status: error.status })
    console.error("v1 construction site diary get error:", error)
    return NextResponse.json({ error: "Failed to fetch site diary entry" }, { status: 500 })
  }
}
