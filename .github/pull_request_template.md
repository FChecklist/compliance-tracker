<!--
Added Wave 144 (VERIDIAN.docx joint implementation plan, Phase 1 item 7).
Both independent studies (Study_by_Claude.md/GapAnalysis_by_Claude.md,
Study_by_zaizlm5.2.md/GapAnalysis_by_zaizlm5.2.md) flagged this as the
cheapest, highest-leverage fix available: the VERIDIAN Constitution's AI
Coding Directive (Principle 14) and Platform Evolution Principle (17)
require checking for an existing capability before writing new code, and
the tooling to do that already exists (capability-registry-service.ts's
findSimilarCapabilities()/auditDuplicateCapabilities()) -- it just wasn't
mandated anywhere. This template is the mandate.

Extended audit198 gap-closure wave 2 (2026-07-21, ARTICLE-068/075,
CI_CD_TESTING): the Capability Registry check above already covers
duplicate-avoidance traceability; these two new sections close the
remaining gap -- every change traceable to a concrete requirement/defect/
task, and every bug-fix PR carrying real regression protection, not just
a code diff.
-->

## What does this PR do?



## Traceability (ARTICLE-068: every change traceable to a requirement, defect, enhancement, or approved task)

- [ ] This PR links the specific WAVE/task id, `ai-os/boss/COMPLETED.yaml` or `ACTIVE-CLAIMS.yaml` entry, GitHub issue, or Owner-directive quote it addresses:



## Capability Registry check (required if this PR adds a new service/module/worker-agent/automation-rule/prompt-pattern)

- [ ] I called `findSimilarCapabilities()` (or `auditDuplicateCapabilities()`) against the new capability's description before writing it, and confirmed no existing capability already covers it — OR this PR doesn't add a new capability (bug fix, docs, config, UI-only, etc.)
- [ ] If a close-but-not-exact match existed, I extended/configured it instead of duplicating it, or documented here why that wasn't possible.

## Test plan

- [ ]

## Regression protection (ARTICLE-075: every resolved defect includes regression protection to prevent recurrence)

- [ ] If this PR fixes a bug/defect: a test that fails on `main` (before this change) and passes on this branch (after this change) is included in this diff — OR this PR isn't a bug fix.
- [ ] If a regression test genuinely isn't possible (e.g. the defect can't be triggered outside a live third-party integration), the reason is stated here:
