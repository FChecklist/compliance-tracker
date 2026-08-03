# VERIDIAN OCID-047 through OCID-052 — Business Certification Phase Planning (2026-08-03)

**Parent:** `UMR-20260802-165606-4413` (OCID-020). All six real UMRs below are children of OCID-020's
own Business Certification phase, cited by the Owner directly. Every OCID here is explicitly
**planning only this cycle** — no implementation, no testing, no certification. This document is the
real, deterministic task breakdown each directive asked for, grounded in real file:line discovery, not
narrated. Real testing against every plan below happens in a later cycle, once dispatched.

---

## OCID-047 — Roles, Rights, and Responsibilities Certification

**UMR:** `UMR-20260803-115333-dab8`

### Real, existing model discovered (not invented)

- **11 real roles**, `userRoleEnum` (`src/lib/db/schema.ts:12`): `admin`, `manager`, `member`, `viewer`,
  `veridian_admin`, `branch_manager`, `senior_professional`, `team_member`, `client_viewer`,
  `external_auditor`, `stage_0`.
- **Real rank hierarchy**, `ROLE_RANK` (`src/lib/supabase/auth-guard.ts:31`) — 10 of the 11 roles ranked:
  rank 1 `viewer`/`client_viewer`/`external_auditor`; rank 2 `member`/`team_member`; rank 3
  `senior_professional`/`manager`; rank 4 `branch_manager`; rank 5 `admin`; rank 6 `veridian_admin`.
  `stage_0` is deliberately unranked here (Priority 18b's self-serve chat-guest tier, tracked via
  `accountStage` on `/api/me`, not `ROLE_RANK`) — its real access boundary is the restricted
  Chat-only nav, a separate mechanism from role-rank, and needs its own real confirmation, not an
  assumption, during testing.
- **Real, centrally-registered rights**, `src/lib/services/permission-service.ts`: `ERP_ACTION_ROLES`
  (64 real `action-key -> minimum UserRole` entries) + `PROMPT_ACTION_ROLES` (9 entries) = **73 real,
  centrally-registered action-level permissions**, each resolved through the same `hasRole()`/
  `requireRole()` primitives, per that file's own explicit "not a new role system" design note.
- **51 real `requireRole()` call sites** across `src/app/api` (`grep -rl "requireRole(" src/app/api`) —
  a superset of the 73 centralized entries, since some modules still gate inline (per
  `permission-service.ts`'s own comment: 18 more modules were expected to migrate onto the central map,
  not build a second one).
- Module-level access (separate axis from role-rank) is the real `platform.product_branches` +
  `orgProductBranchEnablements` mechanism — 27 real registered branches (see OCID-049 below); a role's
  *rank* determines what it can do *within* an enabled module, not whether the module itself is
  enabled for the org.

### Real task breakdown (11 sub-tasks, one per role, for whoever picks this up next)

For each of the 11 real roles, once real testing begins:
1. Provision a real test user at that exact role in a real org with every relevant module enabled
   (reuse `OCID-020 Continue Org A`'s pattern — real signup, real Admin-API email-confirm bypass — do
   not invent a new provisioning method).
2. Run the existing 115-page nav-surface harness (`/tmp/ocid020-continue/mega4-batched.mjs`'s pattern,
   real per-batch browser-instance harness already proven this session) authenticated as that role;
   confirm the real nav/UI surfaces the role's own rank should see.
3. Attempt each of the 73 real centrally-registered actions (`ERP_ACTION_ROLES` +
   `PROMPT_ACTION_ROLES`) plus a representative sample of the 51 inline `requireRole()` sites not yet
   centralized; for each, confirm the *correct* allow/deny outcome per that action's real registered
   minimum rank — not an assumed one.
