# ERP Helpdesk/PM/HR Functionality Re-Audit — 2026-07-28

**Scope:** independent re-verification of PR #591 (Helpdesk), #592 (Project Management), #593 (HR) against
**current `main`-branch code** (this session's `origin/main` fetch showed zero commit diff from the working
tree — verification is against the real, current state, not the PRs' own diffs). All 3 PRs are `MERGED`:

| PR | Title | Merge commit | Merged at |
|----|-------|--------------|-----------|
| #591 | Helpdesk: tiered SLA + team routing + email-to-ticket + public portal | `ca177affdedf6085efc8befac94066e88a66bc3c` | 2026-07-27T11:57:04Z |
| #592 | Project Management gaps | `78892cec7a2e40fd51a72282908ddb0efb5257b3` | 2026-07-27T12:38:54Z |
| #593 | HR gaps: expense claims, loans, KRA/360 appraisal, shift roster | `2c35a1e04e4283785009a91e84e50a6339052746` | 2026-07-27T12:47:03Z |

**This is a retry.** An earlier attempt at this exact task (`task-20260727-153100`) stalled for 14+ hours
with ~2 minutes of real CPU time and produced no findings file; it was killed. This is a from-scratch redo,
not a resume.

**Real command output** (this session, environment freshly `bun install`-ed — `node_modules` was empty at
task start):

```
$ bunx tsc --noEmit   (NODE_OPTIONS=--max-old-space-size=8192)
EXIT_CODE:0   (0 "error TS" matches — clean)

$ bun test src/lib/services src/app/api
1044 pass / 0 fail / 1954 expect() calls, 89 files, 1.86s   EXIT_CODE:0

$ bun test    (full suite, no path filter — bunfig.toml scopes root to src/)
2281 pass / 0 fail / 4480 expect() calls, 204 files, 16.02s   EXIT_CODE:0
```

No regressions, no type errors, in the current merged state.

---

## PR #591 — Helpdesk

### Claim 1: Tiered SLA policy + team routing — **VERIFIED**

All 5 claimed tables exist with the claimed columns in `src/lib/db/schema.ts`: `ticketTeams` (5451-5460),
`businessHoursSchedules` (5462-5471), `slaPolicies` (5473-5487), `escalationRules` (5489-5499),
`ticketEscalationEvents` (5503-5508); `tickets.teamId`/`slaPolicyId`/`requesterEmail` (5436-5438).

`createTicket()` (`src/lib/services/ticket-service.ts:131-219`) is real logic: a manual `slaHours` override
still wins unconditionally (178-179, backward compatible); otherwise `resolveSlaPolicy()` (99-102) +
`pickBestSlaPolicy()`/`scoreSlaPolicyMatch()` (33-53) pick the most-specific matching policy, and
`computeSlaDeadline()` (71-97) computes a business-hours-aware deadline.

Escalation cron wiring is real: `checkTicketEscalations()` (294-347, idempotent via `ticketEscalationEvents`)
is actually called from `src/app/api/internal/metric-alerts/run/route.ts:3,54`, and that route is a live
scheduled cron per `vercel.json:9` (`0 5 * * *`) — not dead code.

`ticket-service.test.ts` (82 lines) meaningfully exercises policy scoring and business-hours math (weekend
rollover, all-closed-days case). **Gap:** `createTicket()`, `checkTicketEscalations()`, and
`createTicketFromEmailIntelligenceItem()` — the actual DB-touching paths — have no test coverage anywhere.

**Defect found — schema/migration drift:** `schema.ts:5478` declares `slaPolicies.priority` as the Postgres
enum `priorityEnum`, but `drizzle/0264_helpdesk_tiered_sla_team_routing.sql:51,60` creates it as `text` with a
`CHECK` constraint instead. Functionally equivalent today (same value set enforced), but it's real drizzle-kit
drift between the TS schema and the applied-SQL shape.

**Defect found — missing authorization gate:** the new admin CRUD routes (`ticket-teams`, `sla-policies`,
`escalation-rules`, `business-hours-schedules`) call only `requireAuth()` — confirmed directly by this session
(`src/app/api/ticket-teams/route.ts:2,9,24` — no `requireRole` import at all). **Any authenticated org member,
not just an admin/manager, can reconfigure SLA policies and escalation routing org-wide.** This is inconsistent
with the analogous departments admin-config routes elsewhere in the codebase.

### Claim 2: Email-to-ticket — **VERIFIED**

`emailIntelligenceItems.promotedTicketId` (`schema.ts:10380`). `createTicketFromEmailIntelligenceItem()`
(`ticket-service.ts:496-530`) is fully implemented: loads the org-scoped source row, guards against
double-promotion (505), calls the real `createTicket()`, inserts the original email body as the first
conversation message (522-523), marks the source row promoted (524-526). Not a stub.

### Claim 3: Public self-service portal — **VERIFIED**

`knowledgeBasePages.isPublished` (`schema.ts:4495`). `public-portal-service.ts` (164 lines): anonymous KB
browse (58-77), `submitPublicTicket()` (99-164) routes to the org's default team, rejects 400 if none exists,
issues a real guest-access token via the existing `conversationGuestAccess` mechanism (156-160), and rate-limits
via the same pattern `org-join-code-service.ts` already uses (windowed DB-log count-check, confirmed at
82-92/331-345 respectively). `publicTicketSubmissionAttempts` table confirmed (`schema.ts:834-840`).

### Self-disclosed open items — what this re-audit actually found

- **Full-project `tsc --noEmit`:** the PR author's own sandbox OOM'd on this. **This session ran it clean on
  current `main` (0 errors)** — see command output above. Resolved.
- **`get_advisors(security)`:** no evidence it was ever run, on this PR or since. Still open.
- **`drizzle/0264...sql` applied to the live DB:** cannot be confirmed from static code; no artifact in-repo
  confirms it. Still open.
- **Independent audit gate (AGENTS.md Rule 7(c)/10):** **not actually satisfied.** A comment reading
  `AUDIT: PASS` / `Verdict: pass` was posted on PR #591 at 2026-07-27T11:54:51Z (before the 11:57:04Z merge),
  but `gh api` confirms the comment's author and the PR's own author are **the same GitHub account**
  (`FChecklist`, `author_association: OWNER`) — a self-audit dressed as independent review, not a distinct
  reviewer's verdict as the rule requires. The comment itself is substantively useful — it independently
  flagged both the enum/CHECK migration drift and the missing-role-check issue above — but the PR merged
  with both self-flagged issues left unresolved, and without a real second-identity sign-off.

---

## PR #592 — Project Management

### Claim 1: PMS timesheet → client invoice — **VERIFIED**

`generateInvoiceFromUnbilledProjectTime()` (`src/lib/services/pms-invoice-service.ts:68-161`) is real,
non-stub logic mirroring `firm-billing-service.ts:81-158`. Reuses existing `erpSalesInvoices`
(`schema.ts:6076-6116`) / `erpSalesInvoiceItems` (6154-6169) — no new invoice table. `pms_time_entries` has
`billable` (4223), `hourlyRateSnapshot` (4224), `invoiceItemId` (4225). Anti-double-billing is enforced in the
query itself (`eq(billable, true) AND isNull(invoiceItemId)`, 107-114) plus a same-transaction backfill of
`invoiceItemId` (126-155) — a re-run genuinely finds zero remaining unbilled rows. Route
`src/app/api/pms/invoices/generate/route.ts:11-14` calls `requireAuth()`. Migration
`drizzle/0265_pms_timesheet_invoice_link.sql` matches.

**Gap:** `pms-invoice-service.test.ts` only tests the pure `buildInvoiceLinesFromTimeEntries()` helper — the
actual DB transaction / anti-double-billing filter / "re-run finds zero rows" behavior is verified only by
static reading, not by a test.

### Claim 2: Gantt/critical-path UI (claimed no code change needed) — **VERIFIED**

Independently re-derived, not taken on faith: `calculateCriticalPath()` (`schedule-service.ts:63-151`) does a
genuine forward/backward-pass CPM calculation over `pmsIssueRelations` (95-133) and returns `floatDays` (137)
and `isCritical` (146) per task; `getGanttData()` (153-167) calls it directly and returns the result unmodified.
The "nothing to build" claim holds up — this is real pre-existing logic, not an excuse to skip work.

### Claim 3: Resource-allocation conflict/over-allocation detection — **VERIFIED**

`detectResourceConflicts()` (`schedule-service.ts:283-305`) sums `allocatedHoursPerDay` per user+day across
**all** allocations regardless of `projectId` — genuinely org-wide, a real distinct gap vs. the pre-existing
`getWorkload()` (249-267, single-project only). `getResourceConflicts()` (308-317) queries org-wide, not
per-project. Both new routes exist and are gated
(`src/app/api/pms/schedule/resource-conflicts/route.ts:11-31`,
`src/app/api/v1/projexa/schedule/resource-conflicts/route.ts:11-30`). Both allocation-creation routes return a
`conflicts` array (`pms/schedule/resource-allocations/route.ts:39-49`,
`v1/projexa/schedule/workload/route.ts:24-51` — this second one lives under a `workload` filename rather than
a `resource-allocations` path, a minor naming inconsistency worth flagging but not a functional gap).

`schedule-service.test.ts` (68 lines) is **meaningfully non-superficial**: it directly tests the specific
cross-project double-booking scenario the PR claims to fix (two overlapping allocations in different projects
summing past capacity, non-overlapping negative case, per-user isolation, 3-project summation, exact-boundary
case, custom capacity).

### Self-disclosed open items

- **Independent audit gate:** same pattern as #591 — a PASS comment exists (2026-07-27T12:26:53Z, before the
  12:38:54Z merge) but from the same `FChecklist` author account as the PR itself. Not independent.
