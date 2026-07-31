// Task #47 (PM feature-parity gap analysis): tests the real
// social-feed-service.ts functions against a fake drizzle-shaped db, same
// "mock only @/lib/db/tenant-scoped's withTenantContext, exercise the real
// service code path, capture real modules and restore in afterEach"
// convention as construction-reports-service.test.ts /
// tenant-isolation.test.ts (no live DB, no mock.module() leaking into other
// test files sharing this bun test process).
/// <reference types="bun-types" />
import { describe, expect, test, mock, afterEach } from "bun:test"
import { ServiceError } from "./compliance-service"

const realTenantScoped = await import("@/lib/db/tenant-scoped")

function insertResult(rows: unknown[]) {
  const p = Promise.resolve(rows) as Promise<unknown[]> & { returning: () => Promise<unknown[]> }
  p.returning = async () => rows
  return p
}

async function withFakeDb(fakeDb: unknown) {
  await mock.module("@/lib/db/tenant-scoped", () => ({
    ...realTenantScoped,
    withTenantContext: mock(async (_ctx: { orgId: string }, fn: (db: unknown) => Promise<unknown>) => fn(fakeDb)),
  }))
}

afterEach(async () => {
  mock.restore()
  await mock.module("@/lib/db/tenant-scoped", () => realTenantScoped)
})

describe("createPost", () => {
  test("rejects an empty body without touching the DB", async () => {
    const { createPost } = await import("./social-feed-service")
    await expect(createPost({ orgId: "org-1", userId: "u1" }, { body: "   " })).rejects.toThrow(ServiceError)
  })

  test("rejects a restricted post with no audience members, without touching the DB", async () => {
    const { createPost } = await import("./social-feed-service")
    await expect(
      createPost({ orgId: "org-1", userId: "u1" }, { body: "hello", audienceType: "restricted", audienceUserIds: [] })
    ).rejects.toThrow(ServiceError)
  })

  test("creates an org-audience broadcast post", async () => {
    await withFakeDb({
      insert: mock(() => ({
        values: mock((vals: Record<string, unknown>) => insertResult([{ id: "post-1", createdAt: new Date(), updatedAt: new Date(), ...vals }])),
      })),
    })
    const { createPost } = await import("./social-feed-service")
    const result = await createPost({ orgId: "org-1", userId: "author-1" }, { body: "Hello team", projectId: "proj-1" })
    expect(result).toMatchObject({ id: "post-1", orgId: "org-1", authorId: "author-1", body: "Hello team", projectId: "proj-1", audienceType: "org" })
  })

  test("creates a restricted post and inserts one postAudienceMembers row per valid member", async () => {
    const insertedAudienceRows: unknown[] = []
    await withFakeDb({
      query: {
        users: { findMany: mock(async () => [{ id: "u2" }, { id: "u3" }]) },
      },
      insert: mock(() => ({
        values: mock((vals: unknown) => {
          if (Array.isArray(vals)) {
            insertedAudienceRows.push(...vals)
            return insertResult(vals)
          }
          return insertResult([{ id: "post-1", ...(vals as Record<string, unknown>) }])
        }),
      })),
    })
    const { createPost } = await import("./social-feed-service")
    const result = await createPost(
      { orgId: "org-1", userId: "u1" },
      { body: "Restricted update", audienceType: "restricted", audienceUserIds: ["u2", "u3", "u2"] } // dupe collapsed
    )
    expect(result.audienceType).toBe("restricted")
    expect(insertedAudienceRows).toEqual([
      { postId: "post-1", userId: "u2" },
      { postId: "post-1", userId: "u3" },
    ])
  })

  test("rejects a restricted post whose audience includes a user outside the org, and never inserts the post", async () => {
    const insertValues = mock(() => insertResult([]))
    await withFakeDb({
      query: {
        // only u2 is a real org member -- u3 is not, matching request below
        users: { findMany: mock(async () => [{ id: "u2" }]) },
      },
      insert: mock(() => ({ values: insertValues })),
    })
    const { createPost } = await import("./social-feed-service")
    await expect(
      createPost({ orgId: "org-1", userId: "u1" }, { body: "x", audienceType: "restricted", audienceUserIds: ["u2", "u3"] })
    ).rejects.toThrow(ServiceError)
    expect(insertValues).not.toHaveBeenCalled()
  })
})

