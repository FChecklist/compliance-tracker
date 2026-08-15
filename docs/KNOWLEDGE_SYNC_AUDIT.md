# Knowledge Synchronization Between Code and Documentation

VERIDIAN Review Framework gap-closure, "AI Maintainability / Change Risk
Management" -- **[Medium] Knowledge Synchronization Between Code and
Documentation**. Gap: "Sync checks are structural, not semantic (duplicate
of AI Documentation row 67 finding)." Recommended approach: "Same
recommendation as row 67: periodic manual audit passes as the practical
complement to structural CI checks."

## What already exists (structural)

`scripts/check-doc-cross-references.mjs` verifies that every path a
governance doc (`CLAUDE.md`, `AGENTS.md`, `ai-os/OS.yaml`,
`docs/master/INDEX.md`, `ai-os/BRAIN.md`,
`VERIDIAN_TASK_GOVERNANCE_CONSTITUTION.md`) references by
link/backtick/YAML `path:` key still resolves on disk. This is a real,
CI-enforced check (same class as `check-guardrail-presence.mjs`,
`check-asset-registry-coverage.mjs`, `check-metadata-index-coverage.mjs`) --
but it only proves **link validity** ("does this path exist"), not
**semantic accuracy** ("does this doc's prose still correctly describe what
the code at that path does today"). A doc can link to a real, existing file
and still describe stale, superseded, or since-refactored behavior --
`check-doc-cross-references.mjs` cannot catch that, by construction (see
its own header comment for the same honest framing).

This finding is a confirmed duplicate of the prior "AI Documentation" row
67 finding (already closed via PR #685 / PR #1039 / PR #1047 / PR #1048),
which reached the identical conclusion and recommendation. Building a
second, differently-named semantic-drift detector here would duplicate
that closure rather than add anything -- consistent with this task's own
instruction to say so rather than make an unnecessary change when a
finding turns out to already match prior work.

## The practical complement: periodic manual audit cadence

No automated tool can currently verify semantic doc-vs-code accuracy at
CI-gate speed without an LLM call per doc per PR (a real cost/latency
tradeoff, not attempted here). The documented, honest complement is a
**periodic manual audit pass**, and this codebase already has a real home
for exactly that: `src/lib/audit-cadence.ts`'s L5 (Daily Governance
Review) / L6 (Weekly Strategic Review) / L7 (Monthly Organizational Audit)
-- periodic, org-wide cadences already named in
`ai-os/audit-tree/02-audit-organization.yaml` for "deep operational
analysis," "architecture, KPIs, recurring issues," and "long-term
improvements" respectively.

**Concrete addition**: whichever session runs an L6 (Weekly Strategic
Review) pass should include, as one of its checklist items, spot-checking
2-3 of the 6 cross-referenced governance docs above (rotate through them
week to week) against the actual current code/behavior they describe --
not just that their links resolve (already CI-enforced) but that their
prose is still true. Record findings the same way `docs/master/
AUDIT_2026-07-09.md` and `docs/master/GAP_CLOSURE_LOG.md` already do for
other periodic passes.

This is process guidance layered onto an existing, already-documented
cadence -- not a new mechanism, a new schedule, or new code. Per
`ai-os/audit-tree/02-audit-organization.yaml`'s own scope (see
`audit-cadence.ts`'s header), L5/L6/L7 are not yet wired as real cron
loops; the same "needs cron wiring + the Universal Task Lifecycle's query
surface" follow-up already named there applies here too, honestly carried
forward rather than re-invented.
