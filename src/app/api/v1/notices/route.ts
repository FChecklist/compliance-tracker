import { NextRequest, NextResponse } from "next/server"
import { requireAuthOrApiKey, requireRoleOrScope } from "@/lib/supabase/auth-guard"
import { listNotices, createNotice, ServiceError } from "@/lib/services/notice-service"

export async function GET(request: NextRequest) {
  const ctx = await requireAuthOrApiKey(request)
  if (ctx.response) return ctx.response
  if (!ctx.orgId) return NextResponse.json({ notices: [], total: 0, page: 1, limit: 20, totalPages: 0 })

  try {
    const { searchParams } = request.nextUrl
    const result = await listNotices({ orgId: ctx.orgId }, {
      search: searchParams.get("search") ?? undefined,
      status: searchParams.get("status") ?? undefined,
      departmentId: searchParams.get("departmentId") ?? undefined,
      page: Number(searchParams.get("page")) || undefined,
      limit: Number(searchParams.get("limit")) || undefined,
    })
    return NextResponse.json(result)
  } catch (error) {
    console.error("v1 notices list error:", error)
    return NextResponse.json({ error: "Failed to fetch notices" }, { status: 500 })
  }
}

export async function POST(request: NextRequest) {
  const ctx = await requireAuthOrApiKey(request)
  if (ctx.response) return ctx.response
  const roleErr = requireRoleOrScope(ctx, "member", "write")
  if (roleErr) return roleErr
  if (!ctx.orgId) return NextResponse.json({ error: "No organisation on this account" }, { status: 400 })

  try {
    const body = await request.json()
    const result = await createNotice(
      { orgId: ctx.orgId, actor: ctx.dbUser ? { dbUser: ctx.dbUser } : { apiKey: ctx.apiKey! }, request },
      body
    )
    return NextResponse.json(result, { status: 201 })
  } catch (error) {
    if (error instanceof ServiceError) return NextResponse.json({ error: error.message }, { status: error.status })
    console.error("v1 notices create error:", error)
    return NextResponse.json({ error: "Failed to create notice" }, { status: 500 })
  }
}
