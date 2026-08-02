# Priority 18b — Stage-0 Self-Serve VERI Chat Registration — Design Doc

Status: **design only, not implemented**. Written per CONTROLLER.yaml PRIORITY-18
`stage0_dispatch_2026_07_15`: get supervisor sign-off on this design before any
migration or code, since it touches the auth/user model. Do not implement off
this doc without that sign-off.

## 0. The actual ask (verbatim, Owner, 2026-07-15)

> "priority 18b, is that any one who is shared the VERI chat link, can register
> in the system as a user - stage 0 - which is unpaid user. no approval needed
> from any admin. If any organization and its user sends a message, to do etc
> to that stage 0 user, the stage 0 user can only see whats sent for him. As
> stage 0 user has already being validated by email ID / gmail / magic link
> etc, - its tracked what was sent by what user to which user. Objective -
> that VERI Chat will become the - tool for free advertisement as its usage
> grow - you can reevaluate and suggest."

This **supersedes** the earlier 18b design's provisioning mechanism (admin
invites a restricted seat, approval-gated) — this one is self-serve and viral:
anyone holding a shared VERI Chat link registers themselves, zero admin
approval. The earlier design's ACTION-level idea (a nav-visibility flag
separate from role rank, not overloading `client_viewer`/`external_auditor`)
is reused below where it still fits.

## 1. What already exists (read in full before designing, not assumed)

### 1.1 Guest-access token pattern — `src/lib/services/veri-chat-service.ts`
- `createGuestAccess()` (line 156) / `conversationGuestAccess` table
  (`schema.ts:4534`): an org member generates a token tied to ONE
  conversation, given a name/email, 7-day expiry. No account, no identity —
  `messages.senderId` stays `null`, `messages.guestAccessId` is what
  distinguishes a guest's message from VERI's own (`schema.ts:3245` comment).
- `getGuestConversation(token)` / `postGuestMessage(token, content)` (lines
  209, 239) are the **public, unauthenticated** read+write pair. Live UI:
  `src/app/guest-chat/[token]/page.tsx` — a chat box, "You're joining as
  {guestName}", no signup CTA today.
- `getSharedConversation(token)` (line 96) is the **read-only** counterpart
  for the wa.me/t.me share-out links (`conversationShareLinks`,
  `schema.ts:4514`) — this is the "share via WhatsApp/copy link" mechanism
  the Owner referenced as already built.
- Both public paths deliberately use the raw (RLS-bypassing) `db` export,
  with the token itself as the entire security boundary — documented in the
  file's own header comment (lines 89-95, 205-208) as "the legitimate,
  existing RLS-bypass path, not a new one." Stage-0's own public routes
  should follow this exact precedent, not invent a new bypass posture.

### 1.2 Admin-issued invite-link pattern — `src/lib/invite-link-service.ts`
This is the closest **structural** precedent for "join an existing org via a
link," even though its provisioning is admin-gated (an org admin calls
`createInviteLink()` first) — the opposite of what Owner is asking for now:
- `orgInviteLinks` row: `orgId`, `role` (one of `INVITE_ROLES`, line 41),
  `tokenHash` (SHA-256, raw token never persisted), `expiresAt`, `maxUses`,
  `useCount`.
- `consumeInviteLinkAndProvisionUser(token, authUser)` (line 182): validates
  the link, does one atomic `UPDATE ... RETURNING` to burn a use
  (race-safe), then inserts a real `users` row with `orgId: row.orgId,
  role: row.role, isActive: true` — **no separate accept step**, matching
  what stage-0 needs (immediate, no admin action after the token is
  created).
- Called from `auth-guard.ts`'s `autoProvisionUser()` (line 88) when
  `signUp()`'s metadata carries `inviteToken` — see 1.3.

### 1.3 Signup entry point — `src/lib/supabase/auth-guard.ts`
- `requireAuth()` (line 243) is the single gate every route calls. On a
  brand-new Supabase Auth identity with no `compliance.users` row,
  `autoProvisionUser(authUser)` (line 72) runs.
- It branches on `user_metadata` set at `signUp()`/`signInWithOtp()` time:
  `inviteToken` → join existing org via 1.2 (line 86); `orgJoinCode` → join
  via a typed code (line 114); otherwise → **create a brand-new org**
  (line 139, via `provisionOrganisation()`) and make the signer its admin.
  Also threads `ref`/`vid`/`vref` (lines 172-232) into the Sales
  Engine / Visitor Intelligence / VERI Reward referral mechanisms,
  **never blocking signup on failure** — same posture stage-0's own linkage
  should use.