describe("listFeed -- audience scoping", () => {
  test("org-wide posts are visible to everyone; a restricted post is visible only to its explicit audience members, not the whole org", async () => {
    const ORG_ID = "org-1"
    const orgPost = { id: "p-org", orgId: ORG_ID, authorId: "author-1", audienceType: "org", createdAt: new Date() }
    const includedPost = { id: "p-in", orgId: ORG_ID, authorId: "author-1", audienceType: "restricted", createdAt: new Date() }
    const excludedPost = { id: "p-out", orgId: ORG_ID, authorId: "author-1", audienceType: "restricted", createdAt: new Date() }

    await withFakeDb({
      query: {
        // viewer-1 is an explicit audience member of p-in only
        postAudienceMembers: { findMany: mock(async () => [{ postId: "p-in" }]) },
        posts: { findMany: mock(async () => [orgPost, includedPost, excludedPost]) },
        postReactions: { findMany: mock(async () => []) },
        postComments: { findMany: mock(async () => []) },
      },
    })
    const { listFeed } = await import("./social-feed-service")
    const result = await listFeed({ orgId: ORG_ID, userId: "viewer-1" })
    expect(result.map((p) => p.id).sort()).toEqual(["p-in", "p-org"])
  })

  test("a post's own author can always see their restricted post even without an explicit audience row", async () => {
    const ORG_ID = "org-1"
    const authoredRestricted = { id: "p-mine", orgId: ORG_ID, authorId: "author-1", audienceType: "restricted", createdAt: new Date() }

    await withFakeDb({
      query: {
        postAudienceMembers: { findMany: mock(async () => []) }, // author never added themself as a member row
        posts: { findMany: mock(async () => [authoredRestricted]) },
        postReactions: { findMany: mock(async () => []) },
        postComments: { findMany: mock(async () => []) },
      },
    })
    const { listFeed } = await import("./social-feed-service")
    const result = await listFeed({ orgId: ORG_ID, userId: "author-1" })
    expect(result.map((p) => p.id)).toEqual(["p-mine"])
  })

  test("reaction counts are grouped by the fixed reaction-type enum and the viewer's own reaction is surfaced separately", async () => {
    const ORG_ID = "org-1"
    const post = { id: "p-1", orgId: ORG_ID, authorId: "author-1", audienceType: "org", createdAt: new Date() }
    await withFakeDb({
      query: {
        postAudienceMembers: { findMany: mock(async () => []) },
        posts: { findMany: mock(async () => [post]) },
        postReactions: {
          findMany: mock(async () => [
            { id: "r1", postId: "p-1", userId: "viewer-1", reactionType: "like" },
            { id: "r2", postId: "p-1", userId: "someone-else", reactionType: "like" },
            { id: "r3", postId: "p-1", userId: "third-user", reactionType: "celebrate" },
          ]),
        },
        postComments: { findMany: mock(async () => [{ id: "c1", postId: "p-1" }]) },
      },
    })
    const { listFeed } = await import("./social-feed-service")
    const [result] = await listFeed({ orgId: ORG_ID, userId: "viewer-1" })
    expect(result.reactionCounts).toEqual({ like: 2, celebrate: 1 })
    expect(result.myReaction).toBe("like")
    expect(result.commentCount).toBe(1)
  })
})

