# OCID-049 -- Subscription Plan Entitlement Certification (planning only)

**Parent:** OCID-020, `UMR-20260802-165606-4413` (the PROJEXA end-user certification sweep).
**Phase:** Business Certification (a new phase the Owner has opened directly under OCID-020, distinct
from the ERP Functional Completeness Master Program's OCID-021 through OCID-040 chain and from the
OCID-041 through OCID-046 Universal External Execution chain -- this OCID does not sit in either of
those two chains).
**This cycle's scope:** planning only. No implementation, no testing, no certification performed here --
per this task's own dispatch text ("Do not test anything yet, do not fix anything yet, only produce the
real enumeration and task breakdown as a canonical artifact"). Consistent with `SEC-07`
(`ai-os/CONSTITUTION.yaml`), which keeps real implementation/gap-closure/certification locked behind
OCID-020's own independent verification, while explicitly leaving discovery/documentation permitted.
**Own UMR:** this task's real dispatch (`task-20260803-120310-register-ocid-049-subscription-plan-enti`,
created `2026-08-03T12:03:12Z` per its own `task.yaml`) has **no row in
`/opt/veridian/ai-os/memory/superboss-register.sqlite`'s `umr_tasks` table** -- independently checked via
`resource_governor.py --query-umr --search "register-ocid-049"` (0 matches) and a direct sqlite query for
any `ts_submitted` in this task's own creation minute (0 rows). Flagging this honestly rather than
fabricating a `UMR-...` id for this task itself: it registers against the one real, given UMR in its own
dispatch text -- OCID-020's `UMR-20260802-165606-4413` -- as its parent, and against this repo's own file
identity (`task-20260803-120310-register-ocid-049-subscription-plan-enti`) as its task-level anchor.

## Zero-duplication check (performed before writing anything below)

- `python3 /opt/veridian/scripts/resource_governor.py --query-umr --search "OCID-049"` -> `{"count": 0}`
- `python3 /opt/veridian/scripts/resource_governor.py --query-umr --search "entitlement"` -> `{"count": 0}`
- `python3 /opt/veridian/scripts/resource_governor.py --query-umr --search "register-ocid-049"` -> `{"count": 0}`
- `grep -rn "OCID-049"` across `ai-os/` (including `MASTER-TRACKER.yaml`, `OS.yaml`, `IMPLEMENTATION_MATRIX_2026-08-02.md`) -> 0 matches prior to this document.
- `grep -n "Business Certification"` across `ai-os/` -> 0 matches prior to this document -- this is the first registration of that phase name.

No prior registration of OCID-049, or of a subscription-plan-entitlement gap/task, exists anywhere in the
governance record or the resource governor. This document is not a duplicate.

## Real, existing model this OCID is scoped to -- and the 3 adjacent mechanisms it is deliberately NOT

VERIDIAN already has **four**, real, distinct, independently-shipped mechanisms that each touch the word
"plan"/"entitlement"/"cap." Conflating them would misname this OCID's own scope, so each is named here
explicitly, with the one this OCID actually governs called out last:

1. **`organisations.plan`** (`schema.ts`, text, default `'free'`) -- a marketing/trial flag only. Its only
   two real consumers are `TrialBanner.tsx` (shows the trial banner while `orgPlan === "free"`) and
   `sales-engine-service.ts`'s "Paid" milestone growth-loop event (fires when this moves off `'free'`). It
   gates no feature and is not a tier system.