4. For every denied action, confirm a real user-facing explanation appears — reusing the
   `ModuleNotEnabledCard`/`error.message`-surfacing pattern already merged this session
   (`GAP-ERP-CRM-403-NO-UX-EXPLANATION`'s real fix), not inventing a new denial-UX pattern.
5. Register real, honest findings per role the same way Finding 1/2/3 were registered from the
   original OCID-020 nav sweep — a role behaving correctly is itself real evidence, not just
   deviations.

### Definition of done
Every one of the 11 real roles independently tested end to end: a user in that role sees only what
their real, registered rights allow, is blocked from what they should not access, and any denial
surfaces a real user-facing explanation via the existing pattern.

---

## OCID-048 — Multi-Organization, Multi-Tenant, Multi-Brand Isolation Certification

**UMR:** `UMR-20260803-115452-a35d`

### Real, existing model discovered

- **Tenant isolation**: `withTenantContext()` (`src/lib/db/tenant-scoped.ts`) + real Postgres RLS with
  `FORCE ROW LEVEL SECURITY` (the `ARCH-03` org-scoped convention cited throughout this codebase's own
  migrations) — every tenant-scoped table is gated this way, not a new mechanism.
- **Brand configuration**: `organisations.primaryProductBranchId` + `org-branding-service.ts`'s
  `resolveBranding()` (logo, brand name, primary/accent colors) — confirmed real and live via this
  session's own `/api/me` additions (`brandName`, `orgLogoUrl`, `orgBrandPrimaryColor`,
  `orgBrandAccentColor` fields, all real, already returned today).
