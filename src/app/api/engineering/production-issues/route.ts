// Audit198 gap closure, 2026-07-21 (DOCUMENTATION category -- ARTICLE-076
// "Every production issue shall be documented in a knowledge repository").
// Platform-wide (no org scoping -- this is VERIDIAN's own engineering
// history, not tenant business data), veridian_admin-gated same as
// GET /api/assets/cache/stats and GET /api/ai/cache/governance. Distinct
// from /api/incidents (compliance.incidents, GRC/business incident
// register) -- see src/lib/db/schema.ts's production_issues table comment
// for why these are genuinely different concerns, not duplicated.
import { NextRequest, NextResponse } from "next/server"
import { desc, eq } from "drizzle-orm"
import { db, productionIssues } from "@/lib/db"
import { requireAuth } from "@/lib/supabase/auth-guard"

export async function GET(request: NextRequest) {
  const { response, dbUser } = await requireAuth()
  if (response) return response
  if (!dbUser || dbUser.role !== "veridian_admin") {
    return NextResponse.json({ error: "veridian_admin-only" }, { status: 403 })
  }

  const statusFilter = request.nextUrl.searchParams.get("status")
  const rows = statusFilter
    ? await db.select().from(productionIssues).where(eq(productionIssues.status, statusFilter as never)).orderBy(desc(productionIssues.discoveredAt))
    : await db.select().from(productionIssues).orderBy(desc(productionIssues.discoveredAt))

  return NextResponse.json({ issues: rows })
}

export async function POST(request: NextRequest) {
  const { response, dbUser } = await requireAuth()
  if (response) return response
  if (!dbUser || dbUser.role !== "veridian_admin") {
    return NextResponse.json({ error: "veridian_admin-only" }, { status: 403 })
  }

  const body = await request.json()
  if (!body.title?.trim() || !body.description?.trim()) {
    return NextResponse.json({ error: "title and description are required" }, { status: 400 })
  }

  const [issue] = await db
    .insert(productionIssues)
    .values({
      title: body.title.trim(),
      description: body.description.trim(),
      component: body.component ?? null,
      severity: body.severity ?? "medium",
      tags: Array.isArray(body.tags) ? body.tags : [],
      reportedBy: dbUser.id,
    })
    .returning()

  return NextResponse.json({ id: issue.id }, { status: 201 })
}
