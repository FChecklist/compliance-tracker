# PROGRESS -- task-20260727-101145-reporting-api-gateway--external-ai-scope

## Completed
- [x] Read governance docs (CLAUDE.md/AGENTS.md/CONSTITUTION.yaml/ACTIVE-CLAIMS.yaml), claim
      already registered (`ai-os/boss/ACTIVE-CLAIMS.yaml` line ~43) from invocation 1.
- [x] Built `src/app/api/v1/reports/catalog/route.ts` (GET) -- lists the caller's visible
      report_definitions catalog. Auth via `requireAuthOrApiKey()` + new
      `requireReportsReadAccess()` gate (accepts `read` OR the new `read:reports` scope).
      Zero new execution logic: wraps the existing `getFullReportCatalog({ orgId })`.
- [x] Built `src/app/api/v1/reports/definitions/[id]/run/route.ts` (POST) -- executes a
      report_definitions row via the existing `executeReportDefinition()`. STRICT_TENANT_ISOLATION:
      `orgId` is always `ctx.orgId` from the authenticated caller, never from the request body/query
      (verified by an automated spoofing test, see below). Supports `?format=json|csv|xlsx`.
- [x] `src/lib/report-export-shared.ts` -- server-safe (no browser APIs) `rowsToCSV`/
      `rowsToXLSXBuffer` builders, same `xlsx` package + ExportRow[] convention as
      `report-export.ts`/`reports/page.tsx`, just without the client-side download trigger so an
      API route can return the bytes directly.
- [x] `requireReportsReadAccess()` added to `src/lib/supabase/auth-guard.ts` -- OR-semantics gate
      (broad `read` OR narrow `read:reports`), session always passes.
- [x] `compliance.api_keys.scopes` extended (comma-separated) to accept `read:reports` in
      `POST /api/settings/api-keys` -- no schema/table change needed, the existing free-text
      scopes column already expresses it (`src/lib/db/schema.ts` comment updated to document it).
- [x] `src/lib/openapi/generate.ts` -- documented `/reports/catalog` and
      `/reports/definitions/{id}/run` in the public OpenAPI doc.
- [x] Tests: `catalog/route.test.ts` (3), `definitions/[id]/run/route.test.ts` (6, incl. the
      required tenant-isolation spoofing test + cross-org test), `report-export-shared.test.ts` (5),
      `auth-guard.test.ts` (6 for `requireReportsReadAccess`). All pure-mock, no live DB, matching
      repo convention.
