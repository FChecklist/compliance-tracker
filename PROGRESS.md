# PROGRESS -- task-20260731-044029-pm--social-collaboration-feed

## Completed
- [x] Read AGENTS.md/CLAUDE.md governance chain and ai-os/boss/ACTIVE-CLAIMS.yaml protocol
- [x] Fetched origin/main fresh (already at HEAD 11db691a), confirmed next-free migration
      number by reading drizzle/meta/_journal.json (279 entries) + `ls drizzle/*.sql` sorted
      -- next free prefix is 0302 (0301 is the current highest real file).
- [x] Surveyed existing reply-thread (`comments` table, polymorphic entityType/entityId,
      route-only logic) and private-messaging (`conversations`/`conversationParticipants`/
      `messages`, chat-service.ts + ServiceError, explicit-join-table audience/participant
      model) constructs via a research subagent -- confirmed no existing reaction/like/emoji
      precedent anywhere in the codebase (genuinely new enum, not reusing one).
- [x] Confirmed hand-written-migration convention (drizzle-kit generate untrustworthy per
      0268/0269's own header notes) and exact SQL shape from
      0269_construction_progress_claims_workflow.sql (real Postgres CREATE TYPE ... AS ENUM
      + CREATE TABLE + indexes + RLS app_runtime_tenant_isolation/service_role_bypass
      policies).
- [x] Registered claim in ai-os/boss/ACTIVE-CLAIMS.yaml, committed + pushed on its own
      (commit 77361e1b) before any real code, per Rule 11.
- [x] Design decided: `posts` (org-scoped broadcast, author, body, optional
      projectId/taskId, audienceType 'org'|'restricted'), `postAudienceMembers` (explicit
      join table for 'restricted' audience, same shape as conversationParticipants),
      `postReactions` (real fixed Postgres enum post_reaction_type, unique per user+post,
      toggle semantics), `postComments` (reuses the comments reply-thread shape, scoped to
      postId instead of polymorphic entityType/entityId since posts are one new entity
      type).

## Remaining
- [ ] Schema additions in src/lib/db/schema.ts (enums, 4 tables, relations)
- [ ] Hand-written migration drizzle/0302_social_feed.sql + drizzle/meta/_journal.json entry
- [ ] Service layer src/lib/services/social-feed-service.ts (createPost, listFeed,
      reactToPost, addPostComment, listPostComments, audience-visibility enforcement)
- [ ] API routes: src/app/api/social/posts/route.ts,
      src/app/api/social/posts/[id]/reactions/route.ts,
      src/app/api/social/posts/[id]/comments/route.ts
- [ ] Tests: src/lib/services/social-feed-service.test.ts (post creation, reactions incl.
      toggle, audience-scoping -- restricted-post visibility for author/member vs
      non-member 404)
- [ ] `npx tsc --noEmit` clean
- [ ] `bun test` on new/touched test file(s) -- 0 failures
- [ ] Open PR (do not merge, do not self-audit)
- [ ] Append KERNEL_CONSOLIDATION_STATUS.md Task #47 line with PR number
