import { NextRequest, NextResponse } from "next/server"
import { requireAuth } from "@/lib/supabase/auth-guard"
import { createPost, listFeed, ServiceError } from "@/lib/services/social-feed-service"

export async function GET(request: NextRequest) {
  const { response, dbUser, orgId } = await requireAuth()
  if (response) return response
  if (!orgId || !dbUser) return NextResponse.json({ posts: [] })

  try {
    const { searchParams } = new URL(request.url)
    const projectId = searchParams.get("projectId") ?? undefined
    const taskId = searchParams.get("taskId") ?? undefined
    const result = await listFeed({ orgId, userId: dbUser.id }, { projectId, taskId })
    return NextResponse.json({ posts: result })
  } catch (error) {
    if (error instanceof ServiceError) return NextResponse.json({ error: error.message }, { status: error.status })
    console.error("Feed list error:", error)
    return NextResponse.json({ error: "Failed to fetch feed" }, { status: 500 })
  }
}

export async function POST(request: NextRequest) {
  const { response, dbUser, orgId } = await requireAuth()
  if (response) return response
  if (!orgId || !dbUser) return NextResponse.json({ error: "No organisation found" }, { status: 400 })

  try {
    const body = await request.json()
    const result = await createPost({ orgId, userId: dbUser.id }, body)
    return NextResponse.json(result, { status: 201 })
  } catch (error) {
    if (error instanceof ServiceError) return NextResponse.json({ error: error.message }, { status: error.status })
    console.error("Post create error:", error)
    return NextResponse.json({ error: "Failed to create post" }, { status: 500 })
  }
}
