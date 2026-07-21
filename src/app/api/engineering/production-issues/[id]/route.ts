// Audit198 gap closure, 2026-07-21 (DOCUMENTATION category -- ARTICLE-076).
// PATCH-only update path: record root cause / resolution / prevention
// action / status transition as the issue is investigated -- the actual
// "knowledge repository" content, not just a title.
import { NextRequest, NextResponse } from "next/server"
import { eq } from "drizzle-orm"
import { db, productionIssues } from "@/lib/db"
import { requireAuth } from "@/lib/supabase/auth-guard"

type RouteContext = { params: Promise<{ id: string }> }

const PATCHABLE_FIELDS = ["status", "rootCause", "resolution", "preventionAction", "relatedPr", "component", "severity"] as const

export async function PATCH(request: NextRequest, context: RouteContext) {
  const { response, dbUser } = await requireAuth()
  if (response) return response
  if (!dbUser || dbUser.role !== "veridian_admin") {
    return NextResponse.json({ error: "veridian_admin-only" }, { status: 403 })
  }

  const { id } = await context.params
  const body = await request.json()

  const updates: Record<string, unknown> = { updatedAt: new Date() }
  for (const field of PATCHABLE_FIELDS) {
    if (field in body) updates[field] = body[field]
  }
  if (body.status === "resolved") updates.resolvedAt = new Date()

  const [updated] = await db.update(productionIssues).set(updates).where(eq(productionIssues.id, id)).returning()
  if (!updated) return NextResponse.json({ error: "Production issue not found" }, { status: 404 })

  return NextResponse.json({ id: updated.id, status: updated.status })
}
