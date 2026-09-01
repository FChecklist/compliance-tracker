// Task #47 (PM feature-parity gap analysis): genuine broadcast/react social
// feed. Reply-threads (compliance-service.ts's comments route) and private
// messaging (chat-service.ts) already existed -- this is the missing third
// piece. Reuses chat-service.ts's ServiceError + withTenantContext
// conventions rather than inventing a new error/context shape.
import { posts, postAudienceMembers, postReactions, postComments, users } from "@/lib/db"
import { withTenantContext, type TenantDb } from "@/lib/db/tenant-scoped"
import { eq, and, inArray, desc, asc } from "drizzle-orm"
import { ServiceError } from "./compliance-service"
export { ServiceError }

export type FeedContext = { orgId: string; userId: string }

// Fixed, small reaction taxonomy -- matches the real Postgres enum
// (post_reaction_type) in the migration, not free text.
export const POST_REACTION_TYPES = ["like", "celebrate", "support", "insightful", "curious"] as const
export type PostReactionType = (typeof POST_REACTION_TYPES)[number]

export type PostAudienceType = "org" | "restricted"

export type CreatePostInput = {
  body: string
  projectId?: string | null
  taskId?: string | null
  audienceType?: PostAudienceType
  audienceUserIds?: string[]
}

async function assertPostVisible(db: TenantDb, ctx: FeedContext, post: typeof posts.$inferSelect | undefined) {
  // 404, not 403, on both "doesn't exist" and "exists but not visible to
  // you" -- deliberately doesn't leak the existence of a restricted post to
  // someone outside its audience.
  if (!post || post.orgId !== ctx.orgId) throw new ServiceError("Post not found", 404)
  if (post.audienceType === "org") return post
  if (post.authorId === ctx.userId) return post
  const membership = await db.query.postAudienceMembers.findFirst({
    where: and(eq(postAudienceMembers.postId, post.id), eq(postAudienceMembers.userId, ctx.userId)),
  })
  if (!membership) throw new ServiceError("Post not found", 404)
  return post
}

export async function createPost(ctx: FeedContext, input: CreatePostInput) {
  const body = input.body?.trim()
  if (!body) throw new ServiceError("Post body is required", 400)

  const audienceType: PostAudienceType = input.audienceType ?? "org"
  const memberIds = Array.from(new Set((input.audienceUserIds ?? []).filter(Boolean)))
  if (audienceType === "restricted" && memberIds.length === 0) {
    throw new ServiceError("A restricted post requires at least one audience member", 400)
  }

  return withTenantContext({ orgId: ctx.orgId, userId: ctx.userId }, async (db) => {
    if (audienceType === "restricted") {
      const validUsers = await db.query.users.findMany({
        where: and(inArray(users.id, memberIds), eq(users.orgId, ctx.orgId)),
        columns: { id: true },
      })
      if (validUsers.length !== memberIds.length) {
        throw new ServiceError("One or more audience members are not in this organisation", 400)
      }
    }

    const [post] = await db
      .insert(posts)
      .values({
        orgId: ctx.orgId,
        authorId: ctx.userId,
        body,
        projectId: input.projectId ?? null,
        taskId: input.taskId ?? null,
        audienceType,
      })
      .returning()

    if (audienceType === "restricted") {
      await db.insert(postAudienceMembers).values(memberIds.map((userId) => ({ postId: post.id, userId })))
    }

    return post
  })
}

