# Maintainability Scorecard

VERIDIAN Review Framework gap-closure (2026-07-18), "Maintainability" (High):
*"No consolidated maintainability score/dashboard."* Recommended approach:
*"Wire audit role outputs into a scored dashboard surfaced in ai-os/."*

This file is a **pointer + methodology doc**, not a data dump -- the live
score changes on every AI Team dispatch and loop run, so nothing here is a
snapshot. Query the real, current number from the API below.

## Where the live score lives

- Service: `src/lib/services/maintainability-dashboard-service.ts`
  (`getMaintainabilityScorecard(orgId)`, pure combiner `computeMaintainabilityScore`,
  unit-tested in the file's own `.test.ts`).
- API: `GET /api/ai/team/maintainability-dashboard` -- `veridian_admin`-only,
  same gating as its sibling `/api/ai/team/governance-health`.

## What it's built from (real signals only -- nothing fabricated)

| Sub-score | Source | What it measures |
|---|---|---|
| `guardrailViolationScore` | `loop_improvements` rows with `improvement_type = 'guardrail_violation'` (written by `guardrail-engine.ts`'s `recordGuardrailViolation()` -- every real BLOCK/FAIL the Guardrail Team's checks have produced), as a rate against total loop-improvement volume in the same trailing window (default 30d) | How often the platform's own written standards are actually being violated |
| `improvementBacklogScore` | `loop_improvements` rows still `is_deployed = false` past a staleness window (default 30d) | Audit-identified technical debt / improvements found but never actioned (`VERIDIAN_AUDIT_ORGANIZATION.md`'s "Technical Debt Management" responsibility) |
| `dependencyHealthScore` | Reused verbatim from `monitoring-engine.ts::computeGovernanceHealthScore()` (via `activity-log-service.ts::getGovernanceHealthCounts(orgId)`) | How often terminal AI-dispatched work actually fails |

`maintainabilityScore` is the unweighted average of the three, clamped to
0-100 -- same simple-ratio style `computeGovernanceHealthScore` already uses,
not a new scoring philosophy.

## What this deliberately does NOT cover, and why

`VERIDIAN_AUDIT_ORGANIZATION.md`'s "The Chief Audit Officer" section already
made this call once, for the roster: the ~149 named "Specialized Audit
Agents" in the source document (Static Analysis Auditor, **Maintainability
Auditor**, Code Duplication Auditor, Dependency Auditor, ...) were
deliberately **not** built as individual dispatchable roles -- most of what
they'd check is already checked by CI (deterministic, free, instant) or the
12 real Guardrail-team roles (LLM-backed, already dispatchable), and
manufacturing 149 roles nobody calls would be the exact documentation-theater
that framework exists to avoid. This scorecard applies the same discipline to
the *dashboard* half of that gap: it wires the REAL outputs those already-real
mechanisms produce (guardrail violations, improvement backlog, dependency
health) into one number, instead of inventing a fake per-file complexity
score with no real computation behind it.

Two dimensions genuinely have no live source anywhere in this codebase today
and are reported honestly as `notCovered` in the API response rather than
fabricated:
- **Static analysis** (cyclomatic complexity, duplication %) -- CI's
  lint/typecheck (`GP-15`) is the real enforcement; results aren't persisted
  to Postgres.
- **Dependency freshness** -- Dependabot PRs are the real mechanism (see
  `ai-os/boss/ACTIVE-CLAIMS.yaml`'s Dependabot-triage entries); no live
  inventory table exists to score against.

If either of those becomes genuinely trackable in the future (e.g. a CI step
that writes its own summary row to Postgres), add it as a 4th sub-score here
-- don't invent a number for it now.