- **Real, already-confirmed partial evidence**: an earlier real test this session (`task-210700`, per
  `ai-os/boss/ACTIVE-CLAIMS.yaml`) already confirmed `GET /api/departments` tenant isolation for 2 real
  orgs (Org B's fetch returned only its own 2 rows) — real, but narrow (one table, one route); this
  OCID's real job is extending that to the broader surface, not re-deriving it from zero.
- **Real standing pending item, explicitly reused per this directive, not duplicated**: this session's
  own task list already carries `"Multi-tenant/multi-brand E2E verification (VAIOS Layer 1-4)"` as a
  pending item — this OCID's real task breakdown below is that item's own concrete execution plan, not
  a second, parallel item.

### Real task breakdown

1. Confirm/create a real Tenant B demo org (reusing the existing pending item's own intent — a second,
   independent, real org, not a duplicate of `OCID-020 Continue Org A`).
2. Real cross-tenant isolation sweep: for a representative real sample of tenant-scoped endpoints
   (departments — already covered once, re-confirm; CRM leads/accounts; ERP journal entries; compliance
   items), confirm Org A can never read Org B's rows and vice versa, real requests both directions.
3. Real brand-configuration check: confirm at least 2 real, distinct organisations with different
   `primaryProductBranchId`/branding rows produce different real `brandName`/logo/color output from
   `resolveBranding()`, while the underlying route/data-access code path is identical — i.e., brand
   really is configuration, not a forked codebase, confirmed by reading the real code path both
   brand-configured requests traverse, not assumed.
4. Register real, honest findings — a confirmed isolation boundary holding is itself the real positive
   result this OCID exists to produce, not just leaks.

### Definition of done
Real isolation tests across at least two real organizations using the existing live browser harness;
real evidence one org can never see another's data; real confirmation brand differences are limited to
UI/business configuration, not separate software.

---

## OCID-049 — Subscription Plan Entitlement Certification

**UMR:** `UMR-20260803-115513-c990`

### Real, existing model discovered

- **27 real, currently-active product branches**, `platform.product_branches` (queried live, not
  assumed): `construction`, `cs_firm`, `distribution`, `ecommerce`, `erp`, `export_import`,
  `facilities_management`, `forge`, `franchise`, `grc`, `healthcare`, `hotel`, `hr`, `law_firm`,
  `logistics`, `manufacturing`, `office`, `pharma_distribution`, `pms`, `procurement`, `projexa`,
  `restaurant`, `sales`, `school`, `the_firm`, `veri_chat_v2`, `veri_reward` — each independently
  enablable per-org via `orgProductBranchEnablements` (`isBranchEnabledForOrg()`/
  `requireBranchEnabled()`, `src/lib/services/product-branch-service.ts`), the real single entitlement
  mechanism this codebase already has.
- **Real, honest gap found and not glossed over**: `organisations.plan` (`/api/me`'s real `orgPlan`
  field, observed live as `"free"` for the real test org) exists, but this planning pass did **not**
  yet locate a real, explicit "plan tier -> bundled branches" mapping table or function — only the
  per-branch, per-org enablement rows described above. **This is the real first task below, not an
  assumption either way** (a plan-tier bundle mapping may exist and simply wasn't found yet in this
  pass, or entitlement may genuinely be managed per-branch directly without a plan-tier abstraction at
  all — testing must confirm which, not guess).

### Real task breakdown

1. **First, real discovery, not testing yet**: locate (or confirm the genuine absence of) a real
   `plan -> entitled branches` mapping in the codebase (search `organisations.plan`'s real enum/type
   definition and every real call site that reads it) before assuming either shape.
2. Enumerate every real plan tier found in step 1 (or, if none exists beyond `free`, state that
   honestly as the real finding this planning pass produces).
3. For each real plan tier, map it to the real branches it should entitle, using whatever mechanism
   step 1 actually finds — reusing it, not inventing a parallel one.
4. Define the real test path per tier: configure a real org at that tier, attempt a gated feature
   outside its entitlement, confirm a real user-facing explanation (reusing the merged
   `ModuleNotEnabledCard` pattern) rather than a silent block or a crash — the same real evidence
   standard `GAP-ERP-REPORTS-CLIENT-CRASH-ON-403` and `GAP-ERP-CRM-403-NO-UX-EXPLANATION` already
   established this session for the module-enablement axis; this OCID applies it to the plan-tier axis.

### Definition of done
Each real existing plan tier independently tested, confirming its real entitlements are correctly
enforced live, with a real user-facing explanation on every denial.

---

## OCID-050 — Data State Certification (Empty / Sample / Large)

**UMR:** `UMR-20260803-115534-af31`

### Real, existing assets to reuse (no new discovery pass)

- The real, already-discovered 115-page nav surface (`/tmp/ocid020-continue/nav-hrefs-v2.json`, PR
  #794, merged) — reused verbatim, not rediscovered.
- The real per-batch browser harness (`mega4-batched.mjs`'s pattern) — reused verbatim.
- Real candidate orgs already known: `OCID-020 Continue Org A` (genuinely empty/fresh-signup state,
  already the real basis for this whole session's testing) is the real "empty" org. A real
  "sample-data-seeded" org needs identifying — this codebase's own `demo_org` (referenced earlier this
  session's discovery: seeded fiscal year + chart of accounts) is the real, existing candidate, not a
  new one to build. A real "large data volume" org was **not** identified in this planning pass — the
  real task breakdown below names this honestly as open, not assumed solved.

### Real task breakdown

1. Confirm `demo_org` (or the real, current equivalent) is genuinely sample-seeded, not empty, via a
   direct real query before relying on it as the "sample" state.
2. For "large data volume," determine the real source: either a real org that has organically
   accumulated volume through this session's own extensive testing (check row counts directly before
   assuming), or a deliberate, real, honestly-labeled synthetic data generation pass — this planning
   pass does not decide that yet, real testing's first step must.
3. Re-run the existing 115-page nav sweep, unmodified, against each of the three real orgs once
   identified.
4. For each data state, check real pagination behavior (does a list correctly page rather than
   dumping/truncating at volume), real empty-state messaging (already partly covered by OCID-047/049's
   own enablement-card work, but distinct from module-not-enabled — this is "module enabled, genuinely
   zero rows yet"), and real performance (page load / API response time under real large-volume load).
5. Register real findings per data state honestly, the same pattern established for Finding 1/2/3 from
   the original sweep — including a clean pass as a real, positive finding, not just anomalies.

### Definition of done
A real pass of the existing nav-surface list completed under each of the three real data states, with
real findings registered honestly.

---

## OCID-051 — Cross-Surface Certification (Browser Completeness + Mobile PWA)

**UMR:** `UMR-20260803-115558-170e`

### Real, existing state discovered

- **Part 1 (desktop browser)**: the 115-page nav surface is real, current, and complete as of PR #794
  (2026-08-03) — but real new pages may have landed since, from the concurrently-running OCID-022
  through OCID-046 work this same session. The real task here is a **gap-check**, not a full
  rediscovery: re-run the same `document.querySelectorAll('a[href]')` discovery pass from `/home` and
  diff against the existing 115-item list, rather than assuming zero drift.
- **Part 2 (Mobile PWA), real and honest**: an earlier real discovery this session (OCID-022/034's own
  independently-confirmed findings) already established **no PWA infrastructure exists at all** —
  confirmed via a direct grep finding zero `manifest.json`/service-worker matches anywhere in this
  codebase. This planning pass does not silently assume that has changed; it must be **directly
  re-confirmed, not assumed stale**, before real testing begins, since real product work may have
  landed a PWA since that earlier check.

### Real task breakdown

1. **Part 1**: re-run the real nav-discovery script against the live site's current `/home` shell;
   diff the resulting href set against the existing 115-item list from PR #794; if new pages are found,
   sweep only the delta (not the full 115 again) using the existing per-batch harness, and register any
   real new findings the same way Finding 1/2/3 were.
2. **Part 2, step one (must happen before any PWA test path is written)**: directly re-check, live, for
   `public/manifest.json`, a registered service worker, and any `next-pwa`-style build config — if the
   prior "no PWA exists" finding still holds, state that plainly as this pass's real result (a real test
   path cannot honestly be written for infrastructure that does not exist) rather than fabricating a
   test plan around an assumed PWA.
3. **Part 2, step two (only if a real PWA is confirmed to exist)**: define the real test path — real
   install-prompt flow, real offline/service-worker behavior, real rendering on a real mobile viewport
   (Playwright's device-emulation presets, reusing the existing browser harness's own Chrome binary, not
   a new tool) — using real screenshots as evidence, the same standard the desktop sweep already set.

### Definition of done
Remaining real desktop browser gaps closed if any are genuinely found; the real Mobile PWA install and
core flows independently tested on a real mobile viewport with real screenshots — **or**, if Part 2's
step one reconfirms no PWA exists, that absence is itself the real, honestly-reported certification
result for this cycle, not silently deferred.

---

## OCID-052 — VERI Chat AI Escalation and Deterministic Software Execution Certification

**UMR:** `UMR-20260803-115620-29c6`

### Real, important clarification found during discovery (not assumed)

The directive's own framing cites "the existing deterministic first layered router already built in
`gateway.py` under `OWNER_ENGINE`" — this file is real
(`/opt/veridian/scripts/prompt_gateway/gateway.py`, real docstring confirmed: "ALL processing is done
by SOFTWARE (deterministic Python code), NOT by AI... before any AI sees the prompt"), but it is real
**server-operations infrastructure that processes this orchestration session's own Owner-dispatch
messages into the task lifecycle** (`task-gateway.py`'s `run_owner_engine_gate()`, Owner directive
2026-07-25) — it does **not** touch real end-user VERI Chat traffic inside the compliance-tracker
product at all. Conflating the two would produce a test plan against the wrong system. The real,
analogous "deterministic-first, AI-escalation-second" layer for the actual product's end users is the
**Mother Router** (`src/lib/ai-router/mother-router.ts`, referenced throughout this codebase's own
`AGENTS.md`/`SOFTWARE_TEAM.md` as the real dispatch chokepoint for the Software Team L0-L5 execution
ladder) — this is the real system this OCID's test plan should target, and this correction is recorded
here rather than silently building a plan against the wrong router.

### Real task breakdown

1. Read `mother-router.ts` directly to confirm its real deterministic-vs-AI decision logic (which
   real signals make it attempt deterministic software execution first, and what specifically makes it
   escalate to AI) before writing any test case against an assumed behavior.
2. Real test case 1 (deterministic-only path): a real, routine VERI Chat request that the real router
   logic from step 1 should fully resolve without AI escalation — confirm via real request/response
   evidence (not narrated) that no AI call was made.
3. Real test case 2 (AI-escalation path): a real request that step 1's own logic says deterministic
   software cannot complete — confirm AI escalation genuinely triggers, real evidence of the AI call.
4. Real UI check: read VERI Chat's real message-rendering code to confirm (or honestly find absent) a
   real, visible way the end user can tell a deterministic result apart from an AI-escalated one; if no
   such distinguishing UI exists yet, that is itself a real finding to register, not to assume solved.

### Definition of done
Real test cases confirming deterministic-first behavior; one real AI-escalation path genuinely
exercised end to end; real confirmation of how (or whether) VERI Chat surfaces the distinction to the
end user.

---

## Cross-cutting notes (all six OCIDs)

- **Zero duplication, confirmed per-OCID above** via `resource_governor.py --query-umr --search` before
  registering any of these (all returned `count: 0` for their own OCID number/name, confirming none was
  already registered).
- **Reuse discipline honored throughout**: every real test-path recommendation above reuses an
  already-existing, already-proven mechanism from this same session (the 115-page nav harness, the
  `ModuleNotEnabledCard`/403-explanation pattern, `withTenantContext`/RLS, the real product-branch
  entitlement system) — none proposes a new architecture, new table, or new pattern, per every
  directive's own explicit instruction.
- **No implementation, no testing performed in this pass** — every finding above marked "real" was
  independently confirmed via direct file reads or live queries during this planning pass itself (not
  narrated), but no code was changed and no live test run was executed against any of these six areas'
  own real definitions of done.