describe("post visibility gate -- reactToPost/addPostComment/listPostComments (audience-scoping enforcement)", () => {
  test("a user outside a restricted post's audience gets 404, not a silently-filtered response", async () => {
    const post = { id: "p-1", orgId: "org-1", authorId: "author-1", audienceType: "restricted" }
    await withFakeDb({
      query: {
        posts: { findFirst: mock(async () => post) },
        postAudienceMembers: { findFirst: mock(async () => undefined) },
      },
    })
    const { reactToPost } = await import("./social-feed-service")
    await expect(reactToPost({ orgId: "org-1", userId: "outsider" }, "p-1", "like")).rejects.toMatchObject({ status: 404 })
  })

  test("an explicit audience member can comment on a restricted post", async () => {
    const post = { id: "p-1", orgId: "org-1", authorId: "author-1", audienceType: "restricted" }
    await withFakeDb({
      query: {
        posts: { findFirst: mock(async () => post) },
        postAudienceMembers: { findFirst: mock(async () => ({ id: "m1", postId: "p-1", userId: "member-1" })) },
      },
      insert: mock(() => ({
        values: mock((vals: Record<string, unknown>) => insertResult([{ id: "comment-1", ...vals }])),
      })),
    })
    const { addPostComment } = await import("./social-feed-service")
    const result = await addPostComment({ orgId: "org-1", userId: "member-1" }, "p-1", "Nice work")
    expect(result).toMatchObject({ id: "comment-1", postId: "p-1", authorId: "member-1", content: "Nice work" })
  })

  test("a post from a different org 404s even when the id matches -- org boundary is checked before audience", async () => {
    const post = { id: "p-1", orgId: "org-1", authorId: "author-1", audienceType: "org" }
    await withFakeDb({ query: { posts: { findFirst: mock(async () => post) } } })
    const { listPostComments } = await import("./social-feed-service")
    await expect(listPostComments({ orgId: "org-2", userId: "someone" }, "p-1")).rejects.toMatchObject({ status: 404 })
  })
})

describe("reactToPost -- fixed-enum toggle/replace semantics", () => {
  test("rejects a reaction type outside the fixed enum, without touching the DB", async () => {
    const { reactToPost } = await import("./social-feed-service")
    await expect(
      reactToPost({ orgId: "org-1", userId: "u1" }, "p-1", "love" as unknown as "like")
    ).rejects.toThrow(ServiceError)
  })

  test("insert on first react, toggle off on repeating the same reaction, switch on a different reaction", async () => {
    const post = { id: "p-1", orgId: "org-1", authorId: "author-1", audienceType: "org" }
    let currentReaction: { id: string; reactionType: string } | null = null

    await withFakeDb({
      query: {
        posts: { findFirst: mock(async () => post) },
        postReactions: { findFirst: mock(async () => currentReaction) },
      },
      insert: mock(() => ({
        values: mock((vals: { reactionType: string }) => {
          currentReaction = { id: "reaction-1", reactionType: vals.reactionType }
          return insertResult([currentReaction])
        }),
      })),
      update: mock(() => ({
        set: mock((vals: { reactionType: string }) => ({
          where: mock(async () => {
            currentReaction = currentReaction ? { ...currentReaction, ...vals } : null
          }),
        })),
      })),
      delete: mock(() => ({
        where: mock(async () => {
          currentReaction = null
        }),
      })),
    })

    const { reactToPost } = await import("./social-feed-service")
    const ctx = { orgId: "org-1", userId: "viewer-1" }

    const r1 = await reactToPost(ctx, "p-1", "like")
    expect(r1).toEqual({ reacted: true, reactionType: "like" })
    expect(currentReaction).toEqual({ id: "reaction-1", reactionType: "like" })

    const r2 = await reactToPost(ctx, "p-1", "like")
    expect(r2).toEqual({ reacted: false, reactionType: null })
    expect(currentReaction).toBeNull()

    const r3 = await reactToPost(ctx, "p-1", "celebrate")
    expect(r3).toEqual({ reacted: true, reactionType: "celebrate" })

    const r4 = await reactToPost(ctx, "p-1", "support")
    expect(r4).toEqual({ reacted: true, reactionType: "support" })
    expect(currentReaction).toEqual({ id: "reaction-1", reactionType: "support" })
  })
})
