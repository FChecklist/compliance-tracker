import { NextResponse } from "next/server"
import { requireAuth } from "@/lib/supabase/auth-guard"
import { listVeriTodos } from "@/lib/services/veri-todo-service"

export async function GET() {
  const { response, dbUser, orgId } = await requireAuth()
  if (response) return response
  if (!orgId || !dbUser) return NextResponse.json({ items: [] })

  try {
    const result = await listVeriTodos({ orgId, userId: dbUser.id })
    return NextResponse.json(result)
  } catch (error) {
    console.error("VERI To Do error:", error)
    return NextResponse.json({ error: "Failed to fetch pending work" }, { status: 500 })
  }
}
