# Package lf-b2-ai-crud (backend, repo compliance-tracker)

Branch `claude/lf-b2-ai-crud` from `origin/feat/lf-sync-backend`. Migration number **0685** (journal idx 515, `when` 1790501000000).

## Goal (requirements R5, R6, R7)
The user's AI (an outside AI through the AI work link, the internal pipeline, and the browser AI) must be able to make a COMPLETE project and CREATE, EDIT, UPDATE and DELETE everything the user may, as per the user's role and organisation.
Owner order 2026-10-02: "the external AI / internal AI can make the complete project, edit, delete, update, etc for that user as per role and its organization" and "the external AI / internal AI cannot code on this" (data yes; software never: add nothing that lets an AI change the app's code, its release bundle or any file).
This SUPERSEDES the earlier BUILD-002 plan decision that excluded deletes: record that supersession in your migration header and in a short doc `ai-os/AI_CRUD_COVERAGE.md`.

## Background (verified earlier)
The registry (`platform.ai_work_link_functions`; generated from `scripts/gen-ai-link-registry.data.ts` `LINK_FUNCTIONS` by `scripts/gen-ai-link-registry.ts` into `supabase/functions/ai-work-link/function-registry.generated.json` and the seed block of the current seed migration `drizzle/0669`) has 113 functions, 72 on-link writes (34 level 1 = direct, 38 level 2 = the person confirms a draft), and NO delete function and no generic update.
A function consists of: (1) a spec in `src/lib/pipeline/function-registry.ts` (label, writes, requiredParams with error codes, card schema); (2) an executor in `src/lib/pipeline/executor.ts` or `src/lib/pipeline/executors/<area>.ts`, bound in the `EXECUTORS` map; (3) a link-policy line in `LINK_FUNCTIONS` (level, minRank, moneySensitive, textParams); (4) the generator output + a NEW seed migration (yours, 0685, with a down file and journal entry); (5) tests: `src/lib/pipeline/coverage-wave1.test.ts`, `executor-registry-u38.test.ts`, `src/scripts/gen-ai-link-registry.test.ts` (level/rank table), `src/lib/services/ai-work-link-seed-0650.pglite.test.ts`, and `EXAMPLE_PARAMS` in `supabase/functions/ai-work-link/api-definition.ts`.
Study ONE small existing function end to end first (`update_milestone`: `executeUpdateMilestone` -> `updateMilestone` in `src/lib/services/pms-taxonomy-service.ts`).
The exec bundle (`supabase/functions/ai-work-link-exec`, `scripts/build-ai-work-link-exec.ts`, `scripts/awl-exec-aliases.mjs`) stubs some dependencies: your executors must not need a stubbed one (`next/*`, email, xlsx/pdf parsing, model clients).

## Build (in this order; commit after each group; report exactly what is done)
**GROUP 1 (thin executors over services that already exist; cost S)**
- BOQ: `update_boq` (title; `updateBoq`), `delete_boq` (`deleteBoq`: manager, draft only, hard delete today), `update_boq_line_amounts` (`updateLineItemMoneyFields`).
- BOQ categories: `create_boq_category`, `rename_boq_category`, `delete_boq_category` (retire; blocked while a line uses it).
- Progress: `delete_progress_entry` (`deleteProgressEntry`).
- Schedule: `archive_task` (`updateIssue` isArchived) or an isArchived field on `update_task`; sprints: `create_sprint`, `update_sprint`, `close_sprint`, `add_sprint_task`, `remove_sprint_task`.
- Timesheets: `update_time_entry`, `delete_time_entry` (own entries).
- Documents: `dispose_document` (`disposeDocument`: manager, retention rules).
- MoM: `update_mom_details` (`updateVeriMeetingDetails`), `delete_mom` (soft delete, draft only).
- Meetings: `update_meeting` (`updateMeeting`). Materials: `update_material` (`updateMaterial`).
- Design studio: `update_room`, `remove_room`, `update_placement`, `remove_placement`, `update_floor_plan_status`, `update_mood_board`, `remove_mood_board_item`.

**GROUP 2 (the per-person switch; cost M)** "let my AI act without asking": today there is NO such setting (only a global `writes_enabled` kill switch and a per-link `authority_level` 0/1).
Add `platform.ai_work_link_person_settings` (user_id, org_id, act_without_asking boolean default false, updated_at; RLS forced, no grants) + SQL functions to read/set it for a person resolved from their PROJEXA session (same pattern as `projexa_read_resolve_user` and the confirm route in `supabase/functions/ai-work-link/confirm.ts`), and change the predicates that today allow only `link_level = 1` for direct actions (`record_intent` at `drizzle/0668:544`, `intent_claim` at `0668:696`, `drafts.ts:285`, `reads.ts:256`) to allow level 2 directly when the PERSON's switch is on. The global kill switch stays in force. Deletes and money functions stay level 2 (draft + confirm) unless the person switched it on.
Test: switch off -> a level-2 function must be a draft; switch on -> direct; kill switch off -> nothing runs; another person's switch has no effect on this person's link.

**GROUP 3 (cost M; only if groups 1 and 2 are complete and green)**: `archive_project` (projects.status 'cancelled' / isActive), `update_activity`, `update_progress_category`, `update_attendance`, `delete_attendance`, `update_change_order`, `cancel_change_order`, `update_permit`, `delete_permit`, `delete_drawing` (respect the 24 h / legal-hold / reference rules the route enforces; move that logic into a service both use if needed), `update_boq_line` (description/unit).

## Rules for EVERY new function
min_role_rank at least what the matching Vercel route requires (read the route's `requireRoleOrScope`); `money_sensitive` true where money fields are touched; level 2 (draft + confirm) for every delete and every approval-like action by default; text params declared so the 2,000-character text rules apply; the same-project id check applies (params ending in `Id`); never add a function that approves your own submission or bypasses separation of duties (claims approval stays human: PMD-41); soft delete / archival wherever the service already does it. Update `EXAMPLE_PARAMS`.
Run ALL existing ai-work-link and pipeline tests your change touches (`bun test --isolate src/lib/services/ai-work-link-*.test.ts src/lib/pipeline/*.test.ts src/scripts/gen-ai-link-registry.test.ts`) and keep them green. Generate the registry and the 0685 seed migration (idempotent `INSERT ... ON CONFLICT DO UPDATE`, a down file that deletes exactly the new function ids, a journal entry; note in the header that links already minted keep their old function ceiling so people must re-mint).

## Acceptance
For each entity above, create/update/delete exist as AI functions or are listed in NOT DONE with the reason. Each new function has a pipeline test that runs the executor against the fake tenant database (`src/lib/pipeline/fake-tenant-db.ts`, `src/lib/services/__test-helpers__/awl-exec-fixture.ts`) as each relevant role: allowed for the rank, refused below it (ROLE_TOO_LOW), refused across projects, refused across organisations; deletes are drafts until confirmed.
PLANT at least: a role check removed, the project pin removed, a delete executed without confirmation; each must be caught.
