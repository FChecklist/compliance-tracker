# PROGRESS -- task-20260803-142324-pm-decision--add-real-yaml-safe-load-ci

## Completed
- [x] Read CLAUDE.md/AGENTS.md governance docs; confirmed task is a mechanical CI addition, not blocked by OCID-021
- [x] Surveyed existing guardrail-check script family (scripts/check-*.mjs) + ci.yml wiring pattern to reuse
- [x] Scoped target file list to the governance YAML files this session's CLAUDE.md "Read Before Starting Work" list actually depends on

## Remaining
- [ ] Register claim in ai-os/boss/ACTIVE-CLAIMS.yaml
- [ ] Write scripts/check-yaml-safe-load.mjs (safe-load each target governance YAML, fail with clear error incl. file + line/col on parse failure)
- [ ] Wire new `yaml-safe-load` job into .github/workflows/ci.yml following existing job pattern
- [ ] Commit + push
- [ ] Independently verify: intentionally break ai-os/boss/ACTIVE-CLAIMS.yaml on a real test branch, confirm the new check fails with a clear error, restore, confirm it passes
- [ ] Open PR, update ACTIVE-CLAIMS.yaml claim status, update COMPLETED.yaml per protocol
