import { comments, tasks, notifications } from "@/lib/db"
import { withTenantContext } from "@/lib/db/tenant-scoped"
import { NextRequest, NextResponse } from "next/server"
import { eq, and, asc } from "drizzle-orm"
import { requireAuth } from "@/lib/supabase/auth-guard"
import { logActivity } from "@/lib/audit"
import { createId } from "@paralleldrive/cuid2"

type RouteContext = { params: Promise<{ id: string }> }

// Area 14 (Common functionalities) gap-close: `comments` (schema.ts) was
// already polymorphic -- entityId/entityType, NOT NULL, default
// entityType='compliance' -- but the only route that ever wrote or read it
// was src/app/api/compliance/[id]/comments/route.ts (POST only, and reads
// came for free via getComplianceItem()'s `with: { comments }` relation,
// which is FK-bound to complianceItemId specifically). Tasks has no such
// relation, so this route talks to entityId/entityType directly instead of
// through a drizzle relation -- no schema change needed, both GET and POST.
export async function GET(request: NextRequest, context: RouteContext) {
  const { response, orgId } = await requireAuth()
  if (response) return response
  if (!orgId) return NextResponse.json({ comments: [] })

  try {
    const { id } = await context.params
    const rows = await withTenantContext({ orgId }, async (db) => {
      const task = await db.query.tasks.findFirst({ where: eq(tasks.id, id) })
      if (!task) return null

      return db.query.comments.findMany({
        where: and(eq(comments.entityType, "task"), eq(comments.entityId, id)),
        orderBy: asc(comments.createdAt),
        with: { author: { columns: { name: true, avatarUrl: true } } },
      })
    })

    if (rows === null) return NextResponse.json({ error: "Task not found" }, { status: 404 })

    return NextResponse.json({
      comments: rows.map((c) => ({
        id: c.id,
        content: c.content,
        author: { name: c.author?.name ?? "Unknown", avatarUrl: c.author?.avatarUrl ?? null },
        createdAt: c.createdAt.toISOString(),
      })),
    })
  } catch (error) {
    console.error("Task comments GET error:", error)
    return NextResponse.json({ error: "Failed to fetch comments" }, { status: 500 })
  }
}

export async function POST(request: NextRequest, context: RouteContext) {
  const { response, dbUser, orgId } = await requireAuth()
  if (response) return response
  if (!dbUser || !orgId) return NextResponse.json({ error: "No organisation on this account" }, { status: 400 })

  try {
    const { id } = await context.params
    const { content } = await request.json()
    if (!content || typeof content !== "string" || !content.trim()) {
      return NextResponse.json({ error: "Content is required" }, { status: 400 })
    }

    const result = await withTenantContext({ orgId, userId: dbUser.id }, async (db) => {
      const task = await db.query.tasks.findFirst({ where: eq(tasks.id, id) })
      if (!task) return null

      const [newComment] = await db.insert(comments).values({
        id: createId(),
        content: content.trim(),
        entityId: id,
        entityType: "task",
        authorId: dbUser.id,
        createdAt: new Date(),
      }).returning()

      await logActivity({
        tx: db,
        action: "update",
        entityType: "Task",
        entityId: id,
        details: "Comment added",
        orgId,
        clientId: task.clientId,
        dbUser,
        request,
      })

      // In-app notification for the task's owner/assignee, mirroring the
      // "don't notify yourself" rule the compliance comments route already
      // applies via email -- this path uses the real notifications table
      // instead since tasks has no per-item email template today.
      if (task.userId && task.userId !== dbUser.id) {
        await db.insert(notifications).values({
          userId: task.userId,
          title: "New comment on your task",
          message: `${dbUser.name} commented on "${task.title}": ${content.trim().slice(0, 140)}`,
          type: "comment",
          metadata: { taskId: id },
        })
      }

      return newComment
    })

    if (!result) return NextResponse.json({ error: "Task not found" }, { status: 404 })

    return NextResponse.json({
      id: result.id,
      content: result.content,
      author: { name: dbUser.name, avatarUrl: dbUser.avatarUrl },
      createdAt: result.createdAt.toISOString(),
    }, { status: 201 })
  } catch (error) {
    console.error("Task comments POST error:", error)
    return NextResponse.json({ error: "Failed to add comment" }, { status: 500 })
  }
}