- Critically: **there is no branch today that joins an existing org
  without either an invite token or a join code.** Stage-0 needs a new
  fourth branch — see §2.1.
- `src/app/signup/page.tsx` (line 107) shows exactly how `ref`/`vref`/
  `inviteToken`/`orgJoinCode` get threaded into `signUp()`'s
  `options.data` from a URL search param — the pattern to copy for a new
  `stage0Token` param.
- `src/app/login/login-form.tsx` (line 101) already calls
  `supabase.auth.signInWithOtp({ email, options: { emailRedirectTo } })` —
  real magic-link auth is live today, but with **no `options.data`**, so a
  brand-new email hitting this exact button would fall into the
  create-a-new-org branch above, not into any org-joining branch. Stage-0's
  own magic-link call must pass `options.data.stage0Token` explicitly (a
  new call site, not a reuse of this existing button) — see §2.1.
- `ROLE_RANK` (line 31): `client_viewer`/`external_auditor` both rank 1,
  same tier as `viewer`. **Confirmed directly in this file: `ROLE_RANK` and
  `hasRole()`/`requireRole()` gate ACTIONS only** (what a request is allowed
  to do), never which pages/nav render. Grepped `AppSidebar`/`AppShell` —
  no role-based nav branching exists anywhere; every logged-in user sees the
  identical sidebar. This independently confirms the prior 18b design's own
  finding (`CONTROLLER.yaml` PRIORITY-18
  `standalone_module_evaluation`, point 2) — not re-derived from memory,
  re-verified against the file directly. **A stage-0 "only see Chat"
  requirement needs a new, separate mechanism — role rank does not do it.**
- **Structural constraint, not previously flagged in the CONTROLLER.yaml
  supersedes-note**: `users.email` is `unique()` (`schema.ts:166`) and
  `users.orgId` is a single nullable `text` column (`schema.ts:172`) —
  there is **no membership join table** in this repo's own schema (grepped
  `schema.ts` for `memberships`/multi-org shape: zero matches — that pattern
  exists in the separate `projexa` repo, not here). **One email = exactly
  one `compliance.users` row = at most one org, today, full stop.** This
  directly bears on the Owner's own flagged-as-open multi-org question —
  see §2.6.

### 1.4 Referral / growth-loop mechanism — `src/lib/services/sales-engine-service.ts`
- `resolveReferralLinkAndRecordClick(linkToken)` (line 184): public, bumps
  `salesReferralLinks.clickCount`, inserts a `salesReferrals` row with
  `status: "clicked"`.
- `recordReferralSignupAndOrgProvisioned()` (line 204): called from
  `autoProvisionUser()` (`auth-guard.ts:178`) in the **same request** signup
  and org-creation happen in, resolves the most recent unclaimed `clicked`
  referral for that token and advances it to `org_provisioned`.
- `getPlatformSalesOverview()` (line 364) / `getPartnerDashboard()`
  (line 332): aggregate read models — `pipelineByStatus`,
  `liabilityByProduct`, `recentReferrals` — exactly the shape of "dashboard
  showing how many people joined via your links."
- This is structurally the same shape the Owner's "free advertisement" goal
  needs: click → attributed signup → aggregate counter. See §2.5 for the
  concrete recommendation.

## 2. Design

### 2.1 Provisioning — self-serve, off an existing shared link, no admin step

**New public page**: extend `src/app/guest-chat/[token]/page.tsx` (the
existing, already-public, already-linked-from-share-actions guest page) with
a second CTA next to "continue as guest": **"Sign up free (Stage 0)"**. This
is the natural landing spot — it's the page a shared VERI Chat link already
opens, and a guest already sees the org/conversation context before deciding.
`conversationShareLinks`' read-only page (`src/app/shared/conversation/[token]`)
gets the identical CTA for symmetry, since both are "someone shared this with
you" entry points.

