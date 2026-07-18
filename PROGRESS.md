# PROGRESS -- task-20260718-091004-checks---balances--risk--fraud---anomaly

VERIDIAN Review Framework gap-closure: Checks & Balances / Risk, Fraud & Anomaly Detection.
8 findings received = 4 distinct issues, each duplicated once. Investigated the real
current state of each before writing any code -- all 4 were still real gaps, not
already resolved (see "Findings re-verified" below).

## Findings re-verified against current code (before writing anything)

- **Anomaly Detection**: confirmed still real, but the "~30 event types, 1 wired"
  framing in PLATFORM_STRATEGY.md #29 is entirely **AI-Ops scoped**
  (TASK_CREATED, APPROVAL_GRANTED, DOCUMENT_APPROVED, etc. -- monitor_agents /
  escalation-ladder.ts / monitor-protocol.ts govern AI Dev Team dispatch health,
  not business risk). There is a **separate, real gap**: zero rule-engine
  monitors existed for business-facing risk events. Built net-new, not extending #29.
- **Fraud & Abuse Detection**: confirmed -- `fraud-case-service.ts` was pure CRUD,
  zero detection logic, `detectionSource: 'system_alert'` existed in the enum but
  nothing ever set it.
- **Policy Compliance Verification**: confirmed -- `framework_controls.status`
  PATCH route cycled state forward on a button click with zero evidence input.
  No `get_advisors`/CI-gate integration exists anywhere in `src/` (confirmed by
  grep -- correctly not fabricated). Real available evidence signal in-schema:
  `audit_findings.retestResult`, reachable via `risks.linkedControlIds` ->
  `audit_findings.linkedRiskId`.
- **Risk-Based Escalation**: confirmed -- `escalation-ladder.ts` /
  `docs/ESCALATION_MATRIX.md` are entirely AI-operational-failure-shaped
  (CSEO/COO/Super Boss). No business-risk-event escalation path existed anywhere.

