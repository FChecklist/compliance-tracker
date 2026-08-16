import { NextResponse } from "next/server"
import { requireAuth } from "@/lib/supabase/auth-guard"
import { listVeriTodos } from "@/lib/services/veri-todo-service"

// Was calling task-service.ts's older listMyTodos() (bare `tasks` table
// only) -- a confirmed live gap, since listVeriTodos() (unions tasks +
// instructionCommitments + pmsIssues) exists specifically to fix this and
// just wasn't wired at Home's own call site. ToDoTab.tsx adapted to match
// this route's real {items: [...]} shape.
export async function GET() {
  const { response, dbUser, orgId } = await requireAuth()
  if (response) return response
  if (!orgId || !dbUser) return NextResponse.json({ items: [] })

  try {
    const result = await listVeriTodos({ orgId, userId: dbUser.id })
    return NextResponse.json(result)
  } catch (error) {
    console.error("Home todos error:", error)
    return NextResponse.json({ error: "Failed to fetch to-do items" }, { status: 500 })
  }
}
