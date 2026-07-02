import { comments, auditLogs, complianceItems } from "@/lib/db"
import { withTenantContext } from "@/lib/db/tenant-scoped"
import { NextRequest, NextResponse } from "next/server"
import { eq } from "drizzle-orm"
import { requireAuth } from "@/lib/supabase/auth-guard"
import { createId } from "@paralleldrive/cuid2"
import { notifyNewComment } from "@/lib/email"

type RouteContext = { params: Promise<{ id: string }> }

export async function POST(request: NextRequest, context: RouteContext) {
  const { response, dbUser, orgId } = await requireAuth()
  if (response) return response
  if (!dbUser || !orgId) return NextResponse.json({ error: "No organisation on this account" }, { status: 400 })

  try {
    const { id } = await context.params
    const { content } = await request.json()
    if (!content || typeof content !== 'string' || !content.trim()) {
      return NextResponse.json({ error: 'Content is required' }, { status: 400 })
    }

    const result = await withTenantContext({ orgId }, async (db) => {
      // RLS-filtered -- returns null if the item belongs to another org,
      // not just if it doesn't exist (previously commenting on any org's
      // compliance item was possible just by knowing its id).
      const item = await db.query.complianceItems.findFirst({
        where: eq(complianceItems.id, id),
        with: { assignedTo: { columns: { name: true, email: true } } },
      })
      if (!item) return null

      const newComment = await db.insert(comments).values({
        id: createId(),
        content: content.trim(),
        // entityId/entityType are the generic polymorphic reference (NOT
        // NULL, no default beyond entityType='compliance') -- complianceItemId
        // is a newer, more specific FK that coexists with it. This insert
        // previously only set complianceItemId, leaving entityId unset and
        // throwing a NOT-NULL violation on every real comment.
        entityId: id,
        complianceItemId: id,
        authorId: dbUser.id,
        createdAt: new Date(),
      }).returning()

      await db.insert(auditLogs).values({
        id: createId(),
        action: 'update',
        entityType: 'ComplianceItem',
        entityId: id,
        userId: dbUser.id,
        details: 'Comment added',
        createdAt: new Date(),
      })

      if (item.assignedTo?.email && item.assignedTo.email !== dbUser.email) {
        notifyNewComment(item.assignedTo.email, item.assignedTo.name, dbUser.name, item.title, id, content.trim()).catch(() => {})
      }

      return newComment[0]
    })

    if (!result) return NextResponse.json({ error: "Compliance item not found" }, { status: 404 })

    return NextResponse.json({
      id: result.id,
      content: result.content,
      author: { name: dbUser.name, avatarUrl: dbUser.avatarUrl },
      createdAt: result.createdAt.toISOString(),
    })
  } catch (error) {
    console.error('Comment POST error:', error)
    return NextResponse.json({ error: 'Failed to add comment' }, { status: 500 })
  }
}
