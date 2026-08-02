# PROGRESS -- task-20260802-210700-pm-decision--fix-the-real-high-severity

Cites: `UMR-20260802-165606-4413` (OCID-020) throughout. `UMR-20260802-173631-ca85`
stays locked until this fix AND the rest of the real certification sweep are
independently verified complete.

## Completed
- [x] Read `ai-os/boss/ACTIVE-CLAIMS.yaml` + found the real prior finding this PM
      decision is about: OCID-020 redo session (PR #737) — Finding A, real
      `500` on `GET /api/departments` crashing the Compliance Register
      (`/compliance`) and Pendency View (`/compliance?status=overdue`) with a
      client-side `TypeError: z.map is not a function`.
- [x] Root-caused directly (not narrated): reproduced locally by building the
      exact same Drizzle relational query (`db.query.departments.findMany({with:
      {head, complianceItems, users}})`, verbatim from
      `src/app/api/departments/route.ts`) against the real `src/lib/db/schema.ts`
      via `drizzle-orm`. Real error reproduced: `There are multiple relations
      between "users" and "departments". Please specify relation name.`
- [x] Shipped a fix (`relationName: 'departmentMembers'`), opened PR #741,
      logged Finding B in `ai-os/MASTER-TRACKER.yaml`.
- [x] **On resume (invocation 2/20)**: discovered a genuinely parallel session
      independently root-caused and fixed the identical bug (same root cause,
      same fix shape) with additional defensive frontend handling and real
      regression tests, via PR #740 — which merged first (`c0df6f02` on
      `main`, independently re-verified via `git diff-tree -p c0df6f02 --
      src/lib/db/schema.ts`, not just trusted). This session's own duplicate
      PR #741 was correctly closed as superseded by that other session. Finding
      B (`GAP-ERP-CRM-403-NO-UX-EXPLANATION`) is likewise already merged into
      `ai-os/MASTER-TRACKER.yaml` via PR #742.
- [x] Rebased this session's branch onto `main` (`git rebase origin/main`,
      skipping the now-redundant duplicate schema-fix commit, resolving
      conflicts in `ai-os/boss/ACTIVE-CLAIMS.yaml` and this file to reflect
      current reality rather than keeping two stale/duplicate claim entries).
- [x] Confirmed on `main`: `src/lib/db/schema.ts` has
      `departmentsRelations.users: many(users, { relationName:
      'departmentMembers' })` and `usersRelations.department: one(departments,
      {..., relationName: 'departmentMembers' })`; `ai-os/MASTER-TRACKER.yaml`
      has `GAP-ERP-CRM-403-NO-UX-EXPLANATION` (single entry, no duplication).
- [x] Opened PR #743 (reconciled `ACTIVE-CLAIMS.yaml`/`PROGRESS.md`), got an
      independent audit (Rule 7c — a fresh, non-implementing agent verified
      the PR's claims directly against `origin/main` via `git cat-file -p`/
      `git merge-base --is-ancestor`, not by trusting the PR body) which
      posted the required structured `AUDIT: PASS` comment, hit and worked
      around the known issue-comment/head-SHA CI bug (empty commit to force
      a real `synchronize` event), then merged once all 7 required checks
      (Lint, Type Check, Build, audit-check, Guardrail Presence Check, Asset
      Registry Coverage Check, Unit Tests) were green — merged
      `2026-08-02T22:30:58Z`.
- [x] **Independently retested the EXACT SAME real flow that crashed, live,
      against the real deployed app, with a real fresh account (not
      guessed/assumed):** real signup via the Supabase Admin API (public
      `/signup` was rate-limited, 429 — used the admin `/auth/v1/admin/users`
      endpoint instead, with the same `full_name`/`organisation`
      `user_metadata` shape `src/app/signup/page.tsx` sends, so
      `autoProvisionUser()` still runs the normal way on first authenticated
      request — did not touch or mutate the other concurrent session's own
      test account found mid-flight), confirmed-email, real login on
      `https://projexa-ai.com` (title "VERIDIAN COGNITIVE AI OS" confirms
      this domain does serve compliance-tracker, per prior session's finding)
      → real navigation to `/home`, then real `GET /compliance` and
      `GET /compliance?status=overdue`. Real captured network response:
      `200 GET https://projexa-ai.com/api/departments` →
      `{"departments":[]}` (empty array is correct — fresh org, zero
      departments created yet; this is a real success shape, not the old
      500/error-object shape). Both pages rendered the real Compliance
      Register UI with zero "Application error" client crash (confirmed via
      `page.locator('body').innerText()` not containing that string, plus
      full-page screenshots — Compliance Register header, "0 compliance
      items tracked", VERI Chat composer all rendered normally). **Fix
      confirmed live, for real, not assumed because CI passed.**

- [x] **First real incremental finding for the broader sweep: multi-tenant
      isolation, positively confirmed.** Note: the prior OCID-020 redo
      session's own claim
      (`task-20260802-190820`, `ai-os/boss/ACTIVE-CLAIMS.yaml`) targeted a
      *different* app/repo (`https://projexa-smoky.vercel.app`, the
      standalone PROJEXA codebase) for the broader sweep, and its branch is
      already merged+deleted (PR #737) — no live collision picking this up
      against compliance-tracker's own `projexa-ai.com` deployment instead.
      Created two real, separate fresh orgs via Supabase Admin API (public
      `/signup` still rate-limited), logged in as each, created a
      department scoped to Org B via `POST /api/departments` (real
      `Org-B-Only-Department` created, `orgId: "dane6ps2f1k1fmg1tgndvl85"`),
      then `GET /api/departments` for that same Org B session returned
      exactly 2 departments (its own auto-provisioned "General" +
      the just-created one) — **not** anything from Org A, confirming real
      tenant-scoped `withTenantContext`/RLS isolation holds for this route.
      A separate clean single-account run (`provcheck-*`) also confirmed
      normal provisioning: real `admin` role, real auto-created "General"
      department, `GET /api/users` and `GET /api/departments` both scoped
      correctly.
      **Honest limitation, not swept under the rug**: two earlier attempts
      in this same investigation (both org A and org B in one run; org A
      alone in a second run) got `401`/`403` instead of the expected
      success — root-caused as *most likely* a test-harness artifact (rapid
      back-to-back Supabase password-grant logins from the same
      browser/IP within the same script run, not a real per-request race in
      `autoProvisionUser()` itself — a slower, isolated single-account retry
      each time succeeded cleanly). **Not confirmed as a real product bug**
      — logging this honestly as inconclusive/needs-a-slower-retest rather
      than either asserting it's a real bug or silently discarding the
      observation. If a future pass reproduces the same failure with
      requests spaced apart (no rapid-fire), that would be real evidence of
      an actual `autoProvisionUser()` race and should be filed as a tracked
      gap at that point — not before.

## Remaining
- [ ] Continue the broader real certification sweep per the PM spec —
      multi-brand, first-time-onboarding UX detail, cache and search,
      remaining nav surface, and (if reproduced cleanly/slowly) the
      auth-race question flagged above — reporting real incremental
      findings every cycle, not one final claim.
