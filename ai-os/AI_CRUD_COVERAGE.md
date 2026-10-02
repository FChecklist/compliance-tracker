# AI create / update / delete coverage (package lf-b2-ai-crud, requirements R5, R6, R7)

Owner order, 2026-10-02: "the external AI / internal AI can make the complete project, edit, delete, update, etc for that user as per
role and its organization" and "the external AI / internal AI cannot code on this".

## The decision this supersedes

BUILD-002 (WP-05, AW-311, `src/lib/pipeline/coverage-exclusions.test.ts`) kept every delete off the AI work link: "no function on a link is a
delete ... by name". The owner's order above **supersedes that decision**. The rule that replaces it:

- an AI may create, update, delete and archive what the person may, through the same service the app's own route calls;
- every delete, removal, archive and disposal is **level 2** (a draft the person confirms) by default, and so is every function that writes money
  and the two state changes that close something for good (`close_sprint`, a floor plan marked `final`);
- a person may switch on **"let my AI act without asking"** for themselves (`GET|POST /settings/act-without-asking`, their own PROJEXA session):
  then their links may run a level-2 function directly. The global kill switch (`platform.ai_work_link_settings.writes_enabled`) and each link's
  own level (a link made at level 0 stays drafts-only) stay in force; the switch is read again when the change runs; another person's switch
  does nothing for this person;
- "cannot code on this": no function changes code, a release bundle, a deployment, a migration or a file. `coverage-exclusions.test.ts` now
  fails on a function named for any of those, and on any delete/remove/archive/dispose/void that is not level 2.

Where the record is in git: migration header of `drizzle/0685_awl_ai_crud.sql`, the policy comment in `scripts/gen-ai-link-registry.data.ts`,
and the two tests named above.

## What each new function does

Minimum rank is ROLE_RANK (member 2, manager 3), at least the rank of the app route of the same action (`requireRoleOrScope`).

