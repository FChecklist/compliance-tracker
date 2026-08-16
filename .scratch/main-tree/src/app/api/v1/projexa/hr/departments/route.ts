// Priority 15 (PROJEXA HR & Payroll, full-depth pass): department roster,
// needed for the employee directory's department filter + the HR dashboard's
// headcount-by-department rollup. No dedicated department SERVICE module
// exists anywhere in this codebase (the platform's own /api/departments
// route -- session-auth only, see that file -- has always queried
// `departments` directly rather than through a service layer; this mirrors
// that exact existing query/insert shape 1:1, just re-authenticated via
// requireAuthOrApiKey so PROJEXA's Bearer-key client can reach it). No new
// business rule is introduced here.
import { NextRequest, NextResponse } from "next/server"
import { requireAuthOrApiKey, requireRoleOrScope } from "@/lib/supabase/auth-guard"
import { departments, organisations } from "@/lib/db"
import { withTenantContext } from "@/lib/db/tenant-scoped"
import { eq, asc } from "drizzle-orm"
import { logActivity } from "@/lib/audit"
import { createId } from "@paralleldrive/cuid2"

export async function GET(request: NextRequest) {
  const ctx = await requireAuthOrApiKey(request)
  if (ctx.response) return ctx.response
  if (!ctx.orgId) return NextResponse.json({ departments: [] })

  try {
    const depts = await withTenantContext({ orgId: ctx.orgId }, (db) =>
      db.query.departments.findMany({
        with: { head: { columns: { name: true } }, users: { columns: { id: true } } },
        orderBy: asc(departments.name),
      })
    )
    return NextResponse.json({
      departments: depts.map((d) => ({
        id: d.id, name: d.name, description: d.description,
        headName: d.head?.name ?? null, memberCount: d.users.length,
      })),
    })
  } catch (error) {
    console.error("v1 projexa hr departments list error:", error)
    return NextResponse.json({ error: "Failed to fetch departments" }, { status: 500 })
  }
}

export async function POST(request: NextRequest) {
  const ctx = await requireAuthOrApiKey(request)
  if (ctx.response) return ctx.response
  const roleErr = requireRoleOrScope(ctx, "manager", "write")
  if (roleErr) return roleErr
  if (!ctx.orgId) return NextResponse.json({ error: "No organisation on this account" }, { status: 400 })
  if (!ctx.dbUser) return NextResponse.json({ error: "This action requires a real user session, not an API key" }, { status: 400 })

  try {
    const { name, description } = await request.json()
    if (!name || typeof name !== "string" || !name.trim()) {
      return NextResponse.json({ error: "name is required" }, { status: 400 })
    }
    const orgIdLocal = ctx.orgId
    const dbUser = ctx.dbUser
    const created = await withTenantContext({ orgId: orgIdLocal, userId: dbUser.id }, async (db) => {
      const org = await db.query.organisations.findFirst({ where: eq(organisations.id, orgIdLocal) })
      if (!org) return null
      const [inserted] = await db.insert(departments).values({
        id: createId(), name: name.trim(), description: description?.trim() || null, orgId: org.id,
      }).returning()
      await logActivity({ tx: db, action: "create", entityType: "Department", entityId: inserted.id, details: `Created department: ${inserted.name}`, orgId: orgIdLocal, dbUser, request })
      return inserted
    })
    if (!created) return NextResponse.json({ error: "No organisation found" }, { status: 500 })
    return NextResponse.json(created, { status: 201 })
  } catch (error) {
    console.error("v1 projexa hr department create error:", error)
    return NextResponse.json({ error: "Failed to create department" }, { status: 500 })
  }
}