- [x] Fixed bugs found while verifying inherited invocation-1 work: (a) `NextResponse` body-type
      TS error on the raw XLSX `Buffer` (wrapped in `Blob`+`Uint8Array.from`, matching the existing
      `payslips/[id]/pdf/route.ts` fix pattern); (b) test-file cross-contamination between
      `catalog/route.test.ts` and `run/route.test.ts`'s `mock.module()` calls on the same
      `report-engine-service` specifier (both now stub the other file's export too); (c) a test-only
      bug in the CSV-escaping test (was splitting the whole CSV string on `\n`, which broke a
      legitimately-quoted embedded newline); (d) `run/route.test.ts`'s request helper used a plain
      `Request` instead of `NextRequest`, so `request.nextUrl` was undefined for `?format=` tests.
- [x] Full verification pass: `npx tsc --noEmit` clean, `bun test` 2072/2072 passing (repo-wide, not
      just new files), `bun run lint` 0 errors, `node scripts/check-guardrail-presence.mjs` (88/88),
      `node scripts/check-terminology-guardrail.mjs --diff-only` clean (fixed one new hardcoded-date
      finding by rewording, no exemption-registry edit needed), Supabase `get_advisors(security)`
      against the `verdian-ai` project shows only pre-existing findings (views/functions/extensions
      unrelated to `api_keys`/`report_definitions`) -- zero new findings from this change.

## Remaining
- [ ] Write PR description with the real `curl` example (using a real `built`-status report id
      confirmed live via Supabase MCP, e.g. `rptdef_safety_incident`) and the honest note that no
      self-service API-key-creation UI exists yet (only the `POST /api/settings/api-keys` endpoint) --
      flagged as a smaller, non-blocking follow-up per the task spec.
- [ ] Commit, push branch, open PR (expected tier2/HOLD_FOR_OWNER_SIGNOFF per task spec, given
      STRICT_TENANT_ISOLATION is the Owner's top concern for this task -- that classification is
      correct/expected, not something to route around).

# PROGRESS -- task-20260727-100954-erp-hr-gaps--expense-reimbursement--loan

## Completed
- [x] Registered claim in `ai-os/boss/ACTIVE-CLAIMS.yaml` before starting (no conflicting active claims found).
- [x] Fixed the stale `hr-service.ts:1-6` "Payroll deliberately out of scope" comment (was already wrong -- `erp-payroll-service.ts` is a real, live payroll engine).
- [x] **Gap 1: Employee expense claims/reimbursement.** New `hrExpenseClaims` table (schema.ts), `hr-expense-service.ts` (create/list/decide), `src/app/api/hr/expenses/route.ts` + `[id]/route.ts`. Payroll integration decision: an approved-but-unpaid claim is picked up by `processPayrollRun()` as a real payslip **earning** line (not a separate payment record) -- reuses the existing payslip/net-pay machinery, documented in schema.ts's own comment.
- [x] **Gap 2: Employee loans/salary advances.** New `hrEmployeeLoans` + `hrLoanInstallments` tables, `hr-loan-service.ts` (request/approve-generates-full-schedule/reject), `src/app/api/hr/loans/route.ts` + `[id]/route.ts` + `[id]/installments/route.ts`. Payroll integration: `processPayrollRun()` deducts the earliest still-pending installment on every processed run (one per run, in installment-number order -- documented simplification, does not match calendar dueMonth/dueYear against the run's own month/year), decrements `outstandingBalance`, closes the loan at 0.
- [x] **Gap 3: KRA/weighted-goal + multi-rater (360) appraisal.** Extended (not replaced) `performanceReviews`/`performance-service.ts`: new `performanceReviewGoals` (per-goal weight+rating, `computeWeightedScore` pure helper enforces weights sum to 100), new `performanceReviewRaters` (peer/subordinate/other, additive to the existing self+manager pair), new nullable `performanceReviews.weightedScore` column (computed on submit only if goals exist -- zero-goal reviews unchanged). Routes: `.../reviews/[id]/goals/route.ts` + `[goalId]/route.ts`, `.../reviews/[id]/raters/route.ts` + `[raterId]/route.ts`.
- [x] **Gap 4: Shift management/roster.** New `hrShiftTypes` + `hrShiftRosterAssignments` tables, `hr-shift-service.ts` (`resolveShiftForDate` pure helper + CRUD), new nullable `hrAttendanceRecords.shiftTypeId` column -- `checkIn`/`markAttendance` in `hr-attendance-service.ts` now snapshot the resolved expected shift at write time. Routes: `src/app/api/hr/shifts/route.ts` + `roster/route.ts`.
- [x] Drizzle migration `drizzle/0264_hr_gap_closure_expense_loan_appraisal_shift.sql` (all 7 new tables + 2 additive columns, org-scoped RLS+FORCE+policies+grants+indexes, matching drizzle/0050's own pattern) + `drizzle/meta/_journal.json` entry.
- [x] `ai-os/registry/asset-registry-coverage.yaml`: all 7 new tables given an explicit `exempted` decision with a real per-table reason (sensitive per-employee financial/performance data, or a ledger/log record with no genuine display-name column -- same classes as the already-exempted `performance_reviews`/`hr_attendance_records`/`crm_stage_history`).
- [x] `ai-os/registry/terminology-guardrail-exemptions.yaml`: 8 new files given real per-file exemption entries (dated changelog-comment + test-fixture-date-literal false positives, same class Phase 2 already established for this directory).
- [x] Tests: `hr-loan-service.test.ts`, `hr-shift-service.test.ts`, `hr-expense-service.test.ts`, `erp-payroll-service.test.ts` (proves a processed payroll run reflects both the loan deduction and the expense reimbursement, per this task's own SUCCESS_CRITERIA), `performance-service.test.ts` -- all pure-function tests (no live DB in `.test.ts`, matching this repo's established convention).
- [x] Verification: `bun test` -- 2073 pass / 0 fail (full suite, no regressions) + 63 pass / 0 fail (new + touched files run standalone). `bunx tsc --noEmit` -- 0 errors, full repo. `check-asset-registry-coverage.mjs`, `check-terminology-guardrail.mjs --diff-only`, `check-guardrail-presence.mjs` -- all pass.

## Remaining
- [ ] `get_advisors(security)` via Supabase MCP -- not run this pass (no live Supabase project connected in this session; the MCP server requires interactive OAuth authorization this non-interactive session cannot complete). RLS+FORCE+policies were hand-written to mirror `drizzle/0050`'s already-audited pattern exactly, but the SUCCESS_CRITERIA's explicit zero-new-findings check itself is unverified -- flag for the merging session/owner to run before/at merge.
- [ ] Push commits, open the PR, and get the mandatory independent audit-verdict comment (AGENTS.md Rule 6/7(c)/10) -- this session must not self-merge.
- [ ] Optional follow-up (not required by this task's SUCCESS_CRITERIA, noted honestly): no UI screens were built for any of the 4 features (API + service + schema only, matching this task's own SCOPE wording) -- a real, separate future gap if the Owner wants employee-facing UI for these before the next HR wave.
# PROGRESS -- task-20260727-101123-erp-project-management-gaps--timesheet-t

## Completed
- [x] Gap 1 -- PMS timesheet -> client invoice: `src/lib/services/pms-invoice-service.ts`
  (`generateInvoiceFromUnbilledProjectTime`), modeled on
  `firm-billing-service.ts`'s `generateInvoiceFromUnbilledTime()`. Reuses the
  existing `erp_sales_invoices`/`erp_sales_invoice_items` schema/service --
  no new invoice table. Added 3 additive columns to `pms_time_entries`
  (`billable`, `hourlyRateSnapshot`, `invoiceItemId`) mirroring
  `firm_time_entries`'s existing trio, migration
  `drizzle/0264_pms_timesheet_invoice_link.sql` (hand-authored -- see note
  below on why `drizzle-kit generate` wasn't used). `requireAuth()`-gated
  route: `POST /api/pms/invoices/generate`. Pure-function unit tests:
  `pms-time-service.test.ts` (rate resolution), `pms-invoice-service.test.ts`
  (line-building, rounding, missing-rate error, org-default fallback).
- [x] Gap 2 -- Gantt/critical-path UI: **already existed, no changes made.**
  Confirmed `getGanttData()` (`schedule-service.ts`) already returns
  `isCritical`/`floatDays` per task via `calculateCriticalPath()` -- did NOT
  extend it. Confirmed PROJEXA (`FChecklist/projexa`) already has a real,
  merged Gantt UI consuming `GET /api/v1/projexa/schedule/gantt`:
  `src/components/ScheduleGanttClient.tsx` + `src/app/(app)/schedule/page.tsx`
  (Timeline tab), proxied via `src/app/api/schedule/gantt/route.ts`, merged
  2026-07-09 as commit `e1572a4` on `origin/main` -- shows critical path as a
  grid column (isCritical/floatDays), a stats bar, and Capture Baseline.
  The task SPEC's KNOWN_CONTEXT claim of "zero .tsx Gantt matches" was based
  on grepping compliance-tracker itself, which has no UI at all (correct,
  but not the relevant repo) -- the real UI lives in the separate PROJEXA
  repo and was already shipped 18 days before this task's Phase 0
  investigation. No PROJEXA PR opened -- there is nothing to change.
- [x] Gap 3 -- Resource-allocation conflict/over-allocation detection:
  `detectResourceConflicts()`/`getResourceConflicts()` added to
  `schedule-service.ts`. Existing `getWorkload()` was scoped to a SINGLE
  project only -- the real, previously-undetected gap is a user who looks
  fine in every individual project's workload view while being double-/
  triple-booked once their allocations across ALL of an org's projects are
  summed for the same day. New pure function sums `allocatedHoursPerDay`
  per user per calendar day across every project passed in. Wired to:
  - `GET /api/pms/schedule/resource-conflicts` (compliance-tracker,
    `requireAuthOrApiKey`, which calls `requireAuth()` internally --
    same convention as every other route in `/api/pms/schedule/*`)
  - `GET /api/v1/projexa/schedule/resource-conflicts` (PROJEXA-facing v1
    surface, same convention as sibling `gantt`/`workload` routes)
  - `POST /api/pms/schedule/resource-allocations` and
    `POST /api/v1/projexa/schedule/workload` now both return a `conflicts`
    array in their response immediately after creating an allocation.
  Unit tests: `schedule-service.test.ts` -- deliberately-constructed
  overlapping over-allocation (flagged, correct total + project attribution,
  correct date-range boundary), non-overlapping legitimate case (not
  flagged), two-under-capacity-users case (not flagged), exactly-at-capacity
  boundary (not flagged, only strictly over), custom capacity override.

- `bunx tsc --noEmit` clean (0 errors) across the whole compliance-tracker
  repo -- confirmed via `NODE_OPTIONS="--max-old-space-size=8192"` (default
  heap OOMs on this repo's size in this sandbox; that's a sandbox-memory
  fact, not a code issue).
- `bun test` on all new/touched service test files: 17 pass / 0 fail.
- Migration numbering: `drizzle-kit generate` produced a full-schema dump
  (not an incremental diff) because this repo's `drizzle/meta/` only keeps
  a `0000_snapshot.json` baseline -- migrations 0001-0263 are hand-authored
  SQL with journal entries only, no per-migration snapshot. Followed that
  established convention: hand-wrote `drizzle/0264_pms_timesheet_invoice_link.sql`
  (ALTER TABLE + forward-referenced FK + index, same shape as
  `drizzle/0086`'s `firm_time_entries.invoice_line_item_id`), manually
  appended `drizzle/meta/_journal.json`. `node scripts/check-migration-collision.mjs`
  passes. **Not applied live** -- left for the supervising session/owner,
  same convention drizzle/0262 and drizzle/0263 already used for untested
  migrations in this repo.

## Remaining
- [ ] Real live-DB verification of the migration + invoice generation flow
  (this session only has pure-function unit coverage, per this repo's own
  "no live DB in .test.ts" convention -- confirmed via
  `erp-payment-entries-service.test.ts`'s own header note).
- [ ] Open the compliance-tracker PR (branch already pushed) and get the
  independent (non-self) audit comment per AGENTS.md Rule 7(c)/Rule 10.
- [ ] No PROJEXA PR needed (see Gap 2 above) -- confirm with owner this is
  understood as "nothing to build," not "skipped."
# PROGRESS -- task-20260727-093117-fix-dependabot-alert34-sharp-cve

## Completed
- [x] Read AGENTS.md / CLAUDE.md / ACTIVE-CLAIMS.yaml, confirmed no conflicting claim for sharp/alert-34
- [x] Registered claim in ai-os/boss/ACTIVE-CLAIMS.yaml (committed+pushed separately)
- [x] Created branch `fix/dependabot-alert-34-sharp-cve` off main
- [x] Bumped `sharp` `^0.34.3` -> `^0.35.3` in package.json
- [x] Ran `bun install` to update bun.lock; confirmed diff is scoped to sharp + `@img/sharp-*` + `@img/colour` transitive tree only (no unrelated drift). Reverted an unrelated `bun run db:generate` migration artifact that got generated as a side effect of exercising `db:generate` (pre-existing schema drift, out of scope).
- [x] Grepped codebase for direct `sharp(` / `from "sharp"` usages -- none found in src/ or scripts/; it's consumed only via version pinning (Next.js image optimization / OCR dep chain), no app code changes needed.
- [x] `bun run lint` -- 0 errors, 3 pre-existing warnings unrelated to sharp (exit 0)
- [x] `bunx tsc --noEmit` (with NODE_OPTIONS=--max-old-space-size=6144; default heap OOMs in this environment regardless of branch, unrelated to this change) -- 0 errors (exit 0)

## Remaining
- [ ] `bun run build` (running in background, environment-large repo takes >10min)
- [ ] `bun test` with placeholder DATABASE_URL/APP_RUNTIME_DATABASE_URL (matching CI's own env, running in background)
- [ ] Commit sharp bump + lockfile, push branch
- [ ] Open PR against main referencing alert #34 / GHSA-f88m-g3jw-g9cj
- [ ] Move claim to recently_completed in ACTIVE-CLAIMS.yaml
# PROGRESS -- task-20260727-101134-erp-helpdesk-gaps--tiered-sla---team-rou

Owner directive DEEP_ERP_FUNCTIONALITY_COMPLETION_VIA_ODOO_ERPNEXT_REFERENCE,
Phase 0 investigation (2026-07-27). Closes 3 confirmed-real Helpdesk gaps
vs. Odoo's stock Helpdesk app (compliance-tracker's Helpdesk already
exceeds Odoo in several other respects -- ITIL problem management, AI
ticket intelligence, voice-to-ticket -- this was narrow gap-closure, not a
rebuild).

## Completed

- [x] Registered claim in `ai-os/boss/ACTIVE-CLAIMS.yaml` before starting (no collision found).
- [x] Re-verified all 3 gaps by direct code inspection (grep + full-file reads), confirming the SPEC's KNOWN_CONTEXT:
  - Gap 1 (tiered SLA/routing): confirmed absent -- `tickets.slaDeadline` was one ad-hoc timestamp from `input.slaHours` (`ticket-service.ts:71`, pre-change), zero `slaPolic`/`escalationRule`/`businessHours`/`teams` matches in schema.ts.
  - Gap 2 (email-to-ticket): confirmed absent -- `emailIntelligenceItems` only promoted to `tasks`, never `tickets`; schema.ts's own header comment already said so.
  - Gap 3 (self-service portal): confirmed absent -- `knowledgeBasePages` had no publish flag, `/knowledge-base` and `/tickets` are both in the protected-route allowlist, guest access is always staff-issued after a ticket exists.
- [x] **Gap 1 -- tiered SLA policy + team routing**:
  - Schema (`src/lib/db/schema.ts`, migration `drizzle/0264_helpdesk_tiered_sla_team_routing.sql`): `ticketTeams`, `businessHoursSchedules`, `slaPolicies`, `escalationRules`, `ticketEscalationEvents` tables; `tickets.teamId`/`slaPolicyId`/`requesterEmail` columns. Full RLS (`app_runtime_org_scoped` + `service_role_bypass_*`) matching the existing Wave 81 migration's own pattern exactly.
  - Service (`src/lib/services/ticket-service.ts`): `scoreSlaPolicyMatch`/`pickBestSlaPolicy` (pure, most-specific-match-wins scoring), `computeSlaDeadline` (business-hours-aware, UTC-based -- see its own doc comment for the documented IANA-timezone simplification), `resolveSlaPolicy`, `checkTicketEscalations()` (idempotent cron, wired into the existing `/api/internal/metric-alerts/run` cron -- no new cron job, no cron enablement changed, per this task's own constraint), plus CRUD (`listTicketTeams`/`createTicketTeam`/`updateTicketTeam`, `listSlaPolicies`/`createSlaPolicy`/`updateSlaPolicy`, `listEscalationRules`/`createEscalationRule`, `listBusinessHoursSchedules`/`createBusinessHoursSchedule`). `createTicket()` now resolves SLA from a matching policy when `input.slaHours` is omitted -- **the manual override path is unchanged byte-for-byte** (backward compatible, per spec).
  - Routes: `/api/ticket-teams` (+`[id]`), `/api/sla-policies` (+`[id]`), `/api/escalation-rules`, `/api/business-hours-schedules` -- all `requireAuth()`-gated, same convention as every existing ticket route.
  - Tests: `src/lib/services/ticket-service.test.ts` -- 10 pure-function tests (policy specificity scoring + business-hours deadline math incl. weekend rollover), **all passing** (`bun test`).
- [x] **Gap 2 -- email-to-ticket ingestion**: `createTicketFromEmailIntelligenceItem()` in `ticket-service.ts` promotes an `emailIntelligenceItems` row straight to a `tickets` row (reuses the existing email-ingestion record rather than building a second pipeline, per spec) -- posts the email body as the first conversation message, sets `requesterEmail`, marks the source item `promotedTicketId`/`status: "promoted_to_ticket"`. Route: `POST /api/email-intelligence/[id]/promote-to-ticket`.
- [x] **Gap 3 -- public self-service portal**:
  - `knowledgeBasePages.isPublished` (default false -- every existing page stays internal-only unless a staff member opts in via `updateKbPage`'s now-accepted `isPublished` patch field).
  - New `src/lib/services/public-portal-service.ts`: resolves org by its existing public `organisations.slug` (same established convention as `getOrgBySlugWithSso` in sso-service.ts), lists/reads only `isPublished` KB pages, and `submitPublicTicket()` -- creates a real ticket + conversation, routed to the org's default `ticketTeams` row (rejects with 400 if none configured, rather than silently creating an RLS-invisible orphan ticket) and issues a self-serve `conversationGuestAccess` token (reusing that exact existing mechanism, not a new one) so the anonymous submitter can check back.
  - Rate limiting: new `publicTicketSubmissionAttempts` table + `checkPublicTicketRateLimit`, same DB-log-table-plus-windowed-count pattern as `org_join_code_attempts`/`checkJoinCodeRateLimit` -- the one real rate-limit precedent in this codebase (guest-chat itself has none, by its own documented design).
  - Routes (genuinely unauthenticated, no `requireAuth()`): `GET /api/public/portal/[orgSlug]/kb`, `GET /api/public/portal/[orgSlug]/kb/[slug]`, `POST /api/public/portal/[orgSlug]/tickets`.
- [x] Verification given this sandbox's lack of a live DB/Supabase connection: `bun test` (10/10 pass on the new pure-function suite), `bun build` on every new/changed file (all bundle cleanly -- catches import/syntax errors, not full type errors). Full-project `npx tsc --noEmit` OOM'd in this sandbox (>8GB heap) both times it was attempted -- **not run to completion here**; CI's own Type Check job (AGENTS.md Rule 6 gate) will run it for real before merge.

## Remaining

- [ ] CI must actually run and pass (Lint/Type Check/Build/Unit Tests) -- full-project `tsc --noEmit` could not be completed in this sandbox (OOM), so there is real residual risk of a type error CI will catch that this session didn't.
- [ ] `get_advisors(security)` was not run (no live Supabase MCP connection available in this sandbox this session) -- **must be run against the real project before/at merge**, with particular attention to the new public-portal routes/RLS per this task's own SUCCESS_CRITERIA.
- [ ] No live DB to apply `drizzle/0264_helpdesk_tiered_sla_team_routing.sql` against this session -- migration is hand-written (following the exact existing pattern from `0067_wave81_customer_service_enhancements.sql`/`0146_org_join_codes.sql`) and journal-registered, but **not yet applied to any real database**; whoever merges/deploys this must run it (`bun run db:push` or the standard migration-apply step) before the new tables/columns exist for real.
- [ ] No minimal public-facing UI pages were built for the self-service portal (e.g. `/portal/[orgSlug]`) -- only the API routes exist and are tested. The SPEC's SUCCESS_CRITERIA only requires the anonymous-caller API behavior (browse published KB, raise a ticket without a pre-issued token), which is met; a real page UI is left as a followup if the Owner wants a browsable frontend, not just an API surface.
- [ ] Admin UI for configuring SLA policies/teams/escalation rules/business-hours schedules doesn't exist yet either -- only the CRUD API routes. An org must currently configure these via direct API calls (or a future admin screen) before tiered SLA/team routing or the public portal (which requires a default team) actually activate for that org.
- [ ] PR not yet opened/merged as of this checkpoint -- see git log for the commit(s) this PROGRESS.md update ships with.
# PROGRESS -- task-20260727-094843-architecture-phase-8-increment-1--dspy-e

## Completed
- [x] Read governance docs, registered claim in `ai-os/boss/ACTIVE-CLAIMS.yaml` (pushed standalone before real work)
- [x] Confirmed `python3 scripts/superboss-register.py query-knowledge "veridian_v2_dspy_learning" --tag domain:veridian_architecture_v2` returns found=0 (live, before starting)
- [x] Investigated real state: `src/lib/prompt-compiler/` (phase_2, deterministic/zero-LLM by explicit Owner directive), `services/doc-processing/` (real Python surface, confirmed OCR/PDF/whisper only -- zero prompt-compilation logic), `src/lib/services/capability-learning-service.ts` (re-verified real and current, 295 lines, 10 live callers)
- [x] engine-dspy-integration: confirmed `dspy` pip-installs cleanly (dry-run) alongside doc-processing's pinned `numpy==1.26.4`/`PyMuPDF==1.20.2`, no conflict -- installability is real
- [x] engine-dspy-integration: made a real, justified **reject** decision -- `ai-os/VERIDIAN_V2_DSPY_TECH_DECISION_2026-07-27.md` (every real candidate integration point either contradicts the Owner's existing 2026-07-25 "no second AI pass" directive on phase_2's pipeline, or requires a fresh Python deployment this task explicitly forbids)
- [x] Success-criteria before/after command satisfied via the justified alternative (phase_2's own existing compiler, no new engine built): `bun run scripts/prompt-compiler-smoke-test.ts` -- real sample prompt, 22->9 estimated tokens (-59.1%), exit 0
- [x] engine-ai-learning: re-verified the phase plan's own gap analysis (`ai-os/VERIDIAN_ARCHITECTURE_V2_GAP_ANALYSIS_2026-07-25.yaml:807-815`, claude-control) -- its verdict is "not_implemented / no functional match" against the existing business-task learning loop, which is a DIFFERENT concern (task-execution routing) from the real requirement ("learn from unknown prompts through autonomous exploration/evaluation/registration"). Wired a genuine, minimal extension rather than duplicating: `shouldExploreAsUnknownPrompt()` (pure, unit-tested evaluate step) + `exploreUnknownPrompt()` (DB-touching, reuses `findOrCreateCapability`/`extendPromptWordIndex`) added to `src/lib/services/capability-learning-service.ts`, wired into the real live caller `src/app/api/prompt-compiler/execute/route.ts` (fires when Layer 4 found no template match AND Layer 5 confidence is low). 4 new unit tests, all pass (27/27 total in that test file). `bunx tsc --noEmit` clean on touched files.

- [x] Scope-only pass (schema/table design + build estimate, NOT implementation) for the 5 zero-prior-art engines: `ai-os/VERIDIAN_V2_PROMPT_LIFECYCLE_ENGINES_SCOPING_2026-07-27.md` (claude-control) -- real schema per engine, ~17-19.5 build-days total, no migration/service/route code written (explicit hard boundary honored)
- [x] Registered each of the 5 as a planned (status: planned, not built) entry under `MASTER_INDEX.yaml`'s new `veridian_v2_dspy_learning_distribution_engines` registries entry (claude-control)
- [x] `python3 scripts/superboss-register.py register-knowledge` for `veridian_v2_dspy_learning` -- `query-knowledge "veridian_v2_dspy_learning" --tag domain:veridian_architecture_v2` now returns found=1 (artifact_id `KE-20260727-100048-b8fe`)
- [x] Opened compliance-tracker PR #589 (DSPy decision doc + engine-ai-learning code changes) -- subject to AGENTS.md Rule 6/7(c), awaiting CI + `AUDIT: PASS`/`AUDIT: FAIL` comment before merge
- [x] Opened claude-control PR #113 (phase_8 MASTER_INDEX.yaml registration + 5-engine scoping doc), matching PR #112 precedent

## Remaining
- [ ] compliance-tracker PR #589 and claude-control PR #113 need CI green + (for #589) the mandatory audit comment before merge -- out of this session's hands once opened
- [ ] Move this session's `ACTIVE-CLAIMS.yaml` entry from `active:` to `recently_completed:` once both PRs merge (left `active:` for now since neither has merged yet)
- [ ] Full phase_8 remains open beyond this increment: the phase plan's own `status` field is intentionally left at `not_started` (matching phase_5's own increment-1 precedent of not fabricating an interim status value) -- a future increment should build the 5 scoped-but-unbuilt engines and re-evaluate whether to close out phase_8's `status` field
# PROGRESS -- task-20260727-094516-architecture-phase-5-increment-2--webllm

phase_5_browser_execution_tiers increment 2 of N (claude-control repo's
`ai-os/VERIDIAN_ARCHITECTURE_V2_PHASE_PLAN_2026-07-25.yaml`), continuing
directly from increment 1 (merged compliance-tracker PR #586). Implements
increment 1's own PROGRESS.md "Remaining" checklist verbatim. Full detail,
real evidence, and honest disclosures in
`ai-os/BROWSER_EXECUTION_TIERS_INCREMENT_2_STATUS_2026-07-27.md`.

## Completed

- [x] 1. Real WebLLM model install + wiring: `Qwen2.5-0.5B-Instruct-q4f16_1-MLC`
      (confirmed real in `@mlc-ai/web-llm@0.2.84`'s own `prebuiltAppConfig`),
      wired behind `tier-orchestrator.ts`'s new `shouldAttemptWebLlm` gate
      (`src/lib/browser-execution/webllm-engine.ts`). 7 real tests via
      injected envs/factories: reachable when WebGPU present, honest
      fallback (factory never called) when `navigator.gpu` absent, correct
      `not-selected` when a higher tier wins.
- [x] 2/3. engine-browser-mcp + engine-browser-function: one real
      MCP-JSON-RPC-shaped tool-calling contract
      (`src/lib/browser-execution/tool-calling.ts`) -- real tool registry +
      execution (`BrowserToolRegistry`) and a real JSON-RPC envelope
      (`dispatchMcpToolCall`), reusing `/api/mcp/route.ts`'s existing
      `{name,description,inputSchema}` shape for consistency only (zero
      network hop, fully client-side). Distinct from
      `BROWSER_AUTOMATION_PROFILE`'s session-tooling scope. 9 real tests
      including a genuine register -> call -> execute -> JSON-RPC-envelope
      round trip.
- [x] 4. engine-browser-worker deepening: a real
      `SharedArrayBuffer`/`Atomics`-coordinated multi-worker pool
      (`src/lib/browser-execution/worker-pool.ts`), generalizing beyond
      litert-spike's single-worker pattern. Tested against **real Bun
      `Worker` instances** (`worker-pool-test-worker.ts`) -- concurrent
      dispatch, mid-flight busy-slot snapshot, and real queueing beyond
      pool capacity. 6 real tests.
- [x] 5. engine-browser-transformers: real `Xenova/all-MiniLM-L6-v2`
      wiring via `@huggingface/transformers`
      (`src/lib/browser-execution/transformers-engine.ts`), plus
      cosine-similarity tool selection for this tier's own (embeddings-only)
      tool-calling path. 4 real tests via an injected pipeline factory --
      see the status doc for why (a Bun+sharp/libvips dlopen incompatibility
      in this sandbox, unrelated to this module; real network+model
      integration independently verified via a `node`-run spike: real
      `dims: [1, 384]` output).
- [x] 6. stack-browser-compute / stack-parallelism deepening:
      `tier-orchestrator.ts#planParallelism`, sized off
      `navigator.hardwareConcurrency` via `worker-pool.ts#recommendPoolSize`.
- [x] 7. Tier-local IndexedDB model-weight caching: WebLLM's own native
      `cacheBackend:"indexeddb"` `AppConfig` flag (no custom code); a real
      custom `CacheInterface` adapter for Transformers.js
      (`src/lib/browser-execution/model-cache.ts`, since that library has
      no native IndexedDB option), 4 real put/match/delete round-trip
      tests. Explicitly scoped as engine-local plumbing only, NOT phase_6's
      shared cross-engine cache hierarchy.

## Remaining

- [ ] 8. Update the phase-plan yaml's phase_5 gap-item checklist -- **not
      done in this task**: `ai-os/VERIDIAN_ARCHITECTURE_V2_PHASE_PLAN_2026-07-25.yaml`
      and `OWNER_ENGINE_TASK2_GAP_ANALYSIS_2026-07-27.yaml` both live in the
      separate claude-control repo, confirmed absent from this
      (compliance-tracker) workspace. Flagged as a genuine cross-repo
      follow-up in `ai-os/BROWSER_EXECUTION_TIERS_INCREMENT_2_STATUS_2026-07-27.md`
      rather than silently skipped, matching this phase's own established
      `cross_repo_dispatch_note` precedent.
- [ ] Streaming token-by-token WebLLM output (`asyncGenerate`) -- this
      increment wires non-streaming `chat.completions.create` only.
- [ ] A live-browser (real WebGPU device) manual smoke test -- this
      sandbox has no GPU; not possible from this task.
- [ ] Wiring any of these new engines into `VeriComposer.tsx`'s live send
      path -- explicitly out of scope per this task's own CONSTRAINTS.

## Verification

- `bun test src/lib/browser-execution/`: 58 pass / 0 fail (8 files, 101 `expect()` calls).
- `bun test` (full repo suite): 2088 pass / 0 fail (180 files).
- `NODE_OPTIONS=--max-old-space-size=4096 bunx tsc --noEmit`: 0 errors, repo-wide.
