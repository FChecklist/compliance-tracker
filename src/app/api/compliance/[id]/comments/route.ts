import { db, comments, users, auditLogs, complianceItems } from "@/lib/db"
import { NextRequest, NextResponse } from "next/server"
import { eq } from "drizzle-orm"
import { requireAuth } from "@/lib/supabase/auth-guard"
import { createId } from "@paralleldrive/cuid2"
import { notifyNewComment } from "@/lib/email"

type RouteContext = { params: Promise<{ id: string }> }

export async function POST(request: NextRequest, context: RouteContext) {
  const { response, dbUser } = await requireAuth()
  if (response) return response
  try {
    const { id } = await context.params
    const { content } = await request.json()
    if (!content || typeof content !== 'string' || !content.trim()) {
      return NextResponse.json({ error: 'Content is required' }, { status: 400 })
    }

    const author = dbUser ?? await db.query.users.findFirst({ where: eq(users.role, 'admin') })
    if (!author) return NextResponse.json({ error: 'No user found' }, { status: 500 })

    const newComment = await db.insert(comments).values({
      id: createId(),
      content: content.trim(),
      complianceItemId: id,
      authorId: author.id,
      createdAt: new Date(),
      updatedAt: new Date(),
    }).returning()

    await db.insert(auditLogs).values({
      id: createId(),
      action: 'update',
      entityType: 'ComplianceItem',
      entityId: id,
      userId: author.id,
      details: 'Comment added',
      createdAt: new Date(),
    })

    // Notify the compliance item's assignee about the new comment (if different from author)
    try {
      const item = await db.query.complianceItems.findFirst({
        where: eq(complianceItems.id, id),
        with: { assignedTo: { columns: { name: true, email: true } } },
      })
      if (item?.assignedTo?.email && item.assignedTo.email !== author.email) {
        notifyNewComment(item.assignedTo.email, item.assignedTo.name, author.name, item.title, id, content.trim()).catch(() => {})
      }
    } catch {}

    return NextResponse.json({
      id: newComment[0].id,
      content: newComment[0].content,
      author: { name: author.name, avatarUrl: author.avatarUrl },
      createdAt: newComment[0].createdAt.toISOString(),
    })
  } catch (error) {
    console.error('Comment POST error:', error)
    return NextResponse.json({ error: 'Failed to add comment' }, { status: 500 })
  }
}