export async function listFeed(ctx: FeedContext, opts?: { projectId?: string; taskId?: string }) {
  return withTenantContext({ orgId: ctx.orgId, userId: ctx.userId }, async (db) => {
    const myMemberships = await db.query.postAudienceMembers.findMany({
      where: eq(postAudienceMembers.userId, ctx.userId),
      columns: { postId: true },
    })
    const visibleRestrictedIds = new Set(myMemberships.map((m) => m.postId))

    const filters = [eq(posts.orgId, ctx.orgId)]
    if (opts?.projectId) filters.push(eq(posts.projectId, opts.projectId))
    if (opts?.taskId) filters.push(eq(posts.taskId, opts.taskId))

    const orgScopedPosts = await db.query.posts.findMany({
      where: and(...filters),
      orderBy: desc(posts.createdAt),
    })

    // Audience scoping: 'org' posts are visible to anyone in the org; a
    // 'restricted' post is visible only to its author or an explicit
    // postAudienceMembers row -- everything else the query above returned
    // (someone else's restricted post) is filtered out here, not just
    // hidden in the UI.
    const visiblePosts = orgScopedPosts.filter(
      (post) => post.audienceType === "org" || post.authorId === ctx.userId || visibleRestrictedIds.has(post.id)
    )

    const postIds = visiblePosts.map((p) => p.id)
    const [allReactions, allComments] = postIds.length
      ? await Promise.all([
          db.query.postReactions.findMany({ where: inArray(postReactions.postId, postIds) }),
          db.query.postComments.findMany({ where: inArray(postComments.postId, postIds), columns: { id: true, postId: true } }),
        ])
      : [[], []]

    return visiblePosts.map((post) => {
      const reactions = allReactions.filter((r) => r.postId === post.id)
      const reactionCounts: Partial<Record<PostReactionType, number>> = {}
      for (const r of reactions) {
        reactionCounts[r.reactionType] = (reactionCounts[r.reactionType] ?? 0) + 1
      }
      const myReaction = reactions.find((r) => r.userId === ctx.userId)?.reactionType ?? null
      const commentCount = allComments.filter((c) => c.postId === post.id).length

      return { ...post, reactionCounts, myReaction, commentCount }
    })
  })
}

// Toggle/replace semantics: reacting again with the same type removes it;
// reacting with a different type replaces it. Never more than one row per
// (postId, userId) -- matches the migration's unique constraint.
export async function reactToPost(ctx: FeedContext, postId: string, reactionType: PostReactionType) {
  if (!POST_REACTION_TYPES.includes(reactionType)) {
    throw new ServiceError("Invalid reaction type", 400)
  }

  return withTenantContext({ orgId: ctx.orgId, userId: ctx.userId }, async (db) => {
    const post = await db.query.posts.findFirst({ where: eq(posts.id, postId) })
    await assertPostVisible(db, ctx, post)

    const existing = await db.query.postReactions.findFirst({
      where: and(eq(postReactions.postId, postId), eq(postReactions.userId, ctx.userId)),
    })

    if (existing && existing.reactionType === reactionType) {
      await db.delete(postReactions).where(eq(postReactions.id, existing.id))
      return { reacted: false, reactionType: null as PostReactionType | null }
    }
    if (existing) {
      await db.update(postReactions).set({ reactionType }).where(eq(postReactions.id, existing.id))
      return { reacted: true, reactionType }
    }
    await db.insert(postReactions).values({ postId, userId: ctx.userId, reactionType })
    return { reacted: true, reactionType }
  })
}

export async function addPostComment(ctx: FeedContext, postId: string, content: string) {
  const trimmed = content?.trim()
  if (!trimmed) throw new ServiceError("Comment content is required", 400)

  return withTenantContext({ orgId: ctx.orgId, userId: ctx.userId }, async (db) => {
    const post = await db.query.posts.findFirst({ where: eq(posts.id, postId) })
    await assertPostVisible(db, ctx, post)

    const [comment] = await db
      .insert(postComments)
      .values({ postId, authorId: ctx.userId, content: trimmed })
      .returning()
    return comment
  })
}

export async function listPostComments(ctx: FeedContext, postId: string) {
  return withTenantContext({ orgId: ctx.orgId, userId: ctx.userId }, async (db) => {
    const post = await db.query.posts.findFirst({ where: eq(posts.id, postId) })
    await assertPostVisible(db, ctx, post)

    return db.query.postComments.findMany({
      where: eq(postComments.postId, postId),
      orderBy: asc(postComments.createdAt),
    })
  })
}
