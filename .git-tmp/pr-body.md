## Summary

VERIDIAN Review Framework gap-closure: **Business Rules Engine / Rule Lifecycle Management** (`task-20260718-080006`). Closes 3 of the 4 named findings in one PR (they share the same module/area); the 4th (Simulation, Low priority) is explicitly deferred per its own recommended approach.

| Finding | Priority | Status |
|---|---|---|
| Business Rule Engine Completeness | High | ✅ Closed |
| Business Rule Versioning | High | ✅ Closed |
| Business Rule Testing Framework | Medium | ✅ Closed |
| Business Rule Simulation | Low | ⏸️ Deferred (per its own recommendation: "revisit after the base engine and testing framework ship") |

Verified before writing any code that the gap was still real: every existing "rule" table in this schema (`automationRules`, `erpPricingRules`, `moduleRuleConfigs`, `documentMatchingRules`, `approvalWorkflowStepDefinitions`) is single-condition (`{field, operator, value}`), with no lifecycle status, no version history, and no dry-run mode. None of them is touched by this PR — this is a new, additive-only module.

## What's new

- **Engine** — `businessRules` table: nested `AND`/`OR` condition tree (not just a single comparison) + an `action` payload, modeled on `approvalWorkflowStepDefinitions`' `conditionField`/`Operator`/`Value` precedent per the finding's own recommended approach, generalized into a recursive tree.
- **Lifecycle** — `draft → active → deprecated → archived` state machine (`deprecated` can reactivate back to `active`; `archived` is terminal), enforced server-side (`canTransitionRuleStatus`).
- **Versioning** — `businessRuleVersions` is an append-only snapshot history: any content change writes a new version row, never mutates a prior one. Rollback writes a *new* version copying an older snapshot, so history is never rewritten.
- **Testing framework** — `testBusinessRule()` dry-runs a rule's condition tree against a caller-supplied sample record with **zero side effects**: the action is only previewed (`actionPreview`), never executed. Logged to `businessRuleTestRuns`.

## Explicitly out of scope (documented, not silently dropped)

- **Simulation** (4th finding) — deferred per its own recommendation. The building blocks (`evaluateConditionTree`, `businessRuleTestRuns`) are reusable for a future batch/what-if mode without a redesign.
- **UI** — no `(app)/business-rules` page. The 4 named findings are all about the engine/API layer; same posture as `moduleRuleConfigs`' own "no rule-setting API/UI yet" scoping note elsewhere in `schema.ts`.
- **Auto-execution** — wiring the evaluator into a real module's event path (the way `automationRules.evaluateAndRunRules()` is called from `notice-service.ts`/`pms-issue-service.ts`) is out of scope; the finding asks for author/store/evaluate, not replacing every module's own logic.

## Files

- `src/lib/db/schema.ts` — new `businessRules`/`businessRuleVersions`/`businessRuleTestRuns` tables + `business_rule_status`/`business_rule_operator` enums (additive only, "Wave 173" section).
- `drizzle/0225_business_rules_engine.sql` — hand-written SQL migration (matches this repo's established convention — `drizzle/meta` hasn't tracked a real snapshot since `0000`), `IF NOT EXISTS` throughout, FORCE RLS + org-scoped policy + service_role bypass on all 3 tables.
- `src/lib/services/business-rules-service.ts` (+ `.test.ts`) — pure condition-tree evaluator/validator, CRUD, lifecycle transitions, rollback, dry-run test.
- `src/app/api/business-rules/**` — `route.ts` (list/create), `[id]/route.ts` (get/update/soft-archive), `[id]/activate`, `[id]/deprecate`, `[id]/versions`, `[id]/rollback`, `[id]/dry-run` (named `dry-run` not `test` — this repo's `.gitignore` has a bare `test` pattern that matches at any depth and silently untracks a `.../test/route.ts` path; found live and worked around).

Did **not** touch `permission-service.ts`'s `ERP_ACTION_ROLES` table structure, or any existing rule engine (`automationRules`, `erpPricingRules`, `moduleRuleConfigs`, `documentMatchingRules`), per the task's explicit scope boundary.

## Testing

- `bun test src/lib/services/business-rules-service.test.ts` — 19 pass, 0 fail, 37 assertions (evaluator, validator, lifecycle state machine — all pure-function, no DB needed).
- `eslint` on every new file — clean.
- `tsc --noEmit` (full project) — clean (needed `NODE_OPTIONS=--max-old-space-size=4096` in this sandbox to avoid an OOM; unrelated to this change).
- Migration not applied to a live DB in this session (no `DATABASE_URL` in this sandbox) — ready for the normal `db:push`/CI migration path.

🤖 Generated with [Claude Code](https://claude.com/claude-code)
