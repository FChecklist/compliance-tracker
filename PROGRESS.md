# PROGRESS -- task-20260802-034711-amendment-to-master-directive-umr-202608

## Completed
- [x] Read ai-os/boss/ACTIVE-CLAIMS.yaml -- no existing/conflicting claim on this amendment; registered a new claim entry for this task (scope: ai-os/CONSTITUTION.yaml, AGENTS.md, ACTIVE-CLAIMS.yaml, PROGRESS.md only)
- [x] Located the actual master directive UMR-20260802-034545-3388 (superboss-register.sqlite's `umr_tasks` table, status `running`, dispatched to `veridian-worker@task-20260802-034634-master-directive--prioritized-completion.service`) and read its full 10-item priority-ordered prompt, to confirm the amendment attaches to the real directive text, not an assumed one
- [x] Added `ai-os/CONSTITUTION.yaml` rule `TASK-06` (`real_completion_verification`, under `task_lifecycle`): completion must mean real, verified, working code -- never a status label/open PR/ticked checkbox rounded up. Status `PARTIALLY_ENFORCED`, honestly cross-referencing the 3 existing partial mechanisms (`ai-reply-gate.ts`, `claim-verification.ts`, `qa-precompletion-gate.ts`) and the still-open generic gap (GP-22: no universal gate on `umr_tasks`/`taskAgentExecutions` completion status) -- not overclaiming a new runtime gate this pass built
- [x] Added the required `amendment_log` entry per CONSTITUTION.yaml's own `amendment_rule` (stable id, status, reason, dated, attributed)
- [x] Mirrored the rule as `AGENTS.md` Operating Rule 12, matching the existing Rule 6-11 pattern (Boss-directive quote, date, cross-reference to the CONSTITUTION.yaml id)
- [x] Verified `node scripts/check-guardrail-presence.mjs` still passes (88/88 markers) after the edits
- [x] Verified the 3 bare filenames referenced in the new AGENTS.md rule (`ai-reply-gate.ts`, `claim-verification.ts`, `qa-precompletion-gate.ts`) really exist in `src/lib/` (doc-cross-reference script's suffix-match requirement) -- confirmed via `find src`
- [x] Confirmed `ai-os/CONSTITUTION.yaml` still parses as valid YAML after edits (`python3 -c "import yaml..."`); confirmed the ACTIVE-CLAIMS.yaml parse error this session hit is a **pre-existing** issue (reproduces identically against HEAD before my edit, via `git stash`) and not caused by this change -- not fixed here, out of this task's scope, and CI does not machine-parse that file (no script references it)
- [x] Committed and pushed to `worker/task-20260802-034711-amendment-to-master-directive-umr-202608`

- [x] Opened PR #689: https://github.com/FChecklist/compliance-tracker/pull/689

## Remaining
- [ ] Confirm CI passes on PR #689 (Lint/Type Check/Build/Unit Tests) -- not yet confirmed as of this checkpoint; do not treat this task as complete until it does
- [ ] Out of scope for this task, explicitly NOT claimed complete here: the amendment's own retroactive-review clause (re-verifying "completed" claims under Phase 2 / Kernel investigation / UI-UX audit / PR backlog / SAP reports / CRM-PM gap-closure builds) is real, ongoing work that belongs to whichever session is actively driving each of those (UMR-20260802-032455-f94b, UMR-20260802-030121-ae66, UMR-20260802-024829-75ae) -- this task only puts the binding rule in place, it does not itself perform that re-audit
