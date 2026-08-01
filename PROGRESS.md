# PROGRESS -- task-20260801-173614-retry-ai-cost-governance-finops-cost-vis

Redispatch of task-20260718-062003 (blocked at first invocation by the
OpenRouter/Cerebras balance hard-stop in preflight-guard.py, since removed
per commit 7ff5be8, 2026-08-01). This invocation resumed a workspace that
already contained substantial uncommitted work from an earlier invocation of
this same task (PROGRESS.md itself had been reset to "Not started" without
the actual code changes being recorded) -- this session's job was to review
that existing work for correctness/completeness against the 4 findings,
verify it, close any real gaps, and land it.

## Completed
- [x] Read `ai-os/boss/ACTIVE-CLAIMS.yaml` -- no conflicting claim; registered
      this task's own claim (commit f2f06cb1, pushed standalone first).
- [x] Reviewed all pre-existing uncommitted work file-by-file against the 4
      findings before treating any of it as done (per this task's own "read
      the actual current implementation first" instruction):
  - **Finding 1 (Low, per-tenant visibility UI)**: confirmed real --
    `src/app/(app)/ai-cost-governance/page.tsx` consumes the existing
    `GET /api/ai/team/token-usage`, veridian_admin-gated, linked from the
    sidebar (Tools -> "AI Cost & FinOps"). `token-usage-service.ts`'s
    `byOrg` query was extended (additive: new `groupLabel` field via a left
    join to `organisations`) to resolve org_id to a real org name instead of
    a raw id -- was the one genuine gap in "UI-surfaced" visibility.
  - **Finding 2 (Medium, invoice reconciliation)** + **Finding 3 (Medium,
    measured not estimated)**: both closed by the same feature, per the
    findings' own shared recommended approach (manual monthly reconciliation
    first). New `compliance.ai_cost_reconciliations` table (migration 0304,
    RLS + service_role policy, unique index on period_month+provider),
    `cost-reconciliation-service.ts` (pure helpers `parsePeriodMonth`/
    `computeVariance`/`averageAbsPct` unit-tested; DB-touching
    `recordReconciliation`/`listReconciliations`/
    `getReconciliationDriftSummary` follow the same pure/DB-touching split
    as `cost-anomaly-service.ts`), `GET`/`POST /api/finance/ai-cost-reconciliation`
    (veridian_admin-gated, real input validation), surfaced in the page's
    "Monthly Invoice Reconciliation" table + an "Estimate Accuracy" KPI
    tile. Honest limitation stated directly in the UI and in
    `docs/AI_COST_GOVERNANCE_FINOPS.md` §4: no wired provider exposes true
    per-request billing, so an *exact* per-action reconciliation isn't
    buildable with real data -- what's delivered is a measured confidence
    bound (avg |variance%|) on the existing token-count estimate, not a
    workaround pretending to be exact.
  - **Finding 4 (Low, cross-repo spend visibility)**: confirmed the
    unification is real today (PROJEXA has zero local LLM client; every
    AI-adjacent call routes back through this repo's `/api/v1/projexa/*` via
    `veridian-client.ts`, landing in the same `token_usage_ledger`) but was
    an architectural byproduct with no CI guarantee it stays true --
    documented in `docs/AI_COST_GOVERNANCE_FINOPS.md` §2, with a companion
    guardrail script already opened as `FChecklist/projexa#68`
    (`check-no-provider-api-keys.mjs`). Disclosed honestly: that PR is not
    yet wired into projexa's CI (the authoring session's token lacked the
    `workflow` OAuth scope needed to push a workflow-file change) -- the
    exact job to add is in that PR's description.
- [x] Verified no collision: migration number 0304 is free on current
      `origin/main` (470033e6); `check-migration-collision.mjs` passes.
- [x] Verified governance/registry state is consistent and complete:
      `ai_cost_reconciliations` is a real, justified `asset-registry-coverage.yaml`
      exemption (financial audit record, no meaningful display name); the 2
      new-file terminology-guardrail exemptions (page.tsx's dated comments,
      test.ts's fixture dates) are genuine, not hardcoded-business-data
      workarounds; `drizzle/meta/_journal.json` has the matching entry;
      `docs/` is already blanket-exempted from `check-metadata-index-coverage.mjs`
      so the new doc needs no separate index entry.
- [x] Installed a working `bun` toolchain in this session's sandbox (absent
      at session start) to actually run tests rather than relying on `tsc`/
      `eslint` alone.
- [x] `NODE_OPTIONS=--max-old-space-size=8192 npx tsc --noEmit` -- clean, 0 errors.
- [x] `bun run lint` -- 0 errors (3 pre-existing warnings, all in unrelated
      files, unaffected by this change).
- [x] `bun test src/lib/services/cost-reconciliation-service.test.ts` -- 10
      pass, 0 fail, 17 expect() calls.
- [x] Full `bun test` -- 2480 pass, 0 fail, 4942 expect() calls (the several
      lines that look like errors in the output are intentional fail-closed
      test scenarios in unrelated pre-existing suites, not real failures).
- [x] All 5 governance check scripts pass: asset-registry-coverage,
      migration-collision, terminology-guardrail (--diff-only),
      guardrail-presence, metadata-index-coverage; plus
      doc-cross-references and doc-quarantine-banner (unaffected, run for
      completeness since a new doc file was added).
- [x] Committed all work and pushed to
      `worker/task-20260801-173614-retry-ai-cost-governance-finops-cost-vis`.

- [x] Opened PR #687: https://github.com/FChecklist/compliance-tracker/pull/687

## Remaining
- [ ] Confirm CI passes on PR #687, then awaiting fresh supervisor audit
      before merge (per this repo's Rule 6 -- not self-merged).
- [ ] `FChecklist/projexa#68`'s CI wiring is still pending someone with the
      GitHub `workflow` OAuth scope (or the web UI) -- not this task's repo
      to fix, disclosed here so it isn't silently forgotten.
