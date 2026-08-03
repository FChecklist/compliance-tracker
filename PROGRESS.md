# PROGRESS -- task-20260803-180107-analyze-current-umr-and-utm-implementati

## Completed
- [x] Read ai-os/boss/ACTIVE-CLAIMS.yaml, registered this task's claim (discovery-only, UMR/UTM naming collision)
- [x] Read /opt/veridian/scripts/resource_governor.py and /opt/veridian/scripts/superboss-register.py directly
- [x] Confirmed real live schema (Python sqlite3 introspection, not just source) of instructions/work_items/actions/system_index/umr_tasks
- [x] Confirmed the SPEC's flagged UTM naming collision (utm_source/medium/campaign/content/term already live across 8 tables, 43,673+ rows)
- [x] Found and documented a deeper collision the SPEC didn't anticipate: "UMR" is already the verbatim, CI-enforced name of the existing asset-registry-coverage.yaml system, and every "UMR-..." ID cited throughout this project's governance trail is a resource_governor.py umr_tasks queue-row ID
- [x] Checked PR #610 for the SPEC's cited "registry terminology audit" -- found it unrelated (Sales Pipeline dashboard PR; only real hit is the unrelated Terminology Guardrail Check for hardcoded ISO dates), reported honestly rather than fabricated
- [x] Dispatched Explore agent to check for an existing EUID-like (brand+org+user) composite identity or PWA/browser identity-sync mechanism -- confirmed none exists, EUID is genuinely new
- [x] Wrote real findings to ai-os/UMR_UTM_NAMING_COLLISION_DISCOVERY_2026-08-03.md
- [x] Registered the new artifact in ai-os/OS.yaml's index (reference_docs_and_catalogs)
- [x] No rename/restructure of any existing utm_* column; no new table/model/schema/architecture created

## Remaining
- [ ] Commit + push
- [ ] Next PM decision needed to resolve the UMR/UTM naming question before any implementation proceeds (out of scope for this task)
