import { NextResponse } from "next/server"
import { requireAuth } from "@/lib/supabase/auth-guard"
import { listMyTodos } from "@/lib/services/task-service"

export async function GET() {
  const { response, dbUser, orgId } = await requireAuth()
  if (response) return response
  if (!orgId || !dbUser) return NextResponse.json({ tasks: [] })

  try {
    const result = await listMyTodos({ orgId, userId: dbUser.id })
    return NextResponse.json(result)
  } catch (error) {
    console.error("Home todos error:", error)
    return NextResponse.json({ error: "Failed to fetch to-do items" }, { status: 500 })
  }
}