## Completed
- [x] Read governance docs (ACTIVE-CLAIMS.yaml, AGENTS.md, CLAUDE.md, PLATFORM_STRATEGY.md #29)
- [x] Registered active claim in `ai-os/boss/ACTIVE-CLAIMS.yaml`, committed + pushed standalone
- [x] Full codebase investigation (schema, services, routes) for all 4 findings
- [x] Schema: `risk_anomaly_events` (org-scoped, FORCE RLS) + `auth_failure_events`
      (pre-auth, no org, service_role-only -- mirrors `passcode_login_attempts`) --
      `drizzle/0236_risk_anomaly_detection.sql` (renumbered from 0225 during
      main-merge rescue, since main's real highest had advanced to 0235),
      both exempted in
      `ai-os/registry/asset-registry-coverage.yaml` (append-only event logs, same
      class as `monitor_execution_log`/`passcode_login_attempts`)
- [x] `src/lib/risk-anomaly-detection.ts` -- pure Tier-1 rule functions (bulk export,
      after-hours high-impact, repeated failed auth, duplicate payment,
      round-number/threshold-avoidance) + full unit test coverage (19 tests)
- [x] `src/lib/services/risk-escalation-service.ts` -- `recordAndEscalateAnomaly()` +
      `resolveRiskEscalationOwner()` (department head via `departments.head_id`,
      org-admin fallback, self-escalation explicitly excluded at both levels)
- [x] `src/lib/services/auth-failure-service.ts` + `POST /api/auth/failure-event`
      (public, pre-auth) + wired into `login-form.tsx` (password path) and
      `passcode-login-service.ts`'s `recordAttempt` (unifies passcode failures
      into the same monitor without touching its own internal rate-limit table)
- [x] Fraud rule signals wired into `erp-payment-entries-service.ts::createPaymentEntry`
      (duplicate-payment + round-number/threshold-avoidance) -> auto-creates a
      `fraud_cases` row via new `createFraudCaseTx()` (tx-safe variant -- avoids a
      nested `withTenantContext` deadlock against this app's single-connection
      pool) with `detectionSource: 'system_alert'`, then escalates
- [x] After-hours high-impact wiring: `erp-payment-entries-service.ts::decidePaymentEntry`
      (approved branch), `frameworks/controls/[id]/route.ts` (verified transition)
- [x] Policy compliance verification gate in `frameworks/controls/[id]/route.ts` PATCH:
      blocks self-attested `'verified'` unless a linked risk has a passed
      audit-finding retest as evidence (`hasVerificationEvidence()` in
      `risk-register-service.ts`)
- [x] Risk-based escalation wiring: `risk-register-service.ts::createRisk` (high
      severity), `fraud-case-service.ts::updateFraudCaseStatus` (confirmed status --
      the finding's own named example)
- [x] Bulk export observability: `POST /api/compliance/export-event` + wired into
      both compliance/page.tsx and reports/page.tsx CSV export buttons (previously
      100% client-side, logged nothing)
- [x] `bun test` (1440 pass, 0 fail), `tsc --noEmit` (clean), `eslint .` (0 errors),
      `check-asset-registry-coverage.mjs` (433/433 tables accounted for),
      `check-guardrail-presence.mjs` (88/88 markers present)

## Self-review pass (8-angle code-review before commit) -- caught and fixed 7 real issues
- [x] **Critical**: `hasVerificationEvidence`'s evidence chain was permanently unsatisfiable --
      nothing anywhere wrote `risks.linkedControlIds` past its `[]` default, so no framework
      control could ever reach `'verified'`. Fixed: added `updateRiskLinkedControls()` +
      `PATCH /api/risks/[id]/linked-controls` (the only writer of that column).
- [x] Consolidated `erp-payment-entries-service.ts::createPaymentEntry`'s fraud check to create
      at most ONE fraud case/escalation per payment (was creating 2 separate cases when a
      payment tripped both the duplicate-payment and threshold-avoidance rules).
- [x] Fixed an escalation storm: `auth-failure-service.ts` now escalates at most once per
      rate-limit window per account (was re-escalating on every single failed attempt past
      the threshold, paging the resolved owner repeatedly for one ongoing incident).
- [x] Fixed idempotency regression in `frameworks/controls/[id]/route.ts`: a repeat PATCH on an
      already-`'verified'` control (no real status change) now short-circuits before the
      evidence gate/after-hours check, instead of re-running side effects on every re-click.
- [x] Fixed `severityFromScore`'s fallback (risk-register-service.ts): a likelihood/impact score
      outside every configured band now clamps to the nearest edge band instead of silently
      defaulting to `'medium'` -- matters now that `createRisk`'s new high-severity escalation
      depends on this function.
- [x] `resolveRiskEscalationOwner` no longer does an unbounded `findMany` of every active org
      user to pick one admin -- two targeted, actor-excluded, LIMIT-1 queries instead.
- [x] Frontend: `frameworks/page.tsx`'s advance button now surfaces the new 409 "blocked"
      response via toast instead of silently no-op'ing.
- [x] Added a composite index on `erp_payment_entries` (org/party/type/date) and a GIN index on
      `risks.linked_control_ids` for the two new query patterns this gap-closure introduces.

## Remaining
- [ ] Move ACTIVE-CLAIMS.yaml entry to `recently_completed` once this PR merges
- [ ] Out of scope, noted for a future pass: Google OAuth / SSO login failures still
      aren't logged (only password + passcode are wired) -- password is the primary
      brute-force vector, SSO/OAuth failures are a smaller, separate surface
- [ ] Out of scope: `DEFAULT_PAYMENT_APPROVAL_THRESHOLD` (₹100,000) is a fixed
      constant, not yet an org-configurable value via `module-rules-resolver.ts` --
      noted in the code as the natural extension point if a real org needs a
      different threshold
- [ ] Out of scope: `PATCH /api/risks/[id]/linked-controls` has no UI yet -- a real
      user can call the API today but there's no risks-page control to pick which
      framework controls a risk covers. Building that UI is a reasonable next step,
      not done here to keep this already-large gap-closure bounded.
