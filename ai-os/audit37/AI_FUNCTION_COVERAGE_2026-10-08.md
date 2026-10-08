# Can an AI do ALL of a person's PROJEXA work through the AI work link? (task P5, 2026-10-08)

Source of the actions: projexa `docs/connectors/AI_SITEMAP_SUMEET_111.md` (the 11 areas of Sumeet's 111 requirements, group A and B) and
`AI_FLOW_AND_SITEMAP.md`. Source of the functions: `supabase/functions/ai-work-link/function-registry.generated.json` (generated from
`src/lib/pipeline/function-registry.ts`; an id is on links only when its `link_level` is not null). Group C (rules the software enforces) and group D
(not an AI job) of the sitemap have no row here, by design.

Status values (the test reads this column, keep the words exact):

- `covered`: a function on links does it (level and minimum rank as the registry says; the person's role still decides).
- `built`: was missing; built in this task (`update_drawing`).
- `record`: a read served by the link's record kinds (`/records?kind=<kind>`, `platform.ai_work_link_record_kinds`), not by a function.
- `person`: a file step the person does in PROJEXA (an AI cannot send bytes); the AI records the link afterwards. By design.
- `missing`: no function, and PROJEXA's own app has no route or service for it either, so there is nothing to copy (not built, see the end).

`src/lib/services/ai-work-link-coverage-table.pglite.test.ts` reads every `covered` and `built` row and fails if a freshly minted level-1 link
of an admin lacks any function named in the Function column (`create_project` is checked on a fresh person-wide link, the only
link that carries it by design).

| # | Area | Action | Function | Status |
|---|---|---|---|---|
| 1 | Where things stand | Project status and analysis | `get_project_analysis` | covered |
| 1 | Where things stand | Problem check (the 28 exception detectors) | `get_project_exceptions` | covered |
| 1 | Where things stand | Project dashboard | `get_construction_project_dashboard` | covered |
| 1 | Where things stand | KPI status | `get_construction_kpi_status` | covered |
| 2 | Scope and BOQ | See BOQ lines | `get_boq_line_items` | covered |
| 2 | Scope and BOQ | Compare revisions | `compare_boq_revisions` | covered |
| 2 | Scope and BOQ | Create a BOQ | `create_boq` | covered |
| 2 | Scope and BOQ | Add lines | `add_boq_lines` | covered |
| 2 | Scope and BOQ | Edit BOQ title | `update_boq` | covered |
| 2 | Scope and BOQ | Edit a line's description and unit | `update_boq_line` | covered |
| 2 | Scope and BOQ | Edit a line's money fields | `update_boq_line_amounts` | covered |
| 2 | Scope and BOQ | Make a revision | `create_boq_revision` | covered |
| 2 | Scope and BOQ | Delete a draft BOQ | `delete_boq` | covered |
| 2 | Scope and BOQ | Delete one BOQ line | (none) | missing |
| 2 | Scope and BOQ | Submit, seal, record customer approval | `submit_boq_for_approval`, `seal_boq`, `record_customer_approval` | covered |
| 2 | Scope and BOQ | Import (preview, apply) | `preview_boq_import`, `apply_boq_import` | covered |
| 2 | Scope and BOQ | Upload the import file | (person uploads in PROJEXA) | person |
| 2 | Scope and BOQ | Export lines (text or CSV the AI writes) | kind `boq_lines` | record |
| 3 | Work progress | Daily progress report | `get_daily_progress_report` | covered |
| 3 | Work progress | List progress entries | kind `progress` | record |
| 3 | Work progress | Record progress | `record_work_progress` | covered |
| 3 | Work progress | Edit a progress entry | `update_progress_entry` | covered |
| 3 | Work progress | Delete a progress entry | `delete_progress_entry` | covered |
| 3 | Work progress | Activities (add, edit) | `create_activity`, `update_activity` | covered |
| 3 | Work progress | Progress categories (add, edit) | `create_progress_category`, `update_progress_category` | covered |
| 3 | Work progress | Link a drawing to progress | `set_progress_drawing` | covered |
| 3 | Work progress | Photos | (person uploads in PROJEXA) | person |
| 4 | Budget and money | Budget status | `get_construction_budget_status` | covered |
| 4 | Budget and money | Budget variance | `get_project_budget_variance` | covered |
| 4 | Budget and money | Named reports | `run_named_report` | covered |
| 4 | Budget and money | Line budget: percentage, vendor, amounts (R-C09) | `update_line_item_budget` | covered |
| 4 | Budget and money | PDF or WhatsApp a report | (person's own tap) | person |
| 5 | Billing and milestones | Billing due, claims | `get_billing_due_queue`, `list_billing_claims` | covered |
| 5 | Billing and milestones | Milestones list | `list_milestones` | covered |
| 5 | Billing and milestones | Create a progress claim | `create_progress_claim`, `draft_progress_claim` | covered |
| 5 | Billing and milestones | Submit, reject a claim | `submit_progress_claim`, `reject_progress_claim` | covered |
| 5 | Billing and milestones | Add, edit a milestone | `create_milestone`, `update_milestone` | covered |
| 5 | Billing and milestones | Delete a milestone | (none) | missing |
| 6 | Change orders and SIs | List, view change orders | `list_change_orders`, `get_change_order` | covered |
| 6 | Change orders and SIs | Create, edit, cancel a change order | `create_change_order`, `update_change_order`, `cancel_change_order` | covered |
| 6 | Change orders and SIs | Submit a change order for approval | `submit_change_order_for_approval` | covered |
| 6 | Change orders and SIs | List site instructions | kind `site_instructions` | record |
| 6 | Change orders and SIs | Create a site instruction | `create_site_instruction` | covered |
| 6 | Change orders and SIs | Edit a site instruction | (none) | missing |
| 6 | Change orders and SIs | Delete a site instruction | (none) | missing |
| 7 | Manpower and materials | Manpower and material cost reports | `get_manpower_cost_report`, `get_material_cost_report` | covered |
| 7 | Manpower and materials | Roster: add, edit, switch a worker off | `add_roster_entry`, `update_roster_entry` | covered |
| 7 | Manpower and materials | Attendance: add (one, batch), edit, delete | `record_attendance`, `record_attendance_batch`, `update_attendance`, `delete_attendance` | covered |
| 7 | Manpower and materials | Materials: add, edit, retire | `create_material`, `update_material` | covered |
| 7 | Manpower and materials | Receipts: record, void | `record_material_receipt`, `void_material_receipt` | covered |
| 7 | Manpower and materials | Issues: record | `record_material_issue` | covered |
| 7 | Manpower and materials | Issues: delete or void | (none) | missing |
| 8 | Schedule | Schedule, Gantt, baseline compare | `get_project_schedule`, `get_gantt_schedule`, `compare_schedule_baseline` | covered |
| 8 | Schedule | Add, edit, archive a task | `create_schedule_task`, `update_task`, `archive_task` | covered |
| 8 | Schedule | Save a baseline | `capture_schedule_baseline` | covered |
| 9 | Design studio timesheets | Timesheet report | `get_designer_timesheet_report` | covered |
| 9 | Design studio timesheets | Record, edit, delete time | `record_timesheet`, `update_time_entry`, `delete_time_entry` | covered |
| 9 | Design studio timesheets | Submit, approve, reject | `submit_timesheet`, `approve_timesheet`, `reject_timesheet` | covered |
| 10 | Documents | List documents | kind `documents` | record |
| 10 | Documents | Add (link), edit details, dispose | `create_document`, `update_document_metadata`, `dispose_document` | covered |
| 10 | Permits | List permits | kind `permits` | record |
| 10 | Permits | Add, edit, delete | `create_permit`, `update_permit`, `delete_permit` | covered |
| 10 | Drawings | List drawings | kind `drawings` | record |
| 10 | Drawings | Add (link) | `create_drawing` | covered |
| 10 | Drawings | Edit name, discipline, drawing/3D category | `update_drawing` | built |
| 10 | Drawings | Delete | (none: removes the stored file, needs storage credentials; owner decision in `ai-os/AI_CRUD_COVERAGE.md`) | missing |
| 10 | Meetings | List meetings, minutes | kinds `meetings`, `meeting_minutes` | record |
| 10 | Meetings | Add, edit, delete a meeting | `create_meeting`, `update_meeting`, `delete_meeting` | covered |
| 10 | Meetings | MoM: add, edit, minutes, publish, delete | `create_mom`, `update_mom_details`, `update_mom_minutes`, `publish_mom`, `delete_mom` | covered |
| 10 | Meetings | Upload the form or file | (person uploads in PROJEXA) | person |
| 11 | Projects | Project details | kind `project` | record |
| 11 | Projects | Create a project (the person-wide link's "Start here" line; never on a project link, 0668) | `create_project` | covered |
| 11 | Projects | Edit, archive or reopen | `update_project`, `archive_project` | covered |

## Counts

| Status | Rows |
|---|---|
| covered | 54 |
| built | 1 |
| record | 8 |
| person | 4 |
| missing | 6 |
| **total** | **73** |

Distinct function ids named in `covered` and `built` rows: 93 of the 142 functions on links (141 before `update_drawing`). The other 49 are on links
too but serve screens outside the 11 areas of the sitemap (RFIs, submittals, punch list, site diary, wiki, sprints, KPIs, interior design,
disputes, organisation masters, `capture_artifact`), so they have no row here.

## The six `missing` rows, and why none was built

Each needs a NEW write path, not a copy: PROJEXA's own app has no route and no service for it (checked: `src/app/api/v1/projexa/**` and
`src/app/api/v1/construction/**`, `src/lib/services/*`). Building one would invent a rule the owner has not made (e.g. may a milestone with a
claim be deleted? may an issued site instruction be edited?), which the task forbids.

| Row | What exists today | What would be needed |
|---|---|---|
| Delete one BOQ line | `update_boq_line` (text), `delete_boq` (whole draft BOQ), a revision | an app route and service rule (line with progress is blocked, R-C rule) first |
| Delete a milestone | `PATCH /milestones/{id}` only | a DELETE route and service, and a rule for a milestone tied to a claim |
| Edit, delete a site instruction | `GET`/`POST` only | PATCH/DELETE route and service, and a rule for an issued SI |
| Delete or void a material issue | create and list only | a service that reverses stock, and its rule |
| Delete a drawing | `DELETE /drawings/{id}` (24-hour grace window) | removes the stored file with the service-role storage client, which the exec function does not hold: owner decision, unchanged |
