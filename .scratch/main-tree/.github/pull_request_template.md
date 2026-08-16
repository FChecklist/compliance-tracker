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
-->

## What does this PR do?



## Capability Registry check (required if this PR adds a new service/module/worker-agent/automation-rule/prompt-pattern)

- [ ] I called `findSimilarCapabilities()` (or `auditDuplicateCapabilities()`) against the new capability's description before writing it, and confirmed no existing capability already covers it — OR this PR doesn't add a new capability (bug fix, docs, config, UI-only, etc.)
- [ ] If a close-but-not-exact match existed, I extended/configured it instead of duplicating it, or documented here why that wasn't possible.

## Test plan

- [ ]