| Entity | Function | Level | Rank | Money | Service (no rule relaxed) |
| --- | --- | --- | --- | --- | --- |
| BOQ | `update_boq` (title) | 1 | 2 | | `updateBoq` (a superseded or revised BOQ is refused) |
| BOQ | `delete_boq` | 2 | 3 | yes | `deleteBoq` (draft only; removes its lines and their progress entries; hard delete today) |
| BOQ line | `update_boq_line_amounts` | 2 | 3 | yes | `updateLineItemMoneyFields` (contract side locked after confirmation). Rank 3 although the route says member: a line's rate is hidden below rank 3 on every read |
| Progress | `delete_progress_entry` | 2 | 2 | | `deleteProgressEntry` (rolls the linked task back) |
| Task | `archive_task` (isArchived true/false) | 2 | 2 | | `updateIssue` (`update_task` still never takes archive) |
| Sprint | `create_sprint`, `update_sprint` (planned/active), `add_sprint_task`, `remove_sprint_task` | 1 | 2 | | `pms-sprint-service.ts` |
| Sprint | `close_sprint` | 2 | 2 | | `closeSprint` (writes the close-time snapshot once) |
| Timesheet | `update_time_entry` (own, draft or returned) | 1 | 2 | answer | `updateTimeEntry` |
| Timesheet | `delete_time_entry` (own, draft or returned only: STRICTER than the service, which deletes any state) | 2 | 2 | | `deleteTimeEntry` |
| Document | `dispose_document` | 2 | 3 | | `disposeDocument` (legal hold, retention date; marked disposed, not removed) |
| MoM | `update_mom_details` (title, type, time, attendees, agenda) | 1 | 2 | | `updateVeriMeetingDetails` (a published MoM is locked) |
| MoM | `delete_mom` | 2 | 2 | | `deleteVeriMeeting` (soft delete, draft only) |
| Meeting | `update_meeting` (title, time, duration) | 1 | 2 | | `updateMeeting` |
| Material | `update_material` (incl. retire with isActive false) | 2 | 2 | yes | `updateMaterial` |
| Floor plan | `update_room`, `update_placement` | 1 | 2 | | `interior-floorplan-service.ts` (room materials are organisation records and are never taken) |
| Floor plan | `remove_room`, `remove_placement`, `update_floor_plan_status` | 2 | 2 | | same |
| Mood board | `update_mood_board` | 1 | 2 | | `updateMoodBoard` |
| Mood board | `remove_mood_board_item` | 2 | 2 | | `removeMoodBoardItem` |
| Permit | `update_permit` (name, number, authority, dates, notes) | 1 | 2 | | `permit-service.ts updatePermit`: NEW, moved out of `PATCH /api/v1/projexa/permits/{id}`, which now calls it too |
| Permit | `delete_permit` | 2 | 2 | | `permit-service.ts deletePermit` (the route's hard delete, moved out of `DELETE` of the same route) |
| Project | `archive_project` (status cancelled/completed archives, active/planning/paused reopens) | 2 | 3 | | `updateProjectStatus` (NEW in construction-dashboard-service.ts; nothing deleted). No app route changes a project's status, so rank 3 |

Every id is held to the link's project (and organisation) before the service runs: an id of another project, of another organisation or of no
record is `RECORD_NOT_FOUND` and nothing is written. Tests: `src/lib/pipeline/coverage-crud-b2.test.ts` (every function, every role, both kinds of
foreign id, a task of another organisation, the real service's write re-read from the store), `src/lib/services/ai-work-link-person-switch*.test.ts`.

## NOT DONE, and why

- **BOQ categories** (`create_boq_category`, `rename_boq_category`, `delete_boq_category`): the category list is an ORGANISATION record
  (`compliance.construction_boq_categories` has no project), and a rename rewrites the lines of every project of the organisation. A link is
  bound to one project and its id rule (spec 9.10) cannot hold an organisation record; the same reason keeps `link_roster_employee` off links.
  Needs an owner decision: an organisation-scoped AI function class, or categories per project.
- **Delete of a project meeting** (`pms_meetings`): the table has no status column and the service has no delete; inventing one is out of scope.
- **Approving one's own submission, approving a claim, invoicing**: never added (separation of duties, PMD-41).
- **GROUP 3, not done** (`update_permit`, `delete_permit` and `archive_project` landed, above). Each of these has NO service and no app route
  that changes it today, so an AI function would be a second, unreviewed write path (the rule of every executor here is "the service the app's own
  route calls"); each needs its own service with its own rules first:
  - `update_activity`, `update_progress_category`: construction-progress-service.ts creates them and never updates them;
  - `update_attendance`, `delete_attendance`: construction-labour-service.ts records attendance (single and batch) and has no edit or delete; a
    delete changes the labour cost a manager may already have reported, so it needs an owner rule (window, who, soft or hard);
  - `update_change_order`, `cancel_change_order`: construction-change-order-service.ts has create, submit-for-approval (e-signature) and the
    approve/reject marks only; a cancel must decide what happens to a pending e-signature request;
  - `update_boq_line` (description, unit): construction-boq-service.ts edits a line's money fields and budget only;
  - `delete_drawing`: the route's three rules (24 hours, legal hold, references) are inline in `DELETE /api/v1/projexa/drawings/{id}`, AND the
    delete removes the stored file from Supabase Storage with the service-role storage client. The exec function has no storage client, so an AI
    delete would leave the file behind or need storage credentials in the exec function: an owner decision. (A drawing can still be disposed of
    through `dispose_document` once its retention date has passed.)

## The three AI paths

- **Outside AI through the AI work link**: the link levels and the per-person switch above (Edge function `ai-work-link`, SQL in 0685).
- **Internal pipeline / browser AI**: run the same executors (`src/lib/pipeline/executor.ts`), so the same role, project, organisation and
  service rules hold; a write there is a proposal card the signed-in person confirms in the app, as before. The per-person switch applies to links only.

## For the integrator

- Links already minted keep their old function ceiling (`allowed_functions` is fixed at mint): people re-mint to give their AI the new functions.
- Apply `drizzle/0685_awl_ai_crud.sql` after 0668 and 0669 (its GROUP 2 re-creates four functions of 0668). Journal idx 515 is used; idx 514
  belongs to another package (0684).