**Flow**:
1. Visitor clicks "Sign up free" on either public page → a lightweight
   email-only form (no password field — passwordless by design, matching
   the Owner's "email ID / gmail / magic link" framing).
2. Client calls `supabase.auth.signInWithOtp({ email, options: { data:
   { stage0Token: token }, emailRedirectTo: '/auth/callback?next=/veri-chat' } })`.
   This is a **new call site** — not a reuse of `login-form.tsx`'s existing
   magic-link button, which passes no metadata (§1.3). Google OAuth
   (`signInWithOAuth`) is offered too, matching the Owner's "gmail" mention
   — same `stage0Token` needs to survive an OAuth redirect round-trip via
   the `next` param plus a short-lived signed cookie set before redirect
   (OAuth's `options.data` isn't guaranteed to be preserved the way
   `signUp`/`signInWithOtp` metadata is — needs verification against
   Supabase's actual OAuth metadata behavior during implementation, flagged
   honestly rather than assumed).
3. `/auth/callback` → `requireAuth()` → `autoProvisionUser()` gets a new
   **first-checked** branch (before the `inviteToken`/`orgJoinCode` checks,
   since a stage-0 signup is even more "not a full org member" than either
   of those): `meta.stage0Token` → `consumeStage0TokenAndProvisionUser()`
   (new function, `src/lib/stage0-service.ts`, mirroring
   `consumeInviteLinkAndProvisionUser()`'s exact shape: resolve token →
   validate not expired/revoked → insert `users` row → return). Same
   early-return-either-way posture as the invite/join-code branches (line
   90-127 of `auth-guard.ts`) — a bad/expired stage0 token must never
   silently fall through to "create me a brand new org."
4. **No approval step anywhere in this path** — this is the one deliberate,
   material difference from `consumeInviteLinkAndProvisionUser()`, which
   still requires an admin to have pre-created the `orgInviteLinks` row.
   Here, the token is the **already-existing** `conversationGuestAccess` /
   `conversationShareLinks` token an org member created for an entirely
   different reason (sharing a chat) — no new admin action is the whole
   point.

**Which existing token types are eligible**: both `conversationGuestAccess`
(write-capable, already has `guestEmail` collected — natural fit) and
`conversationShareLinks` (read-only share-out) resolve to a `conversationId`
→ `orgId`. Either is a valid "someone shared VERI Chat with me" on-ramp.

### 2.2 Data model — what's new vs. reused

**Reused, unchanged**: `conversationGuestAccess`, `conversationShareLinks`,
`conversations`, `conversationParticipants`, `messages`, `tasks`,
`instructionCommitments`, `users` (base shape).

**New**:
1. **`userRoleEnum` gains one value: `'stage_0'`.** Ranks alongside `viewer`/
   `client_viewer`/`external_auditor` in `ROLE_RANK` (rank 1) — reuses the
   existing lowest-tier action gating for free (a stage-0 user can never
   pass any `requireRole(..., 'member')`-or-higher check anywhere in the
   app, automatically, with zero new code). A **new** enum value rather than
   reusing `client_viewer`/`external_auditor`: those two already carry
   specific existing meaning in this codebase (client-facing / audit-facing
   restricted staff) and reusing them would make "is this an unpaid
   self-serve chat guest or a paying client's restricted staff viewer"
   unanswerable from the role column alone — a real ambiguity, not a
   style preference.
2. **`users.accountStage` — new nullable text column, default `null`**
   (`'full' | 'stage_0'`, free text per this codebase's own established
   convention of plain-text status columns that are still likely to grow —
   see `tasks.status`'s own comment, `schema.ts:1018`). This is the
   **nav-visibility axis**, deliberately separate from `role`/`ROLE_RANK`,
   carrying forward the earlier 18b design's own explicit decision
   (`CONTROLLER.yaml` PRIORITY-18 `standalone_module_suggestions`, point b,
   "new dedicated nav-visibility flag, separate from role rank" — no
   objection raised at the time). `AppSidebar`/`AppShell` gain one new
   check: `accountStage === 'stage_0'` → render only the Chat nav item,
   nothing else. Every other route's own `requireRole`/`requireAuth` checks
   are UNCHANGED — this is a client-side/nav-level restriction layered on
   top of, not a replacement for, real server-side scoping (§2.3 is the
   real security boundary, this column is UX only, stated plainly so it's
   not mistaken for enforcement).
3. **`stage0Sources` — new table, tracks provisioning + doubles as the
   growth-loop event (see §2.5, avoids building two parallel mechanisms)**:
   ```
   id, userId (FK users.id), orgId, sourceType ('guest_access' | 'share_link'),
   sourceTokenId (FK conversationGuestAccess.id or conversationShareLinks.id),
   sourceConversationId, joinedAt, revokedAt
   ```
   One row per stage-0 signup. `(userId, orgId)` should be unique-constrained
   — see §2.6 for why this is a real, not incidental, constraint given
   today's single-`orgId` `users` shape.
4. **No new message/content table.** The actual "what was sent" content
   already lives in `messages` — see §2.4.

### 2.3 Visibility scope — the real, narrow, auditable query predicate

The Owner's own words are explicit: "the stage 0 user can only see whats
sent for him" — **not** the org's general channels, even ones they're
nominally a participant of by side effect. Confirmed directly (§1.3) that
`client_viewer`/`external_auditor` do NOT provide this — they gate actions,
not visible content, so reusing their rank would not close this gap at all.

**New function** `listStage0Inbox(userId, orgId)` (new file,
`src/lib/services/stage0-service.ts`, alongside the provisioning function):
verifies an active `stage0Sources` row exists for `(userId, orgId)` (else
403 — this is the actual authorization check, not `accountStage`), then
unions exactly three sources, each already scoped by an explicit
`userId`-equals-them predicate that exists in the schema today:

1. **Direct messages**: reuses `chat-service.ts`'s existing
   `listConversations()` shape (`conversationParticipants.userId = them`,
   already correctly participant-scoped, `chat-service.ts:152-161`) —
   **with one added filter not present today: `conversations.type = 'direct'`
   only.** `type = 'group'` conversations are explicitly excluded even if
   the stage-0 user is a listed participant — this is the concrete fix for
   "not general channels, even if nominally a participant." A group/channel
   admin cannot make a stage-0 user's inbox broader than 1:1 correspondence
   by adding them to a group.
2. **Assigned to-dos**: `tasks` where `tasks.userId = them AND tasks.orgId
   = orgId` — the exact existing "assigned to me" primitive VERI To Do
   already uses (`schema.ts:1014`, `assignedById` distinguishes who sent
   it, `schema.ts:1023`).
3. **Assigned instructions**: `instructionCommitments` where
   `assigneeId = them AND orgId = orgId` — the exact existing explicit-
   assignment primitive `chat-service.ts` already writes on `isInstruction:
   true` messages (`schema.ts:3255-3267`). Note this repo has no literal
   `@mention` token-parsing mechanism anywhere (checked `chat-service.ts`
   directly) — `instructionCommitments.assigneeId` (an explicit field on
   the send action, not NLP-inferred) is the real existing equivalent to
   what the Owner called "@-mentions" in the superseded design's own
   framing, and is what this design reuses.

All three run inside `withTenantContext({ orgId, userId })` exactly like
every other tenant-scoped query in this codebase — RLS (`app_runtime`, no
bypass) is the actual enforcement layer, this function's own `WHERE`
clauses are the second, defense-in-depth layer, matching this codebase's
own stated posture (`tenant-scoped.ts:58-59`: "a forgotten `WHERE org_id =
...` in a route still gets filtered correctly").

**Posting**: a stage-0 user replying inside a direct conversation they're
already a real participant in is a completely ordinary `POST
/api/conversations/[id]/messages` call — no new write path needed, the
existing `requireAuth()` + `assertParticipant()` (`veri-chat-service.ts:21`)
checks already cover it correctly once they're a real `conversationParticipants`
row. They simply never see (and the UI/API for listing never offers) any
group conversation or org-wide view.

### 2.4 Tracking — who sent what to which stage-0 user

The Owner's ask ("its tracked what was sent by what user to which user") is
**already substantially satisfied by existing columns** — `messages.senderId`
+ `conversations.orgId` + `conversationParticipants` already record exactly
who sent what, to which conversation, in which org. **No new
per-message audit table is needed for content** — building one would
duplicate data that already exists, contradicting this codebase's own
"Zero duplication" precedent (Priority 13, cited repeatedly across this
file's own history).

What's genuinely new is the **index/view**, not the content: a read function
`listStage0OutreachForOrg(orgId)` (new, same file) that joins
`stage0Sources` (which users in this org are stage-0) against `messages` +
`conversationParticipants` to answer "which of our real users have messaged
which stage-0 users, and when" — an org-admin-facing audit view, not a new
ledger. This mirrors `getPartnerDashboard()`'s own read-model pattern
(§1.4) rather than inventing a new shape.

### 2.5 Growth-loop recommendation — direct comparison to Sales Engine

Structurally, a stage-0 signup off a shared VERI Chat link **is** a referral
event — same shape as `resolveReferralLinkAndRecordClick()` →
`recordReferralSignupAndOrgProvisioned()` (§1.4), just attributed to an org's
own share token instead of a sales partner's. **Recommendation: yes, emit a
trackable signal, reusing the click/conversion counter pattern rather than
copying Sales Engine's commission/partner machinery (which is genuinely
irrelevant here — there's no partner, no commission, no external sales
channel; this is organic, in-product virality).**

Concretely: `conversationGuestAccess`/`conversationShareLinks` gain a
`stage0SignupCount` counter (mirroring `salesReferralLinks.clickCount`'s
exact shape, `schema.ts` grep confirms that field's pattern), incremented by
`consumeStage0TokenAndProvisionUser()` the same way
`resolveReferralLinkAndRecordClick()` increments `clickCount`
(`sales-engine-service.ts:188`). Surface it in the existing `listShareLinks()`
/ `listGuestAccess()` responses (`veri-chat-service.ts:69, 176`) — a user who
shared a link already sees it in their own conversation's share-management
UI, so "N people joined via your shared links" needs **no new page**, just
one more field on data already being fetched. **This is the concrete
mechanism that makes the growth loop visible to the Owner**, not just a
passive side-effect — directly answering the Owner's own "make it advertising
visible" framing, per `CONTROLLER.yaml`'s dispatch note.

An org-wide rollup (`listStage0OutreachForOrg`'s aggregate cousin,
"organization X has gained N stage-0 users this month via M shared links")
is a natural Phase 2 addition to `/sales-hq`-style admin views, but is
**not required for v1** — flagged as a nice-to-have, not blocking.

### 2.6 Open question, flagged explicitly per the dispatch brief — NOT decided here

**Upgrade path, and multi-org membership.** The Owner asked this be flagged,
not silently resolved, and §1.3's structural finding makes it a real fork,
not a hypothetical:

- `users.email` is globally unique; `users.orgId` is a single column. Today,
  **one email can belong to at most one org, period** — this predates
  stage-0 entirely and isn't something this design should quietly change
  (blast radius: every route in this ~9,300-line schema assumes
  `requireAuth()`'s `orgId` is singular).
- **Option A (recommended for v1, matches today's schema exactly, zero
  blast radius):** a stage-0 signup still creates exactly one `users` row
  with a single `orgId` — same as every signup path today — via
  `consumeStage0TokenAndProvisionUser()` (§2.1). If a **second** org's
  shared link is later opened by the same email: reject provisioning a
  second `users` row (email already exists) and instead show "you already
  have a VERI Chat account — sign in" — the second org's conversation
  simply can't add them as a participant until they're independently
  invited into that org by whatever mechanism that org uses (their own
  stage-0 flow would need the same email, which collides). **This is a
  real, honest limitation of v1**: a stage-0 user genuinely cannot hold
  simultaneous stage-0 seats in two different orgs under Option A, which
  arguably undersells the Owner's own "as its usage grows" virality framing
  (someone popular across multiple client orgs' chats can't actually
  benefit from all of them).
- **Option B (matches the Owner's framing more fully, real schema work):**
  keep `users` as the auth-identity anchor but stop treating `orgId` as
  "membership" for stage-0 specifically — `stage0Sources` (§2.2, already
  designed with `(userId, orgId)` as its natural key) becomes a genuine
  one-to-many membership table for stage-0 relationships only, while
  `users.orgId`/`role` continues to mean "this person's one real, full-
  access home org" (nullable — a pure stage-0-only person may have none).
  `requireAuth()`'s `AuthContext.orgId` stays singular for everything
  else; a stage-0 user's Chat view becomes the one place in the app that
  is deliberately **not** single-org-scoped (§2.3's `listStage0Inbox`
  already takes an explicit `orgId` parameter rather than assuming
  `dbUser.orgId`, precisely so it can be called once per membership and the
  results merged in the UI — this was designed with Option B in mind even
  though Option A is the v1 recommendation).
- **Upgrade to a real (paid) member of the org that shared the link**: not
  specified by the Owner. Recommend it looks identical to today's existing
  admin-direct-add (`POST /api/users`) or invite-link redemption (§1.2) —
  an org admin simply invites the already-existing email through either
  existing mechanism, which naturally overwrites `orgId`/`role` on the same
  `users` row (no new "upgrade" code path needed) — **but this should be
  confirmed against `POST /api/users`'s actual behavior when the target
  email already has a `users` row before being treated as settled**, not
  assumed here.

Recommend the Owner/supervisor pick Option A vs. B explicitly before
implementation — this is exactly the kind of decision the dispatch brief
asked not be made silently.

> **DECIDED 2026-07-15 — see the "Addendum: Owner's Option B Decision"
> section at the end of this document.** The Owner picked Option B, plus 2
> additional real requirements (auto-upgrade, default signup rights). This
> section's own analysis above is left unedited as the reasoning trail; the
> addendum documents the decision and the concrete auto-upgrade mechanics
> built on top of it.

## 3. Multi-tenant safety

- **No org can see another org's stage-0 data.** `listStage0Inbox` and
  `listStage0OutreachForOrg` both take an explicit `orgId` and run inside
  `withTenantContext({ orgId, userId })` — the same `app_runtime` (non-RLS-
  bypassing) role every other tenant-scoped query in this codebase uses
  (`tenant-scoped.ts:58`). A stage-0 user querying their own inbox for
  `orgId: A` structurally cannot pull rows scoped to `orgId: B` — RLS
  enforces this at the database layer even if a route's own `WHERE` clause
  were buggy, per this file's own documented design intent.
- **A stage-0 user cannot escalate.** `role: 'stage_0'` ranks 1 in
  `ROLE_RANK` (§2.2) — every `requireRole(..., 'member')`-or-higher check
  anywhere in the app (hundreds of existing routes, zero new code needed)
  already rejects them. `accountStage` is UX-only (§2.2.2) and is not, and
  must never become, a security boundary on its own — stated explicitly so
  a future editor doesn't mistake a hidden nav item for an enforced
  restriction.
- **A stage-0 user cannot read group/channel content by being incidentally
  added as a participant** — §2.3's `type = 'direct'`-only filter is the
  specific, deliberate fix for this, not an incidental side effect of
  reusing `listConversations()` as-is.
- **The public token-consumption endpoint** (`consumeStage0TokenAndProvisionUser`)
  follows the existing `conversationGuestAccess`/`conversationShareLinks`
  precedent exactly: raw `db` client (no tenant context exists pre-signup,
  same rationale `auth-guard.ts`'s `autoProvisionUser` and
  `invite-link-service.ts`'s `previewInviteLink`/`consumeInviteLinkAndProvisionUser`
  already document), token itself is the entire security boundary, expired/
  revoked tokens fail closed (mirrors `evaluateInviteLinkStatus`'s ordering:
  revoked > expired > exhausted > valid).
- **No admin-approval gate is, by design, a real trust reduction versus
  every other org-join mechanism in this codebase** (invite links, join
  codes, and direct-add are all admin-initiated; stage-0 is not). This is
  the Owner's explicit, deliberate choice ("no approval needed from any
  admin") — flagged here so it's an acknowledged tradeoff, not an oversight:
  the mitigation is entirely in scope (§2.3) — a stage-0 account, however
  cheaply created, structurally cannot see or do anything beyond its own
  narrow inbox and its own replies.

## 4. Explicitly NOT designed/decided here

- Rate-limiting stage-0 signups off a single token (spam/abuse potential of
  "no approval needed" at scale) — flagged, not designed; likely a simple
  reuse of `conversationGuestAccess`'s existing `expiresAt`/revocation
  posture plus a per-token signup-count cap, but not specified.
- UI/UX of the stage-0-only nav (exact component changes to
  `AppSidebar`/`AppShell`) — implementation-level, deferred to the build
  pass.
- Whether OAuth (`signInWithOAuth`)'s metadata actually survives the
  redirect round-trip cleanly enough to carry `stage0Token` — flagged as
  needing verification in §2.1, not assumed.
- Option A vs. B (§2.6) — explicitly left for supervisor/Owner decision.

## 5. PLATFORM-01 interaction — re-verified live before writing this doc

Re-checked `ai-os/boss/ACTIVE-CLAIMS.yaml` on `origin/main` immediately
before starting (not from memory): **PLATFORM-01's Wave 2 active claim is
scoped to Workstreams 5+6 only (i18n + per-country compliance registry) and
explicitly states "Does NOT touch auth-guard.ts, apiKeys, or
platform_applications."** `CONTROLLER.yaml` PLATFORM-01's own
`wave_2_close_out` confirms Wave 2 already merged and closed 2026-07-15
(compliance-tracker#347, projexa#20) — **PLATFORM-01 is not currently
active on `auth-guard.ts` or `schema.ts`'s auth/membership shape.** This
design's one touch point on `auth-guard.ts` (a new branch in
`autoProvisionUser()`, §2.1) and `schema.ts` (one enum value, one nullable
column, one new table, §2.2) is clear to propose implementing once this
doc is signed off.

## Addendum: Owner's Option B Decision (2026-07-15) + Implementation Notes

`CONTROLLER.yaml` PRIORITY-18 `owner_decision_2026_07_15` (verbatim):

> Owner picked Option B (real multi-org stage-0 membership, not the
> single-org v1), with 2 additional real requirements: (1) auto-upgrade --
> when a stage-0 user, or the org they hold a stage-0 relationship with,
> "subscribes to the product/module", that specific relationship converts
> to a real full membership automatically, no separate re-invite step; (2)
> all users have stage-0 signup rights by default (i.e. sharing a link that
> grants stage-0 self-registration is not admin-gated) -- independently
> re-verified live against auth-guard.ts/veri-chat-service.ts before this
> note was written: createGuestAccess()/createShareLink() already call only
> requireAuth(), no requireRole() check exists on either route today, so
> this is already the codebase's real behavior, not a new permission to
> add.

### A.1 Option B, as actually built

Section 2.6 above already designed `stage0Sources` with `(userId, orgId)`
as its natural key "even though Option A is the v1 recommendation" -- that
design held up unchanged under Option B. What changed is only the
FRAMING: `stage0Sources` is not a bookkeeping-only table alongside a
single-org `users` row, it is the genuine multi-org membership table.
`users.orgId`/`role` stays the single "real, paid, full-access home org"
anchor (nullable -- a pure stage-0-only person has none); `stage0Sources` is
the separate, narrower, org-scoped read-axis, one row per `(userId, orgId)`
(partial-unique on active rows, so a revoked-then-rejoined relationship
doesn't collide -- see the migration). RLS on `stage0Sources` is
`org_id = compliance.current_org_id()`, identical to `org_invite_links`'
own policy -- a stage-0 relationship in org A structurally cannot leak into
a query scoped to org B, enforced at the database layer.

`listStage0Inbox(userId, orgId)` was already designed (2.3) to take an
explicit `orgId` rather than assume `dbUser.orgId` "precisely so it can be
called once per membership and the results merged in the UI" -- this is
exactly what the real implementation does: `GET /api/stage0/inbox` (new)
calls `listStage0OrgsForUser(userId)` to enumerate every org the caller has
an active `stage0Sources` row for, then calls `listStage0Inbox` once per
org and merges. This is the concrete realization of "the one place in the
app that is deliberately not single-org-scoped."

A real gap the original design didn't anticipate: `requireAuth()`'s
`orgId` is ALWAYS null for a pure stage-0 user (no real home org), so the
existing single-org `/api/conversations/[id]/messages` route (the one 2.3's
"Posting" note claimed "no new write path needed" for) is not actually
usable by a stage-0 user as written. Fixed with a dedicated
`/api/stage0/conversations/[id]/messages` route that resolves the
conversation's real `orgId` directly, checks the new
`assertActiveStage0Membership(userId, orgId)` guard, then delegates to
`chat-service.ts`'s existing `getMessages`/`sendMessage` unchanged -- no
message-handling logic was duplicated, only the org-resolution step differs
from the single-org route.

### A.2 Auto-upgrade Trigger A (person-level)

New shared helper `tryUpgradeStage0UserInPlace(email, { orgId, role,
authUserId? })` in `stage0-service.ts`, called from all 3 real "add an
already-existing email as a real member" paths, which previously all
assumed the email was brand new and would hit `users.email`'s UNIQUE
constraint on a stage-0 person's email:

- `invite-link-service.ts`'s `consumeInviteLinkAndProvisionUser`
- `org-join-code-service.ts`'s `redeemJoinCodeAndProvisionUser`
- `POST /api/users` (direct-add) -- additionally skips the
  `supabaseAdmin.auth.admin.inviteUserByEmail` step entirely for this case,
  since a stage-0 person already has a real Supabase Auth identity from
  their original magic-link signup; calling `inviteUserByEmail` again
  against an email Supabase Auth already knows would fail/duplicate.

The actual decision (`decideStage0UpgradeAction`, pure, unit-tested) is:
`users` row doesn't exist -> `not_found` (caller's original insert path,
unchanged); row exists with `orgId` already set -> `different_org`
(reject with a clear error, surfaced to the inviting admin -- never
silently reassign someone's real home org); row exists with `orgId IS
NULL` -> `upgrade` (same row, same id, in place -- `orgId`/`role` set,
`accountStage` cleared to `null`, 5 AI Assistants provisioned if this is
their first time as a real member).

### A.3 Auto-upgrade Trigger B (org-level)

Hooked into `product-branch-service.ts`'s `enableProductBranchForOrg` --
confirmed via grep to be the single real chokepoint every `enable*ForOrg`
wrapper in this codebase routes through
(erp/pms/construction/crm/firm/fm/veri_chat_v2/veri_reward-enablement-
service.ts), so it fires no matter which vertical's paid branch gets
enabled, present or future, without editing 9 separate files. The other 3
real `orgProductBranchEnablements` insert call sites
(`org-provisioning-service.ts`'s VERI Reward/VERI Chat v2 auto-enable,
`POST /api/v1/platform/provision-org`'s required-branches insert) all fire
at brand-new-org-creation time -- structurally impossible to have
pre-existing `stage0Sources` rows for an org that didn't exist yet, so
correctly left un-hooked.

`autoUpgradeStage0UsersOnBranchEnable(orgId)` (new, `stage0-service.ts`):
finds every active `stage0Sources` row for this org, partitions the
candidate users (`partitionEligibleForAutoUpgrade`, pure, unit-tested) into
`orgId IS NULL` (eligible -> `role: 'member'`, the safe default) vs `orgId
NOT NULL` (blocked -> left completely untouched, their stage-0 access into
this org keeps working exactly as before). Never blocks the branch-enable
call on failure (try/catch, matches `org-provisioning-service.ts`'s own
"never blocks" posture for its VERI Reward/VERI Chat v2 auto-enable).

Admin-facing surface (judgment call, not fully specified by the brief):
`enableProductBranchForOrg`'s return value gained one additive field,
`stage0AutoUpgrade: { upgraded, blocked }`. The 2 real, live enable-branch
UI call sites in this codebase (`PmsEnablementSection.tsx`,
`the-firm-practice/page.tsx`) already `NextResponse.json(result)` the whole
result through with zero route change needed -- both gained 2 toasts
reading that field: "N stage-0 users auto-upgraded to full membership" and
"M stage-0 users could not auto-upgrade -- already belong to another
organization" (only shown when each count is > 0). The 6 other
`enable*ForOrg` wrappers (erp/construction/crm/fm/veri_chat_v2/veri_reward)
have zero route callers today (confirmed by grep, same finding the Sales
Engine channel audit independently made 2026-07-14) -- those org-branch
enablements are applied as one-off DB writes via Supabase MCP, not through
the app's own UI, so there is no live UI surface to wire a toast into for
them; the `stage0AutoUpgrade` field is still returned by the shared
function itself and will surface automatically the moment any of those
verticals gets a real enable route.

### A.4 Default signup rights (requirement 2) -- confirmed, not built

Re-verified directly against `veri-chat-service.ts` before writing any
code: `createGuestAccess()` (line 156) and `createShareLink()` (line 58)
both call only `assertParticipant()` -- no `requireRole()`/`hasRole()`
check exists on either function, nor on the 2 routes that call them
(`/api/veri-chat/conversations/[id]/guest-access`,
`/api/veri-chat/conversations/[id]/share-links`, both `requireAuth()`-only).
This was already true before this implementation pass and remains true
after it -- no code change was needed or made for this requirement; it is
confirmed here as the honesty check the Owner's own note asked for
("independently re-verified live... so this is already the codebase's real
behavior, not a new permission to add").

### A.5 Growth-loop counter (design doc 2.5) -- built as designed

`conversationGuestAccess.stage0SignupCount` /
`conversationShareLinks.stage0SignupCount` (both new, `integer default 0`)
increment inside `consumeStage0TokenAndProvisionUser` only when a
genuinely new (or reactivated-after-revoke) `stage0Sources` relationship is
formed -- a re-visit by an already-joined user doesn't double-count.
Surfaced for free via `listShareLinks()`/`listGuestAccess()` (Drizzle's
`findMany` already returns every column) -- no route change needed, exactly
as 2.5 anticipated.

### A.6 Migration -- not applied live

`drizzle/0209_user_role_stage_0.sql` (the `'stage_0'` enum value alone, its
own transaction per this repo's established `ALTER TYPE ... ADD VALUE`
precedent) and `drizzle/0210_priority18b_stage0_optionb.sql` (`users.
account_stage`, `stage0_sources` table + RLS + indexes,
`stage0_signup_count` on both existing token tables) were written following
this repo's additive-migration conventions (nullable/defaulted columns, `IF
NOT EXISTS` throughout) but NOT applied to the live Supabase database --
left for the supervising session's schema-change-review + live-migration
step, per this repo's own standing convention for schema-touching PRs.
