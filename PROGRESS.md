# PROGRESS -- task-20260729-112447-build-extend-workflow-track-engines

## Completed
- [x] Read AGENTS.md/CLAUDE.md governance chain and `ai-os/boss/ACTIVE-CLAIMS.yaml` protocol before picking work
- [x] Located the real PHASE-2-CROSSREF: `sap_reports` table in `/opt/veridian/ai-os/memory/sap_mapping.sqlite`
      (`engine_track` + `veridian_mapping_status` columns), not a markdown file -- confirmed via direct sqlite
      query and cross-checked against PR #624 / task-20260729-001528's discoverability doc.
- [x] Scoped work: `engine_track='workflow' AND veridian_mapping_status IN ('BUILD_NEW', 'EXTEND_EXISTING(...)')`
      = 2 rows: **SD-002** (Billing Due List) and **SD-007** (Sales Order -- Status Overview). Both BUILD_NEW.
      0 workflow-track EXTEND_EXISTING rows exist. (Treasury-002 is workflow-track but REUSE_EXISTING -- out of
      scope by spec.)
- [x] Found the real `wiring_registry`: live sqlite table in `/opt/veridian/ai-os/memory/superboss-register.sqlite`
      (host-level, shared, NOT this repo), registered via `/opt/veridian/scripts/superboss-register.py
      register-entity` per `ai-os/WIRING_ENGINE_SCHEMA_2026-07-25.yaml` (separate claude-control repo).
- [x] Collision check: 8 sibling branches with the identical task title exist (dispatcher duplication storm,
      2026-07-29 09:29-11:19Z, affecting both workflow-track and calculation-track build tasks). Only 2 have any
      commit beyond main, both claim-registration-only, zero engine code, no open PR. Proceeding given the tiny
      real scope (2 engines) and zero competing implementation -- registered claim in ACTIVE-CLAIMS.yaml
      documenting this.
- [x] Dispatched research agent to survey existing workflow/state-machine patterns in this repo before writing
      any code, per spec's "these are state machines, do not force the wrong shape" instruction.

## Remaining
- [ ] Build SD-002 workflow engine (Billing Due List -> "Ready to Bill" claim queue: milestone achieved -> claim
      drafted -> submitted -> client approved -> invoiced, with overdue alerting)
- [ ] Build SD-007 workflow engine (Sales Order Status Overview -> "Claim Timeline" document-flow trace, stuck-step
      highlighting)
- [ ] Register both new engine files in wiring_registry (register-entity CLI) immediately on creation
- [ ] Wire API route(s) exposing each engine's worklist/timeline
- [ ] Tests
- [ ] Open PR
