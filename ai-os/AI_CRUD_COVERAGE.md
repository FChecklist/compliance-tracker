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

## Package lf-b5-ai-crud: what B2 left, now done (migration `drizzle/0687_awl_ai_crud_b5.sql`)

B2's "NOT DONE" list had two classes. Both are built, with the same discipline: every AI function runs the SERVICE the app's own route runs (where
the service did not exist, it was written first, in the module's own service file, and the app can call it too). **Every rule below marked
"(chosen)" is a decision made by the engineer because the owner had not made it: the owner may veto any of them**; each is one place in code.

### Class 1: the organisation-scoped function class (the owner delegated the decision)

The design (executors/crud-b5-org.ts header):
- **The link.** An organisation function rides a project-bound link (a project link, or a user link bound to a project), exactly like a project
  function. The link's project names nothing about the record: it is the proof the link belongs to a project of THIS organisation, re-read before
  anything else. No new link kind, SQL path or Edge route. A user link outside a project still offers only `create_project` (0668 unchanged). (chosen)
- **The role.** The person's ORGANISATION role, read now (`ai_work_link__role_rank`, `ai_work_link__fns`), must reach the function's rank: the app
  route's rank, raised to the manager's where the change reaches every project (category rename/retire) or is money the organisation runs on
  (currency, exchange rate). Never lower than the route. (chosen)
- **The id rule.** Every id is looked up in the link's organisation; an id of another organisation, or of none, is `RECORD_NOT_FOUND` and nothing is written.
- **The level.** Every organisation write is level 2 (a draft the person confirms; direct only with their own switch) except adding a BOQ category
  (a new pick-list value, level 1 like the route's other creates). (chosen)
- **The blast radius.** The draft preview the person confirms on (`/drafts/{id}/preview`, the confirm page) says, for a category rename or retire,
  how many BOQ lines of the organisation carry it and on how many projects (`public.ai_work_link_draft_impact`, 0687). The change's answer says how
  many lines it rewrote. A category in use is never retired (the service refuses: "Used by N BOQ lines").

| Function | Level | Rank | Money | Service (route) |
| --- | --- | --- | --- | --- |
| `list_organisation_records` {master: boq_categories, vendors, customers, companies, currencies} | 0 | 2 | yes (credit limit null below 3) | the five list services; the only organisation-wide read on links (F-3 still keeps `list_customers` etc. off) (chosen) |
| `create_boq_category` | 1 | 2 | | `createBoqCategory` (reactivates a retired one; 409 for an active duplicate) |
| `rename_boq_category` | 2 | 3 (route: member) | | `renameBoqCategory` (rewrites every line of the organisation carrying the old name, case-insensitively, never another organisation's) |
| `delete_boq_category` | 2 | 3 (route: member) | | `deleteBoqCategory` (RETIRES; refused while used) |
| `create_vendor`, `update_vendor` | 2 | 2 | yes | `createSupplier`/`updateSupplier` (`isActive` false retires; no delete exists). The route's per-project `projectId` is not taken (chosen) |
| `create_customer`, `update_customer` | 2 | 2 | yes | `createCustomer`/`updateCustomer` (`isActive` false retires; no delete exists) |
| `create_company` | 2 | 3 | | `createCompany` (the PROJEXA route has no update). `defaultCurrencyId` not taken: the service does not check it (chosen) |
| `create_currency` | 2 | 3 (route: member) | yes | `createCurrency`, never `isBaseCurrency` (chosen) |
| `create_exchange_rate` | 2 | 3 | yes | `createExchangeRate`; both currencies checked against the organisation here (the service does not) |

### Class 2: the eight that had no service (each service is new, rules conservative)

| Function | Level | Rank | Money | New service and its rules |
| --- | --- | --- | --- | --- |
| `update_activity` (name, unit, planned quantity, category) | 1 | 2 | | `construction-progress-service.ts updateActivity`. The schema has no dates or weights on activities, so no weight sum exists to break. A category must be of the same project; the UNIT is refused (409) once any progress entry exists (the logged quantities were counted in the old unit) (chosen) |
| `update_progress_category` (name, parent) | 1 | 2 | | `updateCategory`. Parent of the same project; never itself or one of its own sub-categories (chosen) |
| `update_attendance` (status, hours) | 2 | 3 | yes | `construction-labour-service.ts updateAttendance`. Manager only; only rows dated within the last 7 days (UTC, today included; never a future day); daily cost recomputed from the roster's rate, never taken from the caller (chosen, per the brief's default) |
| `delete_attendance` | 2 | 3 | yes | `deleteAttendance`. Same window and rank; a hard delete with an `audit_logs` row (worker, day, status, cost) through the existing audit trail (`logActivity`, as `deleteVeriMeeting` does) in the same transaction. Labour cost reports aggregate rows at read time, so nothing cached goes stale (chosen) |
| `update_change_order` (title, description, reason, trade, cost impact, schedule impact) | 2 | 2 | yes | `construction-change-order-service.ts updateChangeOrder`. **DRAFT only, stricter than the brief's "draft or pending"**: a pending one is under a live e-signature over a hash of exactly these terms, so editing it would make the signature attest to terms the client never saw. Cancel and raise a new one instead (chosen) |
| `cancel_change_order` | 2 | 2 | | `cancelChangeOrder`. Draft or pending only; status `cancelled` (enum value added by 0687); every pending/partially-signed e-signature request of it is voided IN THE SAME TRANSACTION. Approved, rejected, cancelled: immutable (409). All readers count `approved` only, so a cancelled one counts nowhere |
| `update_boq_line` (description, unit) | 1 | 2 | | `construction-boq-service.ts updateLineItemDetails`. Only a DRAFT BOQ never confirmed (no baseline); quantity, rate and amount are never taken |
| `delete_meeting` (a project meeting) | 2 | 2 | | `pms-meeting-service.ts deleteMeeting`. SOFT delete on the new `pms_meetings.deleted_at` (0687); the meeting, agenda and outcomes stay; every reader of that service and the executor's id check hide it. The sync records a TOMBSTONE (0687's trigger after 0683's `projexa_track_change`, op `D`, head deleted) |

Tests: `src/lib/pipeline/coverage-crud-b5.test.ts` (every function: link policy, link check, level gate, roles, foreign ids of another project
and another organisation, the real service's write re-read, a task of another organisation, the person's switch off and on, a retry, the rules above),
`src/lib/services/ai-work-link-b5.pglite.test.ts` (0687 on PGlite: seed, switch, retry replay, tombstone, enum, impact counts and refusals, grants,
idempotent, down file), `src/lib/services/ai-work-link-draft-impact.test.ts` (the preview), `coverage-exclusions.test.ts`, `gen-ai-link-registry.test.ts`.

## NOT DONE, and why

- **Approving one's own submission, approving a claim, invoicing**: never added (separation of duties, PMD-41).
- **`delete_drawing`**: the delete removes the stored file from Supabase Storage with the service-role storage client, which the exec function does
  not have (an AI delete would leave the file behind or need storage credentials in the exec function): an owner decision. A drawing can still be
  disposed of through `dispose_document` once its retention date has passed.
- **Departments** (`create_department`): the PROJEXA route creates a department INLINE (no service), so an AI function would be a second write
  path; it needs the route's insert moved into a service first (as B2 did for permits). Not done to keep this package's blast radius small.
- **The base currency** (`set_base_currency`): the app keeps it to an ADMIN (rank 5, "it re-denominates every figure"). Not put on links; an owner
  decision whether an AI may ever do it.
- **Updating a company, deleting a vendor, customer, company or currency**: no PROJEXA route offers them (vendors/customers retire with `isActive`).
- **A soft-deleted meeting in two SQL readers owned by other packages**: the link's `meetings` record kind (0643) and the sync's full `/pull` of the
  `meetings` kind (0683) still return a soft-deleted meeting (with `deleted_at` set); the incremental `/changes` feed carries its tombstone. Those
  files are being hardened by other engineers: add `AND t.deleted_at IS NULL` there (one line each).

## The three AI paths

- **Outside AI through the AI work link**: the link levels and the per-person switch above (Edge function `ai-work-link`, SQL in 0685).
- **Internal pipeline / browser AI**: run the same executors (`src/lib/pipeline/executor.ts`), so the same role, project, organisation and
  service rules hold; a write there is a proposal card the signed-in person confirms in the app, as before. The per-person switch applies to links only.

## For the integrator

- Links already minted keep their old function ceiling (`allowed_functions` is fixed at mint): people re-mint to give their AI the new functions.
- Apply `drizzle/0685_awl_ai_crud.sql` after 0668 and 0669 (its GROUP 2 re-creates four functions of 0668). Journal idx 515 is used; idx 514
  belongs to another package (0684).
- Apply `drizzle/0687_awl_ai_crud_b5.sql` after 0685 and 0683 (journal idx 517; idx 516 is 0686, package D3). It does not replace any function of
  0678-0684. Its down file keeps `pms_meetings.deleted_at` while any meeting is soft-deleted and keeps the enum value `cancelled` (Postgres cannot
  drop one): no data is lost by a rollback.
- The paste card's function table lost its outer pipes and prints `-` for "no required parameter" (it was 8,056 bytes of its 8,000 with the new
  functions); the manual's section D names `/check` and `/actions` relative to the link (the full addresses are in section H). Same content.
- The confirm page (`projexa-link-pages/ai-confirm.html`) prints the preview's `impact.summary`; its CSP script hash is updated.