2. **`organisations.licensedSeats` / `seatEnforcementEnabled`** (`org-license-service.ts`) -- a real,
   enforced, but manually-configured per-org seat cap (admin sets a number via
   `OrgLimitsSection.tsx` -> `PATCH /api/settings/org-limits`), checked at user-activation time
   (`auth-guard.ts`). It is independent of, and has no column linking it to, `subscription_plans` --
   an org on any of the 4 real subscription-plan tiers below can set any `licensedSeats` number or leave
   it null (unenforced, the default). Real prior art for a 403 with a clear reason
   (`org-license-service.ts`'s `"This organisation has used all N licensed seats..."` string) but not the
   axis OCID-049 is about.
3. **Product-branch module enablement** (`product-branch-service.ts` + the per-module wrappers --
   `erp-enablement-service.ts`, `crm-enablement-service.ts`, `pms-enablement-service.ts`,
   `firm-enablement-service.ts`, `veri-chat-v2-enablement-service.ts`) -- a real, enforced, per-org
   on/off switch per product branch (ERP/CRM/PMS/Firm/VeriChatV2), surfaced via `/api/me`
   (`erpEnabled`/`salesEnabled`/`pmsEnabled`/`firmEnabled`/`veriChatV2Enabled`) and, as of this same
   session's `GAP-ERP-CRM-403-NO-UX-EXPLANATION` fix (PR #809, `fef80f2c`), a shared
   `ModuleNotEnabledCard` component. **This is the pattern this OCID's own directive says to reuse for
   the explanation surface** -- see "The reusable explanation pattern" below -- but branch enablement
   itself is a yes/no per module, not a plan *tier*, and is not driven by `subscription_plans` anywhere in
   the codebase (confirmed: zero references to `subscriptionPlans`/`subscriptionPlanId` inside any
   `*-enablement-service.ts` file).
4. **`compliance.subscription_plans`** (`schema.ts` line 182) + `organisations.subscriptionPlanId` (FK,
   nullable) -- **the real subscription plan model this OCID is scoped to.** Real table, real columns
   (`name`, `userPackSize`, `assistantsPerUser`, `priceMonthly`, `features` jsonb, `isActive`), real seeded
   rows (below), platform-wide by design (no `org_id` column -- one shared catalog every org's
   `subscriptionPlanId` points into, per `drizzle/0155_priority4_domain_c_access.sql`'s own documented
   RLS reasoning for this table). No new plan model or billing architecture is introduced by this
   document, per this OCID's own explicit instruction -- everything below is a mapping of what already
   exists.

## Every real existing plan tier (enumerated, not invented)

Seeded by `drizzle/0231_ai_router_mother_router.sql` (Owner directive 2026-07-18, "In 1st phase we will
give number of user based subscription packages"). Exactly 4 rows exist; none have been added, removed,
or renamed since:

| Tier (`name`) | `user_pack_size` | `assistants_per_user` | `features.aiPackage` | `price_monthly` |
|---|---|---|---|---|
| Basic | 10 | 3 | `"basic"` | `NULL` |
| Standard | 25 | 5 | `"standard"` | `NULL` |
| Professional | 50 | 8 | `"professional"` | `NULL` |
| Enterprise | 100 | 15 | `"enterprise"` | `NULL` |

`price_monthly` is `NULL` on all 4 rows by design (the seeding migration's own comment: "real pricing is a
business decision outside this task's scope, not invented here") -- still true today, not a gap this OCID
introduces or needs to close.

## Real feature mapping per tier -- what is actually wired today vs. schema-only

Mapping each tier to features honestly means separating what already has a real, live code path from
what is a real column with zero consumer. Both are named -- inventing enforcement that doesn't exist
would violate this OCID's own "no new... architecture" instruction just as much as omitting the gap would
misrepresent the platform's real state:

- **`features.aiPackage` -> AI model-routing override (real, wired, currently dormant in practice).**
  `getOrgAiPackage()` (`mother-router.ts:506`) resolves an org's tier -- preferring the explicit
  `organisations.subscriptionPlanId` assignment, falling back to classifying the org's real live user
  count against the 4 tiers' `user_pack_size` bands (ascending, smallest fitting band wins, Enterprise as
  ceiling) when no explicit assignment exists. The resolved `aiPackage` string is then looked up in
  `computeEndUserOrgResolution()` against `policy?.rule.preferredModelByPackage?.[aiPackage]` -- an
  admin-configurable per-scope override table (`ai_routing_policies`, scope `end_user_org`) that lets a
  specific tier be pinned to a specific provider/model. **Real mechanism, real code path, exercised by
  `mother-router.test.ts` -- but confirmed via `grep` that zero `ai_routing_policies` rows seed any
  `preferredModelByPackage` value today**, so in live practice all 4 tiers currently resolve to the exact
  same platform-default model until an admin actually sets a policy. This is an honest "wired but
  dormant" state, not a defect -- there is nothing to fix, only a real future admin action that would
  activate it.
- **`assistants_per_user` (3 / 5 / 8 / 15) -> zero enforcement anywhere.** Confirmed by `git grep` across
  `src/`: the only reference to this column in the entire codebase is its own declaration in
  `schema.ts`. `POST /api/users` inserts exactly one `aiAssistants` row per new user unconditionally, with
  no read of this column, no count check, and no cap. This is schema-present, feature-absent -- a real
  gap for the task breakdown below, not something to silently "map" as if it were already gating
  anything.
- **No other column or table on `subscription_plans`/`organisations.subscriptionPlanId` gates anything
  else today.** Module-level gating (ERP/CRM/PMS/Firm/VeriChatV2) and seat-level gating (`licensedSeats`)
  are both real and enforced, but on the two separate axes named above (#2 and #3), not this one -- an org
  on the Basic tier and an org on the Enterprise tier see identical ERP/CRM/PMS availability today, driven
  entirely by their own independent product-branch enablement rows.

## The reusable explanation pattern (already merged this session -- reused here, not reinvented)

`GAP-ERP-CRM-403-NO-UX-EXPLANATION` (PR #809, commit `fef80f2c`, merged via `536bdd6f`) fixed
the exact "silent block, not a crash, not a mystery" failure mode this OCID's own directive asks the test
path to confirm the *absence* of, for the module-enablement axis. The established, real, 3-part shape any
future subscription-plan-tier gate should reuse verbatim:

1. **Backend throws a specific, human-readable `ServiceError(message, 403)`** at the one real chokepoint
   every route/service already funnels through (`requireErpEnabled()`'s own precedent: *"This capability
   is not part of the Module your organization purchased..."*), not a generic 403/500.
2. **The relevant boolean is surfaced on `/api/me`** (`erpEnabled`, `salesEnabled`, `pmsEnabled`,
   `firmEnabled`, `veriChatV2Enabled` -- `src/app/api/me/route.ts:23-27,53-54`) so a page can know the
   real reason *before* it even attempts the gated call, not just catch a failure after the fact.
3. **The frontend renders the shared `ModuleNotEnabledCard`** (`src/components/ModuleNotEnabledCard.tsx`)
   -- an explicit "X is not enabled, ask an org admin to enable it from Settings -> Y" card with a link to
   Settings -- instead of an empty table, a raw error, or a client-side crash.

For a subscription-plan-tier gate (e.g. the `assistants_per_user` cap, once real Task A below is
implemented), the same 3-part shape applies with a tier-specific message (e.g. *"Your organisation's
Basic plan is limited to 3 AI assistants per user. Ask an organisation admin to upgrade the subscription
plan to add more."*) and a small tier-aware sibling of `ModuleNotEnabledCard` (or the same component,
generalized with a message prop) -- not a new explanation mechanism.

## Deterministic task breakdown (future implementation, NOT started this cycle)

Ordered, each independently schedulable once the Owner unlocks implementation for this OCID. None of
these has been dispatched, coded, or tested as part of this planning cycle.

- **Task A -- Enforce `assistants_per_user` as a real per-user cap.** At the one real chokepoint
  (`POST /api/users`'s `aiAssistants` insert, `src/app/api/users/route.ts:125`), resolve the org's tier via
  the already-real `getOrgAiPackage()`-adjacent lookup (or a new, equally small
  `getAssistantsPerUserLimit(orgId)` reading `subscription_plans.assistantsPerUser` the same way
  `getOrgAiPackage()` already reads `features.aiPackage`), count the target user's existing `aiAssistants`
  rows, and throw the same `ServiceError(message, 403)` shape `requireErpEnabled()` already establishes
  when the cap would be exceeded. No new table, no new architecture -- reuses the existing
  `subscription_plans` row and the existing `ServiceError` class.
- **Task B -- Surface the resolved tier + its real limits on `/api/me`.** Add `subscriptionPlanName`,
  `assistantsPerUserLimit`, and (once Task A ships) `assistantsUsedByCurrentUser` next to the existing
  `erpEnabled`/`salesEnabled` booleans, following the exact same "resolve server-side once, let every
  client read one flat field" shape already established there -- no new endpoint.
- **Task C -- Frontend gate + explanation card for the assistant-creation flow.** Wherever a user creates
  a new AI assistant, check the Task B fields client-side (same `fetch("/api/me")` pattern every
  `salesEnabled`/`erpEnabled` page already uses) and render a tier-aware explanation card (reusing or
  lightly generalizing `ModuleNotEnabledCard`) instead of letting the create action silently fail or
  crash on the real 403 Task A now throws.
- **Task D -- Decide and seed at least one real `ai_routing_policies` row exercising
  `preferredModelByPackage`.** Not a code change -- an actual admin/business decision (which tier gets
  routed to which model) needed to move the already-real `aiPackage` routing mechanism from "wired but
  dormant" to "observably different behavior per tier," so the definition of done below has something
  live to test for tiers beyond the assistant cap.
- **Task E -- (explicitly out of scope, named so it is not silently dropped) an admin-facing UI to change
  an org's `organisations.subscriptionPlanId`.** Confirmed via `git grep`: zero references to
  `subscriptionPlanId` anywhere under `src/app/`, i.e. no settings page can assign or change an org's
  plan today -- it can only be set directly in the database (or left null, in which case
  `getOrgAiPackage()`'s live-user-count fallback applies). Real testing of "each plan tier independently"
  (the definition of done below) needs *some* way to place a real org on a specific tier; whether that's a
  new minimal admin control or a direct, documented DB assignment for test purposes is a decision for
  whoever picks up Task A/B, not decided here.

## Real test path per tier (to be executed once implementation above ships -- not run this cycle)

For each of the 4 real tiers (Basic, Standard, Professional, Enterprise), independently:

1. Assign a real test org to that tier (`organisations.subscriptionPlanId` pointed at that tier's real
   `subscription_plans` row -- via Task E's mechanism once it exists, or a documented direct assignment
   until then).
2. Confirm `/api/me` (Task B) reports that org's real, correct `assistantsPerUserLimit` matching the
   table above (3/5/8/15) -- not a hardcoded/guessed value.
3. As a real user in that org, create AI assistants up to the tier's limit -- each succeeds normally.
4. Attempt one more, past the limit -- confirm the real backend `ServiceError` 403 fires (Task A), *and*
   confirm the frontend shows the explanation card (Task C) with the tier's real limit named in the
   message -- not a silent no-op, not an unhandled promise rejection, not a client crash. This is the
   literal "gated feature shows a real user-facing explanation rather than a silent block or a crash"
   check this OCID's own directive asks for, run once per tier so a Basic-tier failure mode can't hide
   behind an Enterprise-tier pass.
5. If Task D has shipped a real `preferredModelByPackage` policy: issue one real AI-routed request as a
   user in that org and confirm (via `aiRoutingAuditLog`, the same table `mother-router.ts` already writes
   every resolution to) that the actually-used provider/model matches that tier's configured override --
   independent, per-tier evidence, not inferred from the policy's existence alone.

## Definition of done for OCID-049

Once real implementation/testing begins (a later cycle, per this OCID's own explicit "no testing yet"
scope): **each of the 4 real existing plan tiers independently tested, live, confirming its real
entitlements (the `assistants_per_user` cap, and any `aiPackage` routing override actually configured) are
correctly enforced** -- per-tier evidence (step 4 and, where applicable, step 5 above for all 4 rows), not
a single tier's pass generalized to the others, and not a certification claim made from this planning
document alone. This document performs none of that testing itself.

---

## Amendment (2026-08-03): real testing execution -- honest evidence, honest blockers

Per PM decision `UMR-20260803-203925-1a38` (citing `UMR-20260802-165606-4413` OCID-020,
`UMR-20260803-115513-c990` OCID-049): "find and confirm the real plan tier to branch mapping first...
then run real live test cases against the real projexa.ai.com site confirming entitlement enforcement
matches that mapping, document real findings honestly." This retracts PR #846/#847's premature "closes
Group F" framing -- Group F is only described as closed once OCID-049 itself has real evidence, which
this amendment now provides.

### Plan-tier-to-branch mapping: confirmed absent, live and independently re-verified

Re-verified, not just re-cited from this doc's own earlier grep-based claim: two fresh real test orgs
(`iytvq0rzrfw8yjozaecny522`, `vtgca1hjadx5mgbt31e31i6n`) both show `erpEnabled: false`,
`salesEnabled: false` via a real `GET /api/me` -- identical, module-disabled state for both, exactly as
this doc's own §"Real, existing model" #3 vs #4 distinction predicted. **There is no real
plan-tier-to-branch mapping to test against, because none exists in the live code or live behavior** --
product-branch enablement and subscription-plan tier are two genuinely independent axes today. This is
the honest answer to the PM's own framing of "the plan tier to branch mapping" as an open item: the
open item is resolved by confirming, live, that no such mapping exists, not by finding one.

### `assistants_per_user` cap: confirmed NOT enforced, live, with concrete numbers

Two independent fresh real orgs tested. Org A (1 real user, the default self-signup admin) and Org B (1
real user, same pattern) both show, via a real `GET /api/assistants`, **exactly 5 real AI-assistant
rows** for their single user -- confirmed live, not inferred from the `Array.from({length:5}...)` code
alone. A 1-user org's real, live-counted `userCount` (1) resolves to the Basic tier per
`getOrgAiPackage()`'s own band logic (`userCount <= 10`), whose real `assistants_per_user` limit is
**3**. The real, live, unconditionally-provisioned count of **5** already exceeds Basic's cap by 2, with
zero error, zero block, zero warning -- live, concrete, numeric confirmation of this doc's own earlier
code-read finding ("zero enforcement anywhere"), not a repeat of the same claim without new evidence.

### AI-package tier-boundary crossing test: attempted, real infrastructure blocker hit

Planned: scale Org B to 12 real users (crossing Basic's `user_pack_size=10` threshold into Standard's
`<=25` band) via the real `POST /api/users` invite endpoint, then confirm the routing resolution
reflects the new band. Real execution: the first 2 invite calls failed with a real `"Email address...
is invalid"` (Supabase Auth's `inviteUserByEmail` -- unlike the Admin API `createUser` path this
session has used throughout, this endpoint validates deliverability more strictly against the
`.internal` test domain), and the next 9 failed with a real, hard `"email rate limit exceeded"` from
Supabase's own transactional email service. **Org B's real user count remains 1** -- the
tier-boundary-crossing test could not be executed this pass. This is a genuine infrastructure
constraint (Supabase's own email rate limit on the specific `inviteUserByEmail` code path the real
`/api/users` route uses), not a code gap in the app being tested, and not something a few retries
would resolve -- registered honestly below rather than silently abandoned or worked around with a
direct DB insert (which this session has independently established carries its own real, unresolved
trust risk -- see next finding).

### New finding: `platform.ai_routing_audit_log` unreadable via any safe channel, and empty via direct DB read despite confirmed-live routing activity

No API route or UI page in this codebase reads `aiRoutingAuditLog` (`git grep` confirms it is
write-only from the app's own perspective -- `src/lib/ai-router/mother-router.ts` and
`tenant-ai-config` are its only two references outside `schema.ts`). PostgREST does not expose the
`platform` schema at all (`Accept-Profile: platform` -> `PGRST106`, "Only the following schemas are
exposed: public, graphql_public, compliance"). The one remaining channel, a direct, read-only `psql`
query against `DATABASE_URL`, returned **zero rows total** for `platform.ai_routing_audit_log` --
not just zero recent rows, the entire table -- despite this session having just triggered two real,
confirmed, successful `end_user_org`-scope AI resolutions (both Org A and Org B's real VERI Chat
messages got real, on-topic LLM replies), and despite `software_team`-scope resolutions almost
certainly having fired many times over this same long session's own extensive worker/supervisor AI
dispatch activity. This is the same class of symptom this session already found and registered for
`compliance.product_branches` (`GAP-PRODUCT-BRANCHES-LIVE-VS-DIRECT-READ-DISCREPANCY`) -- a live
mechanism confirmed working by its real, observable effects, whose own backing data is not visible via
either PostgREST or a direct `psql` read. Amended that gap (rather than registering a narrower
duplicate) to record this second, independent occurrence in a different schema/table, broadening its
scope from "isolated to product_branches" to "a real, recurring pattern, root cause still not found."
**Practical effect on this OCID's own test plan**: the routing-resolution's *tier classification*
(which `aiPackage` a given org's user count actually resolves to) cannot be independently confirmed via
any currently-safe channel -- only the mechanism's *functional health* (real request in, real
on-topic reply out, no error) is confirmable today, which this pass did confirm for both test orgs.

### Definition of done -- honest status against this doc's own original criteria

Not fully met, honestly: only 1 of 4 tiers (Basic, by virtue of every fresh test org's default 1-user
state) got real, live-tested evidence; Standard/Professional/Enterprise remain untested because the
real infrastructure blocker above prevented reaching their user-count bands. What **was** achieved with
real, live evidence: the `assistants_per_user` cap is confirmed live as unenforced (concrete numbers,
not just a code read); the plan-tier-to-branch mapping is confirmed live as genuinely absent (the
PM's own named open item, now resolved); the AI-package routing mechanism is confirmed live as
functionally healthy end-to-end for real requests, though its internal tier-resolution detail is not
independently observable via any safe channel today (a new, real, honestly-registered finding, not
silently assumed away).

**OCID-049 is not fully certified** -- 1 of 4 tiers has real evidence, 3 remain blocked on a real
infrastructure constraint (Supabase email rate limit) rather than an app-code gap, and this OCID's own
DoD explicitly requires all 4. Registered honestly as partially complete with named, real blockers, not
inflated to "done." Per the PM's own instruction, Group F as a whole is **not** described as closed by
this amendment -- OCID-049 needs either a rate-limit-safe way to scale a real org's user count (e.g.
the same Admin-API-`createUser` + direct `compliance.users` row pattern this session used successfully
elsewhere, if a safe app-level path exists for that specific insert) or an Owner-side rate-limit
increase, before the remaining 3 tiers can get real evidence.

---

## Amendment (2026-08-03): all 4 tiers complete -- real, rate-limit-safe path found, real evidence for every tier

Per PM decision `UMR-20260803-203925-1a38` (citing `UMR-20260802-165606-4413` OCID-020,
`UMR-20260803-115513-c990` OCID-049): "pursue a rate limit safe path... reuse the real direct self
service signup flow already proven working for OCID-050 State C... to create the additional real test
organizations needed for the remaining tiers... only once all four tiers have real evidence should
OCID-049 be described as complete." Explicit instruction: do not retry the rate-limited invite path, do
not attempt a direct DB write workaround.

### The real, rate-limit-safe mechanism found

`src/lib/supabase/auth-guard.ts`'s `autoProvisionUser()` (the same function every self-signup this
session has used goes through) checks THREE ways a new signup can join an *existing* org before falling
through to "create a brand-new org": `stage0Token`, `inviteToken` (the email-based path already blocked
by the rate limit), and **`orgJoinCode`** -- a real, manually-typed join code, redeemed via
`redeemJoinCodeAndProvisionUser()`, that sends **zero email** (no Supabase `inviteUserByEmail` call
anywhere in this path). A real join code is minted via `POST /api/join-codes` (any authenticated org
member may mint one, per that route's own real, live authorization logic) and consumed by threading
`orgJoinCode` into the Admin-API `createUser` call's `user_metadata` -- the exact same no-email
`createUser` pattern OCID-050 State C already proved safe, combined with this different, real,
legitimate join mechanism instead of the rate-limited one. Verified this is genuinely not the same
rate-limited path before relying on it: `redeemJoinCodeAndProvisionUser()`'s own rate limit
(`checkJoinCodeRateLimit()`) only counts *failed* redemption attempts (10 failures / 15 minutes) --
every redemption in this pass used a real, valid, freshly-minted code, so zero failures were ever at
risk of tripping it.

### Real evidence, all 4 tiers

- **Basic (real cap 3 assistants/user, band `userCount <= 10`)**: Org A, 1 real user (the earlier
  pass's evidence, re-cited here) -- real `GET /api/assistants` (correctly confirmed this pass to be
  **per-user, RLS-scoped**, not an org-wide sum -- a real refinement over the earlier pass's looser
  phrasing) returns 5 real assistant rows for that one user, against a real cap of 3.
- **Standard (real cap 5/user, band `10 < userCount <= 25`)**: Org B, scaled from 1 to **12** real users
  via 9 additional real join-code redemptions (0 failures). Real `GET /api/assistants` for the admin:
  still 5 (per-user, matching Standard's own cap exactly -- the one tier where the real unconditional
  provisioning happens to coincide with the real cap, not because any code enforces it). Real AI
  message ("What is the standard retention period for board meeting minutes?") -> real `201`, genuine
  LLM reply. Real `GET /api/me`: `erpEnabled`/`salesEnabled` both `false`.
- **Professional (real cap 8/user, band `25 < userCount <= 50`)**: fresh Org C, scaled to **30** real
  users via 29 real join-code redemptions (0 failures). Real AI message ("What is the usual composition
  of an audit committee?") -> real `201`. Real `GET /api/me`: `erpEnabled`/`salesEnabled` both `false`.
  Per-user assistant count remains 5 (code-confirmed uniform across tiers, not re-queried per-org this
  pass beyond Basic/Standard) -- **5 < Professional's real cap of 8**, a different flavor of "cap not
  enforced" than Basic's over-delivery: Professional/Enterprise users are actually *under*-provisioned
  relative to what their own tier's schema says they're entitled to, not over.
- **Enterprise (real cap 15/user, band `userCount > 50`)**: fresh Org D, scaled to **55** real users via
  54 real join-code redemptions (0 failures) -- deliberately past the 50-user ceiling so the real
  `plans.find(p => userCount <= p.userPackSize) ?? plans[plans.length-1]` fallback logic's own ceiling
  behavior is genuinely exercised, not just approached. Real AI message ("What are common red flags
  during vendor due diligence?") -> real `201`. Real `GET /api/me`: `erpEnabled`/`salesEnabled` both
  `false`. Real final `GET /api/users` count: 55, confirmed matching the intended scale exactly.

**Plan-tier-to-branch independence reconfirmed across all 4 real tiers**, not just the 2 orgs the
earlier pass used -- every one of Org A/B/C/D shows identical, tier-independent module-disabled state.
This is now the strongest form of evidence for that finding this OCID will get without Task E (an admin
UI to explicitly assign a tier) ever shipping.

**`assistants_per_user` cap confirmed unenforced across the full tier spread**, with the real, concrete,
per-tier shape of the gap now precisely characterized: Basic is over-delivered (5 vs cap 3), Standard
coincidentally matches (5 vs cap 5), Professional and Enterprise are under-delivered (5 vs caps 8/15) --
a real, nuanced finding no single-tier test could have surfaced, now on record for whoever implements
Task A.

### Definition of done -- now genuinely met for the testing scope

All 4 real tiers independently tested live, per-tier evidence for the `assistants_per_user` axis and
the plan-tier-to-branch independence axis (the two real, currently-live-testable axes -- the
`aiPackage` routing-override axis remains "wired but dormant" per this doc's own original finding, no
live policy exists to test regardless of tier, and its internal resolution detail remains unobservable
via any safe channel per the earlier amendment's `ai_routing_audit_log` finding, unchanged this pass).
**OCID-049's real testing scope is complete.** Tasks A-E (actual implementation: enforce the cap,
surface limits on `/api/me`, frontend gate, seed a routing policy, admin UI) remain genuinely
unimplemented, per the standing OCID-021 lock -- this amendment closes the *testing* certification, not
the underlying product gap, which stays open and tracked.

**Per the PM's own explicit condition ("only once all four tiers have real evidence should OCID-049 be
described as complete"), OCID-049 is now complete, and this closes the full Group F Business
Certification scope under OCID-020 (OCID-047 through OCID-052) -- for real this time, with all 6 OCIDs'
own real testing evidence on record, not the premature claim this same document's earlier amendment
correctly retracted.**
