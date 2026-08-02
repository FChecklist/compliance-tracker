# Master Go-Live Initiative — Cross-Reference Index (2026-08-02)

**Purpose:** answer "is this UMR/task/PR/CI run part of the VERIDIAN -> PROJEXA-AI.COM go-live master initiative" at a glance, for every currently-relevant real ID, by linking it back to the two master directive IDs below.

**Master directive:** `UMR-20260802-034545-3388` — "Master directive: prioritized completion plan for VERIDIAN -> PROJEXA-AI.COM go-live"
**Amendment:** `UMR-20260802-034651-6b2c` — "no false-completion reporting" (completion must mean real, verified, working code)

Produced by the parallel cross-reference task `task-20260802-035159-parallel-job--cross-reference-every-rele` (Chat ID 2082026-02), run alongside the master directive without blocking it. This is a tracking/traceability pass only — no code, logic, or task status was changed to produce this index.

## Mechanism used

1. **Checked first:** whether the entity/relation coordination graph work (`superboss-register.py` `register-entity`/`add-relationship`/`list-entities`, dispatched around `UMR-20260801-142246-8d51`, shipped as veridian-scripts PR #8 "feat: add entity/relation coordination graph") had landed and was usable for this. **It has not merged** — PR #8 is still open, and the live `superboss-register.sqlite` has no `entity_relationships` table (only the pre-existing `wiring_registry` table, which is a different, narrower system scoped to code-artifact entities — `engine|gateway|supabase_table|function|route|file|script|cron_job|ai_role|vercel_project|github_repo|browser_component|dispatch_event|governance_doc` — with no `umr_task` or `pull_request` entity type). Forcing UMR/PR links into that schema would have meant inventing entity types outside its real vocabulary, so it was not used.
2. **Mechanism actually used:** the existing, already-wired `superboss-register.py log-work` linking (confirmed real and active before this task even started — the master directive's own dispatch already created `INS-20260802-034542-3049` -> `WRK-20260802-034546-1b56` -> `ai_task_id=UMR-20260802-034545-3388`, and the amendment's equivalent). This task added 30 new `work_items` rows the same way: `--instruction-id INS-20260802-035154-0290` (this task's own instruction), `--ai-task-id <linked UMR>`, `--campaign veridian-projexa-golive-master-initiative`, `--status linked_to_master_directive`, and `--metadata` containing `master_umr_refs: [UMR-20260802-034545-3388, UMR-20260802-034651-6b2c]` plus a category tag. Query: `select * from work_items where metadata_json like '%034545-3388%'` (30 rows).
3. **For PRs:** a real PR comment on each in-scope PR, citing both master UMR IDs and this index file. This is durable and visible on the PR itself, and satisfies the "at a glance" goal directly on GitHub.
4. **This file** is the single human-readable index tying both mechanisms together.

## Linked UMRs (30)

All confirmed `running` in `resource_governor.py --query-umr --status running` (95 total running rows checked; these 30 are the ones judged genuinely in-scope — see "Excluded" section below for what was deliberately left out and why).

| UMR ID | Category | task_identity |
|---|---|---|
| UMR-20260802-032455-f94b | Phase 2 closure (Task #44) | owner-task-20260802-032453-1545012 |
| UMR-20260802-030121-ae66 | UI/UX + VERI Chat + VERI assistant audit | owner-task-20260802-030119-1476412 |
| UMR-20260802-024829-75ae | 8-clean-PR + 72-backlog remediation | owner-task-20260802-024827-1437584 |
| UMR-20260802-032127-2d8d | PR #9 concurrency-safety merge | owner-task-20260802-032126-1534803 |
| UMR-20260802-030044-ab2b | PR #9 concurrency-safety merge (earlier attempt) | owner-task-20260802-030043-1474472 |
| UMR-20260801-210313-6422 | PR #9 lineage — don't block other work on pending | owner-task-20260801-210312-438470 |
| UMR-20260801-190734-b6e5 | PR #9 lineage — revert dynamic cap to fixed + veto | owner-task-20260801-190733-94413 |
| UMR-20260801-190119-ff34 | PR #9 lineage — revert dynamic-concurrency-cap variant | owner-task-20260801-190118-70777 |
| UMR-20260801-173320-f35a | PR #9 lineage — dynamic concurrency cap implementation | owner-task-20260801-173319-3960370 |
| UMR-20260801-172407-ae58 | PR #9 lineage — urgent replace hardcoded concurrency cap | owner-task-20260801-172404-3931511 |
| UMR-20260801-172025-a4a3 | PR #9 lineage — scale up parallel worker utilization | owner-task-20260801-172024-3915562 |
| UMR-20260801-081319-3e80 | Phase 2 — merge PR #677 (crossref resume) | task-20260801-061650-merge-pr-677--phase-2-crossref-resume |
| UMR-20260731-190949-db8b | Phase 2 — re-rebase PR #630 | task-20260731-050057-re-rebase-pr-630--drifted-back-to-confli |
| UMR-20260802-004217-3a8d | Gap-closure audit batch — PR #685 | task-20260801-210625-audit-pr685-documentation-lifecycle |
| UMR-20260801-233743-17db | Gap-closure audit batch — PR #684 | task-20260801-210607-audit-pr684-ai-readable-technical-docs |
| UMR-20260801-084255-4409 | 72-backlog — independent audit PR #681 | task-20260801-083637-independently-audit-pr-681--create-simil |
| UMR-20260801-084255-d7ab | 72-backlog — independent audit PR #680 | task-20260801-083623-independently-audit-pr-680--chainrows |
| UMR-20260801-084255-6e77 | 72-backlog — independent audit PR #679 | task-20260801-083610-independently-audit-pr-679--selectedpath |
| UMR-20260731-190949-def6 | ERP — CRM gap-closure Task #46 (import/export, PR #666) | task-20260731-043820-crm--import-export |
| UMR-20260731-190949-f1ed | ERP — CRM gap-closure Task #46 (announcements) | task-20260731-043817-crm--announcements |
| UMR-20260731-190949-252a | ERP — CRM gap-closure Task #46 (project_team_members, PR #663) | task-20260731-043738-crm--project-team-junction-table |
| UMR-20260731-190949-d40b | ERP — CRM gap-closure Task #46 (campaigns entity, PR #668) | task-20260731-043735-crm--campaigns-entity |
| UMR-20260731-190949-e1b0 | ERP — CRM gap-closure Task #46 (lead/deal source attribution) | task-20260731-043731-crm--lead-deal-source-attribution---stat |
| UMR-20260731-190949-dc59 | ERP — PM gap-closure Task #47 (social/collaboration feed, PR #665) | task-20260731-044029-pm--social-collaboration-feed |
| UMR-20260731-190949-3a55 | ERP — PM gap-closure Task #47 (teams/groups/templates, PR #667) | task-20260731-044026-pm--teams---project-groups-templates |
| UMR-20260731-190949-e2e5 | ERP — PM gap-closure Task #47 (client portal user types) | task-20260731-044022-pm--client-portal-customer-user-types |
| UMR-20260731-190949-2b8e | ERP — PM gap-closure Task #47 (status/access rollup, PR #664) | task-20260731-044019-pm--project-status-access-rollup |
| UMR-20260731-190949-d5b6 | ERP — PM gap-closure Task #47 (PMS issues extension columns) | task-20260731-044012-pm--pms-issues-extension-columns |
| UMR-20260731-190949-47cb | ERP — procurement gap analysis doc commit | task-20260731-130837-commit-procurement-erp-gap-analysis-docu |
| UMR-20260731-190949-2db5 | ERP — procurement gap-closure ACTIVE-CLAIMS registration (PR #671) | task-20260731-130021-register-active-claims-entry-for-procure |

Each row above has a matching `work_items` entry (see mechanism #2) with `status=linked_to_master_directive`.

**Note on real current status vs. DB label (per the amendment's own discipline — do not trust a "running" label blindly):** veridian-scripts PR #9 actually **merged** at `2026-08-02T03:27:52Z`. The UMR rows above tagged "PR #9 concurrency-safety merge" / "PR #9 lineage" still show `status=running` in `umr_tasks` as of this check — that is very likely exactly the stale-row pattern the amendment calls out ("'running' umr_tasks rows with no real backing process"), not evidence the work is still actually in flight. Flagging this rather than either silently correcting `umr_tasks` (out of scope for a tracking-only task) or silently treating them as live.

## Excluded running UMRs (judgment calls, not linked)

Of the 95 total `running` UMRs, 65 were judged **not** genuinely part of this initiative's priority list and were left unlinked to avoid inflating coverage:
- SENTINEL ops/monitoring alerts (frozen-worker checkins, zero-workers alerts, checkin-post-recovery) — infra health noise, not a priority-list item.
- Meta/governance housekeeping (retriage-mislabeled-tasks, audit-and-clean-800-task-records, cleanup-stale-awaiting-approval, closeout/mission-report tasks) — process overhead, not go-live scope.
- AI Dev Team roster retries (retry-ai-documentation-lifecycle, retry-ai-cost-governance, retry-ai-engineering-quality) — a different, pre-existing initiative (audit198 gap-closure waves), not named in the master directive's priority list.
- Infra/tooling smoke tests and one-off fixes (wrapper relay/norelay smoke tests, hook-verification-final, remove-disabled-anthropic-api-key, batch-disposition-of-166-balance-exhaust) — not ERP/UI/Kernel/reports work.
- The large `build-extend-calculation-track-engines` / `build-extend-workflow-track-engines` / `resolve-fresh-conflict-on-pr--610` cluster (2026-07-29/30, ~35 rows, all bulk-resurrected at the identical timestamp `2026-07-31T19:09:4[89].xxx` by a `dispatch-tick:resume_interrupted_workers` sweep) — these look like stale pre-existing calc/workflow-engine backlog rows resurrected in bulk, not confirmed as this initiative's named "Kernel consolidation (TWO_ENGINE_TASK Phase 3)" item. PR #643 (the one PR from this cluster with a clear, current, named tie — "rescue 8 stranded calculation-track engines" — DIRECTIVE-001-PHASE-3-BUILD-CALC) was linked at the PR level (see below); the rest of the cluster was judged too ambiguous/possibly-stale to force a link.
- `integrate-knowledge-engine---wiring-registry`, `deterministic-per-task-type-verification` — infra/governance framework work, not a named priority-list item.
- `100pct-completion-push-directive` — an earlier, broader "complete everything" directive; effectively superseded by the master directive itself, not linked as a separate in-scope item to avoid double-counting.

This list is judgment, not certainty — if any of these turn out to genuinely be part of this initiative on closer look, they can be added the same way (this file plus a `log-work` entry).

## Linked PRs (34)

All confirmed **OPEN** as of this check (re-verified via `gh pr list --state all` immediately before writing this file, per the amendment's "don't trust an earlier snapshot blindly" discipline). Each has a PR comment citing both master UMR IDs and this file.

**compliance-tracker (33):**

| PR | Title (short) | Category |
|---|---|---|
| #630 | Stage 9 unified-search slice 1 | Phase 2 closure (Task #44) |
| #632 | Stage 11 receptionist-tier notice-status read | Phase 2 closure (Task #44) |
| #671 | Register ACTIVE-CLAIMS for procurement-ERP gap-closure | 8-clean-PR batch / procurement |
| #539, #536, #534, #532, #530, #529, #528 | audit198 gap-closure wave PRs | 8-clean-PR merge batch |
| #683, #684, #685, #686, #687, #688 | AI Engineering/Documentation/Cost-Governance gap-closure findings | 72-PR-backlog gap-closure audit batch |
| #689 | Amendment to master directive (no false-completion reporting) | Carries the amendment directive itself |
| #668, #666, #663, #661, #657 | CRM gap-closure (campaigns, import/export, project-team junction, geography, KPI widget) | ERP — CRM Task #46 |
| #667, #665, #664, #660, #659 | PM gap-closure (teams/templates, social feed, status/access, timesheet bridge, rollups) | ERP — PM Task #47 |
| #655, #653, #652, #647 | SAP-equivalent reports (Sales Rep Dashboard, Statistical Key Figures, Sales-by-Material, FI-GL Reconciliation) | Reports completion (Task #17) |
| #643 | Rescue 8 stranded calculation-track engines (DIRECTIVE-001-PHASE-3-BUILD-CALC) | Kernel consolidation prerequisite |
| #626 | sap_reports cross-reference verification | Reports completion (Task #17) |

**projexa (1):**

| PR | Title (short) | Category |
|---|---|---|
| #47 | PROJEXA E2E Phase 2 Batch C: finance+sales+HR+chat commands | Rigorous end-to-end testing gate (priority item 9) |

**veridian-scripts:** PR #9 (concurrency-safety) was found already **merged** (2026-08-02T03:27:52Z) before this task started — not commented on since it's closed; recorded here for the record instead. PR #8 (entity/relation coordination graph) and PR #7/#2 were checked as candidates but are not on the master directive's named priority list — not linked.

## What could not practically be linked

- **CI run IDs:** no existing durable place to record a PR-to-CI-run link separate from the PR itself (no CI-tracking file/table for this purpose exists, and the task spec explicitly said not to fabricate one). The PR comments above are the practical link — GitHub's own PR page already shows every CI run tied to that PR's current head SHA, so the comment on the PR is suffient for "is this CI run part of the initiative" by construction (follow the PR link). Not a separate deliverable.
- **Kernel/TWO_ENGINE_TASK Phase 3 UMR:** the master directive states this is "already queued to auto-start once #1 [Phase 2] confirms closed" — no such UMR exists yet in `running` status to link (only its prerequisite PR #643 and the ambiguous calc/workflow-track-engine cluster noted above exist today). Nothing to link until it's actually dispatched.

## Summary

- **30 real UMRs** linked (of 95 `running`, 65 judged out of scope — see above).
- **34 real PRs** linked (33 compliance-tracker + 1 projexa), all confirmed open at link time.
- **Mechanism:** `superboss-register.py log-work` (existing instruction/work-item linking, confirmed already wired for the master UMRs themselves) + durable PR comments + this index file. The entity/relation graph (PR #8) was checked and confirmed not yet landed, so not used.
- **Not practically linkable:** a separate CI-run-ID registry (none exists; PR comments serve this purpose by construction) and the not-yet-dispatched Kernel/TWO_ENGINE Phase 3 UMR (doesn't exist yet).