- **Migration applied live:** still genuinely unconfirmed — not verifiable from static files.
- **Migration-number collision with #591 (both PR bodies mention "drizzle/0264"):** checked directly —
  **no collision in the current state.** `drizzle/meta/_journal.json` has 265+ unique, sequential `idx`
  values; #591 ended up at `0264_helpdesk_tiered_sla_team_routing`, #592 at
  `0265_pms_timesheet_invoice_link`. The shared "0264" in both PR *bodies* was a drafting-time coincidence
  (both PRs' own text hedged "actual filename may differ"), resolved cleanly by merge time.

---

## PR #593 — HR

### Claim 1: Expense claims/reimbursement — **VERIFIED**

`hrExpenseClaims` (`schema.ts:5164-5184`, status enum pending/approved/rejected/paid at 5162). Real service
logic in `hr-expense-service.ts` (validation, pending-only approval transitions, rejection-reason
requirement). **Payroll integration confirmed live**, not just claimed: `erp-payroll-service.ts:359-368`
(fetch approved claims), `:371` (added to **netPay**, not gross — matches "earning line" claim), `:393-396`
(claims marked paid, `payrollRunId`/`reimbursedAt` set). Routes call `requireAuth()`. Migration
`drizzle/0266...sql:9-33` matches schema.

**Gap:** tests cover the pure line-builder and input validation only — no live-DB test of
`processPayrollRun()`'s actual claim-marking side effect.

### Claim 2: Employee loans/salary advances — **VERIFIED**

`hrEmployeeLoans`/`hrLoanInstallments` (`schema.ts:5211-5232`, 5237-5249). `computeLoanInstallmentSchedule()`/
`computeInstallmentDueDates()` are real pure functions; `decideLoan()` (90-126) generates the full schedule at
approval. **Payroll integration confirmed live**: `erp-payroll-service.ts:347-357` (finds active
loan+earliest-pending installment), `:381-390` (marks installment deducted, decrements balance, closes loan at
`isFullyRepaid` via `installmentNumber >= numInstallments`, line 385). Migration `drizzle/0266...sql:48-79`
matches.

**Gap:** the zero-balance loan-closure state transition inside `processPayrollRun()` has no live-DB test —
only the pure line-builder is unit-tested.

**Defect found and independently confirmed by this session (not just the sub-agent):** `POST /api/hr/loans`
(`src/app/api/hr/loans/route.ts:20-30`) calls only `requireAuth()`, and passes the request `body` straight
through to `requestLoan()`. `requestLoan()`'s signature (`hr-loan-service.ts:72-74`) takes `employeeId` **from
that body**, not derived from `dbUser.id` — confirmed by reading both files directly. **Any authenticated org
member can submit a loan request "as" an arbitrary employee in the same org** by supplying a different
`employeeId` in the POST body; the actor's own identity plays no role in whose loan record gets created.
Exploitation impact is bounded (a manager must still approve via `decideLoan`, so this is a
data-integrity/spoofing gap rather than a direct funds-theft path), but it is real and unresolved on current
`main`. `GET /api/hr/loans`, `GET /api/hr/expenses`, `GET /api/hr/shifts/roster` similarly have no
`requireRole` gate — any authenticated org member can list other employees' loan/expense/roster records when
the `employeeId` filter param is simply omitted (confirmed: none of these three GET handlers import or call
`requireRole`).

### Claim 3: KRA/weighted-goal + 360 appraisal — **VERIFIED**

`performanceReviewGoals`/`performanceReviewRaters` (`schema.ts:8105-8116`, 8118-8129), additive to
`performanceReviews` (only new nullable `weightedScore` column, 8076). `computeWeightedScore()`
(`performance-service.ts:133-143`) enforces weights summing to 100 (±0.01) and every goal rated before scoring
— genuinely enforced, not just documented. This has the **strongest test coverage of the four HR features**:
`performance-service.test.ts` directly tests both the weights-don't-sum-to-100 and unrated-goal failure paths.

### Claim 4: Shift management/roster — **VERIFIED**

`hrShiftTypes`/`hrShiftRosterAssignments` (`schema.ts:5355-5362`, 5364-5373); `hrAttendanceRecords.shiftTypeId`
snapshot column (5335). `resolveShiftForDate()` is real pure logic; **attendance-integration confirmed live**:
`hr-attendance-service.ts`'s private `resolveShiftTypeId` helper (264-270) is invoked from both `checkIn()`
(277) and mark-attendance (380), with the resolved shift persisted into the attendance row. Roster-assignment
POST is `requireRole`-gated to manager (unlike the loans/expenses gaps above).

**Gap:** no test exercises the attendance-integration snapshot behavior itself, only the pure
`resolveShiftForDate()` function.

### Additional verification items

- **Stale "Payroll deliberately out of scope" comment fix — CONFIRMED FIXED.** `hr-service.ts:7-15` now
  contains a dated correction comment explaining the removal. Confirmed the original wrong sentence is gone.
- **Governance spot-check — confirmed, with one minor drift.** All 7 new tables have reasoned entries in
  `ai-os/registry/asset-registry-coverage.yaml` (lines 441-450, 779-782), and exactly 8 new-file
  terminology-guardrail exemptions were added as claimed (`ai-os/registry/terminology-guardrail-exemptions.yaml`
  lines 1035-1066). **Drift:** all 7 registry entries cite `"drizzle/0264"` as the migration, but the file on
  disk is `drizzle/0266_hr_gap_closure_expense_loan_appraisal_shift.sql` — a leftover from a mid-development
  renumbering (`git log` shows commit `e0be9517`, "renumber migration 0264->0266") that never got reflected
  back into the registry comment text. Comment-only, no functional impact, but a real stale reference in
  committed governance metadata.
- **RLS pattern comparison vs. `drizzle/0050` — mostly verified, one nuance.** The new migration
  (`drizzle/0266...sql:151-163`) applies both `ENABLE` and `FORCE ROW LEVEL SECURITY` together, matching
  policy shapes/`current_org_id()` usage from `drizzle/0050`. However, `drizzle/0050`'s **own** file
  (`drizzle/0050_wave56_erp_statutory_payroll.sql:111-121`) only ever applied `ENABLE`, not `FORCE` — `FORCE`
  was retroactively backfilled onto 0050's tables by a separate, later migration
  (`drizzle/0116_wave134_force_rls_all_tables.sql`). So the new tables correctly match the *current* combined
  state of 0050's tables, but the PR's own claim ("mirrors drizzle/0050's own header") slightly overstates
  which single migration file the pattern actually came from.
- **Independent audit gate — the PR's own self-disclosure is inaccurate.** The PR body states "Mandatory
  independent audit-verdict comment ... required before merge, not self-certified by this session" as an open
  item, implying none was posted. In fact `gh api repos/:owner/:repo/issues/593/comments` shows an
  `AUDIT: PASS` comment from account `FChecklist` posted 2026-07-27T12:26:54Z — **about 20 minutes before**
  the 12:47:03Z merge. (Same self-audit-identity caveat as #591/#592 applies — worth noting for the pattern,
  though this specific self-disclosure was simply stale/wrong rather than describing a self-audit.) That
  audit comment itself correctly flagged the loan/expense/roster authorization gaps described above as
  non-blocking; they remain unresolved on `main` today.
- **Test-count claim ("2073 pass / 0 fail, full suite") — re-verified directly, found plausible.** A static
  grep-based sub-check estimated only ~600-750 test cases visible under `src/`, which looked like a
  discrepancy worth flagging. **This session ran the real full `bun test` (no path filter) on current `main`
  and got 2281 pass / 0 fail across 204 files** — higher than the 2073 claimed at PR #593's merge time on
  2026-07-27, which is consistent with normal net growth from the several PRs merged afterward (including
  #596/#597 and this repo's other same-day HR/PM/Helpdesk work). The static grep undercounts real executed
  test cases (bun's runtime count includes patterns a simple `grep -c "test("` misses); the claim holds up
  against real command execution.

---

## Summary verdict

All 10 individually-claimed feature items across the 3 PRs (3 in #591, 3 in #592, 4 in #593) are **VERIFIED**
as genuinely implemented in current `main`-branch code — real schema, real service logic (not stubs), real
API routes, real migrations consistent with schema (with one cosmetic enum/CHECK drift in #591 and one stale
comment-reference drift in #593's registry). `tsc --noEmit` is clean and the real, freshly-run full test suite
passes 2281/0 with no regressions.

The genuine, unresolved gaps this re-audit surfaces are **authorization**, not functionality:

1. **PR #591:** new SLA/escalation/team-routing admin config routes have no role gate — any authenticated org
   member can reconfigure them.
2. **PR #593:** `POST /api/hr/loans` trusts a client-supplied `employeeId` with no ownership check, and the
   loans/expenses/shift-roster GET endpoints have no role gate — any authenticated org member can list or
   spoof-request against other employees' financial records.

Both were independently self-flagged in each PR's own (same-author) audit comment before merge and left
unresolved. Neither PR's "independent, non-self audit-verdict comment" requirement (AGENTS.md Rule 7(c)/10)
was actually satisfied by a distinct reviewer identity — all three audit comments across #591/#592/#593 were
posted by the same GitHub account (`FChecklist`) that authored the PRs themselves.

**Recommendation:** these two authorization gaps should be filed as new, narrowly-scoped follow-up gaps
(add `requireRole` checks to the affected routes) — they do not invalidate the underlying feature-completion
claims, which are real, but they are genuine security-relevant defects that shipped to `main` unresolved.

---

*Verification method: 3 independent read-only code-exploration agents (one per PR), each instructed to read
current `main`-branch files directly and cite file:line evidence rather than trust PR descriptions; findings
cross-checked by this session for the highest-impact claims (loan-request authorization, migration-collision
check, full test-suite count) via direct file reads and real command execution. No code changes were made
outside this file, `ai-os/boss/ACTIVE-CLAIMS.yaml` (claim registration), and `PROGRESS.md`.*
