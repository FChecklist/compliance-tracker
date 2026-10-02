-- PRE-APPROVED-LIVE-DDL: Owner (Rajat Agarwal) directive of 2026-10-02 in a live Claude Code session: "the external AI / internal AI can make the complete project, edit, delete, update, etc for that user as per role and its organization" and "the external AI / internal AI cannot code on this"; this migration finishes that work (package lf-b5-ai-crud, requirement R7).
-- PROJEXA AI CREATE / UPDATE / DELETE, PART 2: the tenth generated seed of the Universal AI Work Link's function allow-list (the eight edits and
-- deletes that had no service, and the organisation-scoped function class), plus the three schema facts they need.
--
-- WHAT
--   1. platform.ai_work_link_functions   the 140 rows of 0685 plus 19 new functions (159 rows, 141 on links), from src/lib/pipeline/function-registry.ts
--                                        and scripts/gen-ai-link-registry.data.ts:
--                                          level 0 (a read): list_organisation_records (the ids the organisation functions take)
--                                          level 1 (direct): update_activity, update_progress_category, update_boq_line, create_boq_category
--                                          level 2 (a draft the person confirms): update_attendance, delete_attendance, update_change_order,
--                                                            cancel_change_order, delete_meeting, rename_boq_category, delete_boq_category,
--                                                            create_vendor, update_vendor, create_customer, update_customer, create_company,
--                                                            create_currency, create_exchange_rate
--                                        The other 140 rows are written again exactly as 0685 wrote them. The record kinds are the 33 of 0643, unchanged.
--   2. public.ai_work_link__registry_version()  the sha256 of exactly those rows.
--   3. (GROUP 2, below the generated block)
--      compliance.pms_meetings.deleted_at timestamptz NULL     the soft delete of a project meeting (pms-meeting-service.ts deleteMeeting). Null =
--                                                              live. Every reader of that service hides a row that has it.
--      platform.projexa_track_meeting_tombstone() + trigger    when deleted_at goes from null to a time, the sync records a TOMBSTONE for the
--                                                              meeting (op 'D', record head deleted) right after 0683's projexa_track_change has
--                                                              recorded the update. Without it a soft delete is an ordinary 'U' and a laptop keeps
--                                                              the meeting. 0683's trigger and functions are NOT replaced (other packages own them).
--      enum construction_change_order_status gains 'cancelled' the state cancel_change_order leaves (construction-change-order-service.ts). Every
--                                                              reader that counts change orders filters on 'approved', so a cancelled one counts nowhere.
--      public.ai_work_link_draft_impact(draft, person, code)   THE BLAST RADIUS a person sees before confirming an organisation change: for a
--                                                              rename_boq_category or delete_boq_category draft, how many BOQ lines of the
--                                                              organisation carry the category and on how many projects. Same owner and confirm
--                                                              code checks as ai_work_link_draft_state (0629); read only. The draft preview route
--                                                              (supabase/functions/ai-work-link/drafts.ts) shows it.
--
-- WHY. Package lf-b2-ai-crud (0685) did every change the app had a SERVICE for and left two classes (ai-os/AI_CRUD_COVERAGE.md "NOT DONE"): the
-- organisation masters (a link is bound to one project, so its id rule could not hold an organisation record) and eight edits/deletes with no
-- service. The owner delegated the first decision; this package builds both. The organisation design: an organisation function rides a project-
-- bound link (the project proves the link belongs to this organisation), takes ids checked against the organisation, and is level 2 except adding
-- a category (src/lib/pipeline/executors/crud-b5-org.ts header). Nothing here lets an AI change code, a release bundle or a file.
--
-- LINKS ALREADY MINTED KEEP THEIR OLD FUNCTION CEILING (allowed_functions is fixed at mint): people re-mint to give their AI the 19 new functions.
--
-- ERRORS. None new. The impact function answers {status:'refused', reason:'not_found'|'not_owner'} like ai_work_link_draft_state.
--
-- GRANTS. The generated block grants EXECUTE on public.ai_work_link__registry_version() to service_role only, as every earlier seed did.
-- public.ai_work_link_draft_impact: service_role only. platform.projexa_track_meeting_tombstone(): owner only (a trigger function). The new
-- column inherits the table's grants and RLS.
--
-- GENERATED. The block between the BEGIN and END GENERATED markers is written by scripts/gen-ai-link-registry.ts (CURRENT_SEED_MIGRATION
-- points here). Do not edit it by hand. `bun scripts/gen-ai-link-registry.ts --check` and src/scripts/gen-ai-link-registry.test.ts fail
-- while this block, or either JSON file under supabase/functions/ai-work-link/, differs from what the registry generates.
--
-- IDEMPOTENT: rows are upserted by key; ADD COLUMN IF NOT EXISTS; ADD VALUE IF NOT EXISTS; CREATE OR REPLACE; DROP TRIGGER IF EXISTS before
-- CREATE TRIGGER. Applying this file twice leaves everything as one application does. Each GROUP 2 step is skipped when its table is absent.
--
-- DATA LOSS: none. 19 registry rows added, one nullable column, one enum value, two functions and one trigger.
--
-- HOW IT IS APPLIED: by the PM through the Supabase MCP, after the always-aborted rehearsal passed and migrations up to 0686 are applied (0685
-- first: this block includes its rows). Written by an engineer agent (cloud package lf-b5-ai-crud) and not applied by it.
--
-- ROLLBACK: drizzle/down/0687_awl_ai_crud_b5.down.sql

BEGIN;

SET LOCAL lock_timeout = '5s';

-- BEGIN GENERATED BY scripts/gen-ai-link-registry.ts (do not edit by hand; run the generator)
-- registry version d499a232b869a155ed0b38b0645903c3e02aec1094b6a2982369b964caab1d3a
DELETE FROM platform.ai_work_link_functions WHERE function_id <> ALL (ARRAY['add_boq_lines', 'add_meeting_action_item', 'add_meeting_outcome', 'add_mood_board_item', 'add_room', 'add_roster_entry', 'add_sprint_task', 'answer_rfi', 'apply_boq_import', 'approve_kpi_entry', 'approve_timesheet', 'archive_project', 'archive_task', 'cancel_change_order', 'capture_artifact', 'capture_schedule_baseline', 'close_rfi', 'close_sprint', 'compare_boq_revisions', 'compare_schedule_baseline', 'create_activity', 'create_boq', 'create_boq_category', 'create_boq_revision', 'create_change_order', 'create_company', 'create_currency', 'create_customer', 'create_document', 'create_drawing', 'create_exchange_rate', 'create_ffe_item', 'create_floor_plan', 'create_material', 'create_meeting', 'create_milestone', 'create_mom', 'create_mood_board', 'create_permit', 'create_progress_category', 'create_progress_claim', 'create_project', 'create_punch_list_item', 'create_rfi', 'create_schedule_task', 'create_site_diary', 'create_site_instruction', 'create_sprint', 'create_submittal', 'create_vendor', 'create_wiki_page', 'delete_attendance', 'delete_boq', 'delete_boq_category', 'delete_meeting', 'delete_mom', 'delete_permit', 'delete_progress_entry', 'delete_time_entry', 'detect_construction_budget_schedule_risk', 'dispose_document', 'draft_progress_claim', 'generate_construction_progress_summary', 'get_billing_due_queue', 'get_boq_line_items', 'get_change_order', 'get_compliance_stats', 'get_construction_budget_status', 'get_construction_kpi_status', 'get_construction_project_dashboard', 'get_daily_progress_report', 'get_designer_timesheet_report', 'get_ffe_margin_summary', 'get_gantt_schedule', 'get_manpower_cost_report', 'get_material_cost_report', 'get_overdue_items', 'get_project_analysis', 'get_project_budget_variance', 'get_project_exceptions', 'get_project_schedule', 'get_sales_pipeline_overview', 'link_roster_employee', 'list_billing_claims', 'list_change_orders', 'list_compliance_items', 'list_customers', 'list_delayed_activities', 'list_departments', 'list_gst_import_batches', 'list_gst_returns', 'list_leads', 'list_milestones', 'list_notices', 'list_opportunities', 'list_organisation_records', 'list_over_budget_projects', 'list_sales_orders', 'mark_punch_item_ready', 'place_furniture', 'preview_boq_import', 'publish_mom', 'record_attendance', 'record_attendance_batch', 'record_customer_approval', 'record_customer_complaint', 'record_material_issue', 'record_material_receipt', 'record_timesheet', 'record_vendor_dispute', 'record_work_progress', 'reject_progress_claim', 'reject_timesheet', 'remove_mood_board_item', 'remove_placement', 'remove_room', 'remove_sprint_task', 'rename_boq_category', 'review_budget', 'review_submittal', 'run_named_report', 'seal_boq', 'set_progress_drawing', 'submit_boq_for_approval', 'submit_change_order_for_approval', 'submit_kpi_entry', 'submit_progress_claim', 'submit_timesheet', 'update_activity', 'update_attendance', 'update_boq', 'update_boq_line', 'update_boq_line_amounts', 'update_change_order', 'update_customer', 'update_document_metadata', 'update_ffe_status', 'update_floor_plan_status', 'update_line_item_budget', 'update_material', 'update_meeting', 'update_milestone', 'update_mom_details', 'update_mom_minutes', 'update_mood_board', 'update_permit', 'update_placement', 'update_progress_category', 'update_progress_entry', 'update_project', 'update_room', 'update_roster_entry', 'update_sprint', 'update_task', 'update_time_entry', 'update_vendor', 'update_wiki_page', 'verify_punch_item_closed', 'void_material_receipt']::text[]);
INSERT INTO platform.ai_work_link_functions (function_id, product, kind, link_level, money_sensitive, min_role_rank, excluded_reason, text_params) VALUES
  ('add_boq_lines', 'projexa', 'write', 2, true, 2, NULL, '{}'::text[]),
  ('add_meeting_action_item', 'projexa', 'write', 1, false, 2, NULL, ARRAY['title']::text[]),
  ('add_meeting_outcome', 'projexa', 'write', 1, false, 2, NULL, ARRAY['notes']::text[]),
  ('add_mood_board_item', 'projexa', 'write', 1, false, 2, NULL, ARRAY['label', 'notes']::text[]),
  ('add_room', 'projexa', 'write', 1, false, 2, NULL, ARRAY['name']::text[]),
  ('add_roster_entry', 'projexa', 'write', 2, true, 2, NULL, ARRAY['name', 'trade', 'employeeCode']::text[]),
  ('add_sprint_task', 'projexa', 'write', 1, false, 2, NULL, '{}'::text[]),
  ('answer_rfi', 'projexa', 'write', 2, false, 2, NULL, ARRAY['answer']::text[]),
  ('apply_boq_import', 'projexa', 'write', 2, true, 2, NULL, ARRAY['title']::text[]),
  ('approve_kpi_entry', 'projexa', 'write', 2, true, 3, NULL, '{}'::text[]),
  ('approve_timesheet', 'projexa', 'write', 2, false, 3, NULL, '{}'::text[]),
  ('archive_project', 'projexa', 'write', 2, false, 3, NULL, '{}'::text[]),
  ('archive_task', 'projexa', 'write', 2, false, 2, NULL, '{}'::text[]),
  ('cancel_change_order', 'projexa', 'write', 2, false, 2, NULL, '{}'::text[]),
  ('capture_artifact', 'projexa', 'write', 1, false, 2, NULL, ARRAY['title', 'text']::text[]),
  ('capture_schedule_baseline', 'projexa', 'write', 2, false, 3, NULL, ARRAY['name']::text[]),
  ('close_rfi', 'projexa', 'write', 1, false, 2, NULL, '{}'::text[]),
  ('close_sprint', 'projexa', 'write', 2, false, 2, NULL, '{}'::text[]),
  ('compare_boq_revisions', 'projexa', 'read', 0, true, 3, NULL, '{}'::text[]),
  ('compare_schedule_baseline', 'projexa', 'read', 0, false, 2, NULL, '{}'::text[]),
  ('create_activity', 'projexa', 'write', 1, false, 2, NULL, ARRAY['name', 'unit']::text[]),
  ('create_boq', 'projexa', 'write', 2, true, 2, NULL, ARRAY['title']::text[]),
  ('create_boq_category', 'projexa', 'write', 1, false, 2, NULL, ARRAY['name']::text[]),
  ('create_boq_revision', 'projexa', 'write', 2, true, 2, NULL, ARRAY['title']::text[]),
  ('create_change_order', 'projexa', 'write', 2, true, 2, NULL, ARRAY['title', 'description', 'reason', 'trade']::text[]),
  ('create_company', 'projexa', 'write', 2, false, 3, NULL, ARRAY['companyName', 'abbr', 'country']::text[]),
  ('create_currency', 'projexa', 'write', 2, true, 3, NULL, ARRAY['code', 'name', 'symbol']::text[]),
  ('create_customer', 'projexa', 'write', 2, true, 2, NULL, ARRAY['customerName', 'gstin', 'pan']::text[]),
  ('create_document', 'projexa', 'write', 1, false, 2, NULL, ARRAY['name', 'category']::text[]),
  ('create_drawing', 'projexa', 'write', 2, false, 2, NULL, ARRAY['name', 'externalUrl', 'drawingNo', 'rev', 'discipline', 'kind']::text[]),
  ('create_exchange_rate', 'projexa', 'write', 2, true, 3, NULL, '{}'::text[]),
  ('create_ffe_item', 'projexa', 'write', 2, true, 2, NULL, ARRAY['itemName', 'roomOrArea', 'description', 'sku']::text[]),
  ('create_floor_plan', 'projexa', 'write', 1, false, 2, NULL, ARRAY['name', 'floorLevel']::text[]),
  ('create_material', 'projexa', 'write', 2, true, 2, NULL, ARRAY['name', 'unit', 'spec']::text[]),
  ('create_meeting', 'projexa', 'write', 1, false, 2, NULL, ARRAY['title']::text[]),
  ('create_milestone', 'projexa', 'write', 1, false, 2, NULL, ARRAY['title', 'description']::text[]),
  ('create_mom', 'projexa', 'write', 1, false, 2, NULL, ARRAY['title', 'minutes', 'meetingType', 'attendees', 'agenda']::text[]),
  ('create_mood_board', 'projexa', 'write', 1, false, 2, NULL, ARRAY['title', 'roomOrArea', 'description']::text[]),
  ('create_permit', 'projexa', 'write', 1, false, 2, NULL, ARRAY['name', 'externalUrl', 'permitNumber', 'permitAuthority']::text[]),
  ('create_progress_category', 'projexa', 'write', 1, false, 2, NULL, ARRAY['name']::text[]),
  ('create_progress_claim', 'projexa', 'write', 2, true, 3, NULL, ARRAY['milestoneDescription']::text[]),
  ('create_project', 'projexa', 'write', 2, false, 2, NULL, ARRAY['name', 'description']::text[]),
  ('create_punch_list_item', 'projexa', 'write', 1, false, 2, NULL, ARRAY['description', 'location', 'trade']::text[]),
  ('create_rfi', 'projexa', 'write', 1, false, 2, NULL, ARRAY['subject', 'question']::text[]),
  ('create_schedule_task', 'projexa', 'write', 1, false, 2, NULL, ARRAY['title', 'description']::text[]),
  ('create_site_diary', 'projexa', 'write', 1, false, 2, NULL, ARRAY['weather', 'workDone', 'visitors', 'issues', 'instructions', 'materialReceived', 'remarks']::text[]),
  ('create_site_instruction', 'projexa', 'write', 2, false, 2, NULL, ARRAY['toContractor', 'description', 'drawingRef']::text[]),
  ('create_sprint', 'projexa', 'write', 1, false, 2, NULL, ARRAY['name', 'goal']::text[]),
  ('create_submittal', 'projexa', 'write', 1, false, 2, NULL, ARRAY['title', 'specSection']::text[]),
  ('create_vendor', 'projexa', 'write', 2, true, 2, NULL, ARRAY['vendorName', 'vendorType', 'gst', 'pan', 'trade']::text[]),
  ('create_wiki_page', 'projexa', 'write', 1, false, 2, NULL, ARRAY['title', 'content']::text[]),
  ('delete_attendance', 'projexa', 'write', 2, true, 3, NULL, '{}'::text[]),
  ('delete_boq', 'projexa', 'write', 2, true, 3, NULL, '{}'::text[]),
  ('delete_boq_category', 'projexa', 'write', 2, false, 3, NULL, '{}'::text[]),
  ('delete_meeting', 'projexa', 'write', 2, false, 2, NULL, '{}'::text[]),
  ('delete_mom', 'projexa', 'write', 2, false, 2, NULL, '{}'::text[]),
  ('delete_permit', 'projexa', 'write', 2, false, 2, NULL, '{}'::text[]),
  ('delete_progress_entry', 'projexa', 'write', 2, false, 2, NULL, '{}'::text[]),
  ('delete_time_entry', 'projexa', 'write', 2, false, 2, NULL, '{}'::text[]),
  ('detect_construction_budget_schedule_risk', 'projexa', 'read', NULL, false, 0, 'Calls a server-side model (F-2): the internal AI never runs on link traffic.', '{}'::text[]),
  ('dispose_document', 'projexa', 'write', 2, false, 3, NULL, '{}'::text[]),
  ('draft_progress_claim', 'projexa', 'write', 2, true, 3, NULL, '{}'::text[]),
  ('generate_construction_progress_summary', 'projexa', 'read', NULL, false, 0, 'Calls a server-side model (F-2): the internal AI never runs on link traffic.', '{}'::text[]),
  ('get_billing_due_queue', 'projexa', 'read', 0, true, 3, NULL, '{}'::text[]),
  ('get_boq_line_items', 'projexa', 'read', 0, true, 3, NULL, '{}'::text[]),
  ('get_change_order', 'projexa', 'read', 0, true, 2, NULL, '{}'::text[]),
  ('get_compliance_stats', 'projexa', 'read', NULL, false, 0, 'Organisation-scoped read, not project data (F-3).', '{}'::text[]),
  ('get_construction_budget_status', 'projexa', 'read', 0, true, 3, NULL, '{}'::text[]),
  ('get_construction_kpi_status', 'projexa', 'read', 0, true, 3, NULL, '{}'::text[]),
  ('get_construction_project_dashboard', 'projexa', 'read', 0, true, 1, NULL, '{}'::text[]),
  ('get_daily_progress_report', 'projexa', 'read', 0, false, 2, NULL, '{}'::text[]),
  ('get_designer_timesheet_report', 'projexa', 'read', 0, true, 2, NULL, '{}'::text[]),
  ('get_ffe_margin_summary', 'projexa', 'read', 0, true, 3, NULL, '{}'::text[]),
  ('get_gantt_schedule', 'projexa', 'read', 0, false, 2, NULL, '{}'::text[]),
  ('get_manpower_cost_report', 'projexa', 'read', 0, true, 2, NULL, '{}'::text[]),
  ('get_material_cost_report', 'projexa', 'read', 0, true, 3, NULL, '{}'::text[]),
  ('get_overdue_items', 'projexa', 'read', NULL, false, 0, 'Organisation-scoped read, not project data (F-3).', '{}'::text[]),
  ('get_project_analysis', 'projexa', 'read', 0, true, 3, NULL, '{}'::text[]),
  ('get_project_budget_variance', 'projexa', 'read', 0, true, 3, NULL, '{}'::text[]),
  ('get_project_exceptions', 'projexa', 'read', 0, true, 3, NULL, '{}'::text[]),
  ('get_project_schedule', 'projexa', 'read', 0, false, 2, NULL, '{}'::text[]),
  ('get_sales_pipeline_overview', 'projexa', 'read', NULL, false, 0, 'Organisation-scoped read, not project data (F-3).', '{}'::text[]),
  ('link_roster_employee', 'projexa', 'write', NULL, false, 0, 'An employee id is an organisation-wide HR record (personal data), not project data, so it cannot be checked against the link''s project (spec 9.10, F-3). The internal pipeline runs it for a manager.', '{}'::text[]),
  ('list_billing_claims', 'projexa', 'read', 0, true, 3, NULL, '{}'::text[]),
  ('list_change_orders', 'projexa', 'read', 0, true, 2, NULL, '{}'::text[]),
  ('list_compliance_items', 'projexa', 'read', NULL, false, 0, 'Organisation-scoped read, not project data (F-3).', '{}'::text[]),
  ('list_customers', 'projexa', 'read', NULL, false, 0, 'Organisation-scoped read, not project data (F-3).', '{}'::text[]),
  ('list_delayed_activities', 'projexa', 'read', NULL, false, 0, 'Reads the whole organisation, not one project (F-3).', '{}'::text[]),
  ('list_departments', 'projexa', 'read', NULL, false, 0, 'Organisation-scoped read, not project data (F-3).', '{}'::text[]),
  ('list_gst_import_batches', 'projexa', 'read', NULL, false, 0, 'Organisation-scoped read, not project data (F-3).', '{}'::text[]),
  ('list_gst_returns', 'projexa', 'read', NULL, false, 0, 'Organisation-scoped read, not project data (F-3).', '{}'::text[]),
  ('list_leads', 'projexa', 'read', NULL, false, 0, 'Organisation-scoped read, not project data (F-3).', '{}'::text[]),
  ('list_milestones', 'projexa', 'read', 0, false, 2, NULL, '{}'::text[]),
  ('list_notices', 'projexa', 'read', NULL, false, 0, 'Organisation-scoped read, not project data (F-3).', '{}'::text[]),
  ('list_opportunities', 'projexa', 'read', NULL, false, 0, 'Organisation-scoped read, not project data (F-3).', '{}'::text[]),
  ('list_organisation_records', 'projexa', 'read', 0, true, 2, NULL, '{}'::text[]),
  ('list_over_budget_projects', 'projexa', 'read', NULL, false, 0, 'Reads the whole organisation, not one project (F-3).', '{}'::text[]),
  ('list_sales_orders', 'projexa', 'read', NULL, false, 0, 'Organisation-scoped read, not project data (F-3).', '{}'::text[]),
  ('mark_punch_item_ready', 'projexa', 'write', 1, false, 2, NULL, '{}'::text[]),
  ('place_furniture', 'projexa', 'write', 1, false, 2, NULL, '{}'::text[]),
  ('preview_boq_import', 'projexa', 'read', 0, true, 3, NULL, '{}'::text[]),
  ('publish_mom', 'projexa', 'write', 2, false, 3, NULL, '{}'::text[]),
  ('record_attendance', 'projexa', 'write', 1, false, 2, NULL, '{}'::text[]),
  ('record_attendance_batch', 'projexa', 'write', 1, true, 2, NULL, '{}'::text[]),
  ('record_customer_approval', 'projexa', 'write', 2, false, 3, NULL, '{}'::text[]),
  ('record_customer_complaint', 'projexa', 'write', 2, false, 2, NULL, ARRAY['description', 'category']::text[]),
  ('record_material_issue', 'projexa', 'write', 1, false, 2, NULL, ARRAY['issuedTo', 'note']::text[]),
  ('record_material_receipt', 'projexa', 'write', 2, true, 2, NULL, ARRAY['materialName', 'reference', 'notes', 'spec', 'unit']::text[]),
  ('record_timesheet', 'projexa', 'write', 1, false, 2, NULL, ARRAY['task', 'activityType']::text[]),
  ('record_vendor_dispute', 'projexa', 'write', 2, true, 2, NULL, ARRAY['description']::text[]),
  ('record_work_progress', 'projexa', 'write', 1, false, 2, NULL, ARRAY['remarks']::text[]),
  ('reject_progress_claim', 'projexa', 'write', 2, true, 3, NULL, ARRAY['rejectionReason']::text[]),
  ('reject_timesheet', 'projexa', 'write', 2, false, 3, NULL, ARRAY['rejectionReason']::text[]),
  ('remove_mood_board_item', 'projexa', 'write', 2, false, 2, NULL, '{}'::text[]),
  ('remove_placement', 'projexa', 'write', 2, false, 2, NULL, '{}'::text[]),
  ('remove_room', 'projexa', 'write', 2, false, 2, NULL, '{}'::text[]),
  ('remove_sprint_task', 'projexa', 'write', 1, false, 2, NULL, '{}'::text[]),
  ('rename_boq_category', 'projexa', 'write', 2, false, 3, NULL, ARRAY['name']::text[]),
  ('review_budget', 'projexa', 'read', NULL, false, 0, 'An alias that duplicates get_construction_budget_status.', '{}'::text[]),
  ('review_submittal', 'projexa', 'write', 2, false, 3, NULL, ARRAY['comments']::text[]),
  ('run_named_report', 'projexa', 'read', 0, true, 2, NULL, '{}'::text[]),
  ('seal_boq', 'projexa', 'write', 2, true, 3, NULL, '{}'::text[]),
  ('set_progress_drawing', 'projexa', 'write', 2, false, 2, NULL, '{}'::text[]),
  ('submit_boq_for_approval', 'projexa', 'write', 2, true, 3, NULL, '{}'::text[]),
  ('submit_change_order_for_approval', 'projexa', 'write', 2, true, 3, NULL, '{}'::text[]),
  ('submit_kpi_entry', 'projexa', 'write', 2, true, 2, NULL, ARRAY['period']::text[]),
  ('submit_progress_claim', 'projexa', 'write', 2, true, 3, NULL, '{}'::text[]),
  ('submit_timesheet', 'projexa', 'write', 2, false, 2, NULL, '{}'::text[]),
  ('update_activity', 'projexa', 'write', 1, false, 2, NULL, ARRAY['name', 'unit']::text[]),
  ('update_attendance', 'projexa', 'write', 2, true, 3, NULL, '{}'::text[]),
  ('update_boq', 'projexa', 'write', 1, false, 2, NULL, ARRAY['title']::text[]),
  ('update_boq_line', 'projexa', 'write', 1, false, 2, NULL, ARRAY['description', 'unit']::text[]),
  ('update_boq_line_amounts', 'projexa', 'write', 2, true, 3, NULL, '{}'::text[]),
  ('update_change_order', 'projexa', 'write', 2, true, 2, NULL, ARRAY['title', 'description', 'reason', 'trade']::text[]),
  ('update_customer', 'projexa', 'write', 2, true, 2, NULL, ARRAY['customerName', 'gstin', 'pan']::text[]),
  ('update_document_metadata', 'projexa', 'write', 1, false, 2, NULL, ARRAY['name', 'category']::text[]),
  ('update_ffe_status', 'projexa', 'write', 2, true, 3, NULL, '{}'::text[]),
  ('update_floor_plan_status', 'projexa', 'write', 2, false, 2, NULL, '{}'::text[]),
  ('update_line_item_budget', 'projexa', 'write', 2, true, 3, NULL, ARRAY['category']::text[]),
  ('update_material', 'projexa', 'write', 2, true, 2, NULL, ARRAY['name', 'unit', 'spec']::text[]),
  ('update_meeting', 'projexa', 'write', 1, false, 2, NULL, ARRAY['title']::text[]),
  ('update_milestone', 'projexa', 'write', 1, false, 2, NULL, ARRAY['title', 'description']::text[]),
  ('update_mom_details', 'projexa', 'write', 1, false, 2, NULL, ARRAY['title', 'meetingType']::text[]),
  ('update_mom_minutes', 'projexa', 'write', 1, false, 2, NULL, ARRAY['minutes']::text[]),
  ('update_mood_board', 'projexa', 'write', 1, false, 2, NULL, ARRAY['title', 'roomOrArea', 'description']::text[]),
  ('update_permit', 'projexa', 'write', 1, false, 2, NULL, ARRAY['name', 'permitNumber', 'permitAuthority', 'notes']::text[]),
  ('update_placement', 'projexa', 'write', 1, false, 2, NULL, '{}'::text[]),
  ('update_progress_category', 'projexa', 'write', 1, false, 2, NULL, ARRAY['name']::text[]),
  ('update_progress_entry', 'projexa', 'write', 1, true, 2, NULL, ARRAY['remarks']::text[]),
  ('update_project', 'projexa', 'write', 2, true, 2, NULL, ARRAY['name', 'description']::text[]),
  ('update_room', 'projexa', 'write', 1, false, 2, NULL, ARRAY['name']::text[]),
  ('update_roster_entry', 'projexa', 'write', 2, true, 2, NULL, ARRAY['name', 'trade', 'skillLevel']::text[]),
  ('update_sprint', 'projexa', 'write', 1, false, 2, NULL, ARRAY['name', 'goal']::text[]),
  ('update_task', 'projexa', 'write', 1, false, 2, NULL, ARRAY['title', 'description']::text[]),
  ('update_time_entry', 'projexa', 'write', 1, true, 2, NULL, ARRAY['activityType', 'comments']::text[]),
  ('update_vendor', 'projexa', 'write', 2, true, 2, NULL, ARRAY['vendorName', 'vendorType', 'gst', 'pan', 'trade']::text[]),
  ('update_wiki_page', 'projexa', 'write', 1, false, 2, NULL, ARRAY['title', 'content']::text[]),
  ('verify_punch_item_closed', 'projexa', 'write', 2, false, 3, NULL, '{}'::text[]),
  ('void_material_receipt', 'projexa', 'write', 2, true, 3, NULL, ARRAY['reason']::text[])
ON CONFLICT (function_id) DO UPDATE SET
  product = EXCLUDED.product, kind = EXCLUDED.kind, link_level = EXCLUDED.link_level, money_sensitive = EXCLUDED.money_sensitive,
  min_role_rank = EXCLUDED.min_role_rank, excluded_reason = EXCLUDED.excluded_reason, text_params = EXCLUDED.text_params;

DELETE FROM platform.ai_work_link_record_kinds WHERE kind <> ALL (ARRAY['project', 'boqs', 'boq_lines', 'activities', 'progress', 'tasks', 'meetings', 'documents', 'roster', 'attendance', 'timesheets', 'pipeline_tasks', 'people', 'rfis', 'submittals', 'punch_list', 'change_orders', 'site_diaries', 'site_instructions', 'milestones', 'progress_claims', 'interim_bills', 'materials', 'material_receipts', 'material_issues', 'kpi_entries', 'expenses', 'drawings', 'permits', 'meeting_minutes', 'wiki_pages', 'ffe_items', 'schedule_baselines']::text[]);
INSERT INTO platform.ai_work_link_record_kinds (kind, money_columns, filters) VALUES
  ('project', ARRAY['project_value', 'vat_rate_percent', 'retention_percent']::text[], '{"fields":{},"sort":[]}'::jsonb),
  ('boqs', ARRAY['contract_value_override']::text[], '{"fields":{"status":{"type":"text","ops":["eq","in"]},"version":{"type":"numeric","ops":["eq","gt","lt"]}},"sort":["version","created_at"]}'::jsonb),
  ('boq_lines', ARRAY['rate', 'amount', 'material_cost', 'labour_cost', 'equipment_cost', 'budget_percentage', 'vendor_amount', 'material_amount', 'manpower_amount', 'rate_project', 'rate_contract', 'vendor_id', 'overhead_percent', 'profit_percent']::text[], '{"fields":{"boq_id":{"type":"text","ops":["eq","in"]},"item_code":{"type":"text","ops":["eq","in"]},"category":{"type":"text","ops":["eq","in"]},"quantity":{"type":"numeric","ops":["eq","gt","lt"]},"rate":{"type":"numeric","ops":["eq","gt","lt"]},"amount":{"type":"numeric","ops":["eq","gt","lt"]},"budget_percentage":{"type":"numeric","ops":["eq","gt","lt"]},"breakdown_percentage":{"type":"numeric","ops":["eq","gt","lt"]}},"sort":["created_at","quantity","rate","amount","budget_percentage"]}'::jsonb),
  ('activities', '{}'::text[], '{"fields":{"category_id":{"type":"text","ops":["eq","in"]},"name":{"type":"text","ops":["eq"]}},"sort":["name","created_at"]}'::jsonb),
  ('progress', '{}'::text[], '{"fields":{"entry_date":{"type":"date","ops":["eq","gt","lt"]},"activity_id":{"type":"text","ops":["eq","in"]},"boq_line_item_id":{"type":"text","ops":["eq","in"]},"percent_complete":{"type":"numeric","ops":["eq","gt","lt"]}},"sort":["entry_date","percent_complete","created_at"]}'::jsonb),
  ('tasks', '{}'::text[], '{"fields":{"status_id":{"type":"text","ops":["eq","in"]},"priority":{"type":"text","ops":["eq","in"]},"assignee_id":{"type":"text","ops":["eq","in"]},"number":{"type":"numeric","ops":["eq","gt","lt"]},"due_date":{"type":"date","ops":["eq","gt","lt"]},"completion_percentage":{"type":"numeric","ops":["eq","gt","lt"]},"is_archived":{"type":"boolean","ops":["eq"]}},"sort":["number","priority","completion_percentage","created_at","updated_at"]}'::jsonb),
  ('meetings', '{}'::text[], '{"fields":{"scheduled_at":{"type":"timestamptz","ops":["gt","lt"]}},"sort":["scheduled_at","created_at"]}'::jsonb),
  ('documents', '{}'::text[], '{"fields":{"category":{"type":"text","ops":["eq","in"]},"name":{"type":"text","ops":["eq"]}},"sort":["name","created_at","version_number"]}'::jsonb),
  ('roster', ARRAY['daily_rate']::text[], '{"fields":{"trade":{"type":"text","ops":["eq","in"]},"is_active":{"type":"boolean","ops":["eq"]},"daily_rate":{"type":"numeric","ops":["eq","gt","lt"]}},"sort":["name","created_at","daily_rate"]}'::jsonb),
  ('attendance', ARRAY['daily_cost']::text[], '{"fields":{"attendance_date":{"type":"date","ops":["eq","gt","lt"]},"roster_id":{"type":"text","ops":["eq","in"]},"status":{"type":"text","ops":["eq","in"]},"daily_cost":{"type":"numeric","ops":["eq","gt","lt"]}},"sort":["attendance_date","created_at","daily_cost"]}'::jsonb),
  ('timesheets', ARRAY['hourly_rate_snapshot', 'invoice_item_id']::text[], '{"fields":{"spent_on":{"type":"date","ops":["eq","gt","lt"]},"issue_id":{"type":"text","ops":["eq","in"]},"user_id":{"type":"text","ops":["eq","in"]},"activity_type":{"type":"text","ops":["eq","in"]},"hours":{"type":"numeric","ops":["eq","gt","lt"]},"hourly_rate_snapshot":{"type":"numeric","ops":["eq","gt","lt"]}},"sort":["spent_on","hours","created_at"]}'::jsonb),
  ('pipeline_tasks', ARRAY['params', 'result']::text[], '{"fields":{"function_id":{"type":"text","ops":["eq","in"]},"status":{"type":"text","ops":["eq","in"]},"created_at":{"type":"timestamptz","ops":["gt","lt"]}},"sort":["created_at","sequence","status"],"omit_when_hidden":["params","result"]}'::jsonb),
  ('people', '{}'::text[], '{"fields":{"role":{"type":"text","ops":["eq","in"]}},"sort":["name"]}'::jsonb),
  ('rfis', '{}'::text[], '{"fields":{"status":{"type":"text","ops":["eq","in"]},"ball_in_court":{"type":"text","ops":["eq","in"]},"assigned_to_id":{"type":"text","ops":["eq","in"]},"due_date":{"type":"date","ops":["eq","gt","lt"]},"number":{"type":"numeric","ops":["eq","gt","lt"]}},"sort":["number","created_at"]}'::jsonb),
  ('submittals', '{}'::text[], '{"fields":{"status":{"type":"text","ops":["eq","in"]},"type":{"type":"text","ops":["eq","in"]},"due_date":{"type":"date","ops":["eq","gt","lt"]},"number":{"type":"numeric","ops":["eq","gt","lt"]}},"sort":["number","created_at"]}'::jsonb),
  ('punch_list', '{}'::text[], '{"fields":{"status":{"type":"text","ops":["eq","in"]},"priority":{"type":"text","ops":["eq","in"]},"trade":{"type":"text","ops":["eq","in"]},"assigned_to_id":{"type":"text","ops":["eq","in"]},"due_date":{"type":"date","ops":["eq","gt","lt"]},"number":{"type":"numeric","ops":["eq","gt","lt"]}},"sort":["number","created_at"]}'::jsonb),
  ('change_orders', ARRAY['cost_impact']::text[], '{"fields":{"status":{"type":"text","ops":["eq","in"]},"trade":{"type":"text","ops":["eq","in"]},"number":{"type":"numeric","ops":["eq","gt","lt"]},"cost_impact":{"type":"numeric","ops":["eq","gt","lt"]},"schedule_impact_days":{"type":"numeric","ops":["eq","gt","lt"]}},"sort":["number","created_at","cost_impact","schedule_impact_days"]}'::jsonb),
  ('site_diaries', '{}'::text[], '{"fields":{"diary_date":{"type":"date","ops":["eq","gt","lt"]}},"sort":["diary_date","created_at"]}'::jsonb),
  ('site_instructions', '{}'::text[], '{"fields":{"issue_date":{"type":"date","ops":["eq","gt","lt"]},"si_number":{"type":"numeric","ops":["eq","gt","lt"]},"cost_impact":{"type":"boolean","ops":["eq"]},"time_impact":{"type":"boolean","ops":["eq"]}},"sort":["si_number","issue_date","created_at"]}'::jsonb),
  ('milestones', '{}'::text[], '{"fields":{"status":{"type":"text","ops":["eq","in"]},"target_date":{"type":"date","ops":["eq","gt","lt"]}},"sort":["name","created_at"]}'::jsonb),
  ('progress_claims', ARRAY['retention_percent', 'customer_id', 'interim_bill_id']::text[], '{"fields":{"status":{"type":"text","ops":["eq","in"]},"boq_id":{"type":"text","ops":["eq","in"]},"scheduled_date":{"type":"date","ops":["eq","gt","lt"]},"retention_percent":{"type":"numeric","ops":["eq","gt","lt"]},"customer_id":{"type":"text","ops":["eq","in"]}},"sort":["scheduled_date","created_at","retention_percent"]}'::jsonb),
  ('interim_bills', ARRAY['retention_percent', 'gross_amount', 'retention_amount', 'net_payable', 'retention_released_amount', 'sales_invoice_id']::text[], '{"fields":{"boq_id":{"type":"text","ops":["eq","in"]},"bill_number":{"type":"numeric","ops":["eq","gt","lt"]},"bill_date":{"type":"date","ops":["eq","gt","lt"]},"gross_amount":{"type":"numeric","ops":["eq","gt","lt"]},"net_payable":{"type":"numeric","ops":["eq","gt","lt"]}},"sort":["bill_number","bill_date","created_at","gross_amount","net_payable"]}'::jsonb),
  ('materials', ARRAY['unit_cost']::text[], '{"fields":{"name":{"type":"text","ops":["eq"]},"is_active":{"type":"boolean","ops":["eq"]},"unit_cost":{"type":"numeric","ops":["eq","gt","lt"]}},"sort":["name","created_at","unit_cost"]}'::jsonb),
  ('material_receipts', ARRAY['unit_cost', 'vendor_id']::text[], '{"fields":{"material_id":{"type":"text","ops":["eq","in"]},"received_date":{"type":"date","ops":["eq","gt","lt"]},"quantity":{"type":"numeric","ops":["eq","gt","lt"]},"unit_cost":{"type":"numeric","ops":["eq","gt","lt"]},"vendor_id":{"type":"text","ops":["eq","in"]}},"sort":["received_date","created_at","quantity"]}'::jsonb),
  ('material_issues', '{}'::text[], '{"fields":{"material_id":{"type":"text","ops":["eq","in"]},"boq_line_item_id":{"type":"text","ops":["eq","in"]},"issued_date":{"type":"date","ops":["eq","gt","lt"]},"quantity":{"type":"numeric","ops":["eq","gt","lt"]}},"sort":["issued_date","created_at","quantity"]}'::jsonb),
  ('kpi_entries', ARRAY['target_value', 'actual_value']::text[], '{"fields":{"kpi_definition_id":{"type":"text","ops":["eq","in"]},"metric_name":{"type":"text","ops":["eq","in"]},"period":{"type":"text","ops":["eq","in"]},"approval_status":{"type":"text","ops":["eq","in"]},"actual_value":{"type":"numeric","ops":["eq","gt","lt"]}},"sort":["created_at","period","actual_value"]}'::jsonb),
  ('expenses', ARRAY['amount', 'description']::text[], '{"fields":{"expense_head":{"type":"text","ops":["eq","in"]},"expense_date":{"type":"date","ops":["eq","gt","lt"]},"is_rework":{"type":"boolean","ops":["eq"]},"amount":{"type":"numeric","ops":["eq","gt","lt"]}},"sort":["expense_date","created_at","amount"]}'::jsonb),
  ('drawings', '{}'::text[], '{"fields":{"drawing_no":{"type":"text","ops":["eq","in"]},"revision":{"type":"text","ops":["eq","in"]},"drawing_status":{"type":"text","ops":["eq","in"]},"discipline":{"type":"text","ops":["eq","in"]},"category":{"type":"text","ops":["eq","in"]}},"sort":["name","created_at","version_number"]}'::jsonb),
  ('permits', '{}'::text[], '{"fields":{"permit_number":{"type":"text","ops":["eq","in"]},"permit_authority":{"type":"text","ops":["eq","in"]},"expiry_date":{"type":"timestamptz","ops":["gt","lt"]}},"sort":["name","created_at"]}'::jsonb),
  ('meeting_minutes', '{}'::text[], '{"fields":{"status":{"type":"text","ops":["eq","in"]},"meeting_type":{"type":"text","ops":["eq","in"]},"scheduled_at":{"type":"timestamptz","ops":["gt","lt"]}},"sort":["scheduled_at","created_at"]}'::jsonb),
  ('wiki_pages', '{}'::text[], '{"fields":{"slug":{"type":"text","ops":["eq","in"]},"title":{"type":"text","ops":["eq"]}},"sort":["slug","title","updated_at"]}'::jsonb),
  ('ffe_items', ARRAY['unit_cost', 'unit_price', 'vendor_id']::text[], '{"fields":{"status":{"type":"text","ops":["eq","in"]},"category":{"type":"text","ops":["eq","in"]},"room_or_area":{"type":"text","ops":["eq","in"]},"unit_cost":{"type":"numeric","ops":["eq","gt","lt"]},"unit_price":{"type":"numeric","ops":["eq","gt","lt"]},"vendor_id":{"type":"text","ops":["eq","in"]}},"sort":["item_name","created_at","unit_cost","unit_price"]}'::jsonb),
  ('schedule_baselines', '{}'::text[], '{"fields":{"name":{"type":"text","ops":["eq"]}},"sort":["name","created_at"]}'::jsonb)
ON CONFLICT (kind) DO UPDATE SET money_columns = EXCLUDED.money_columns, filters = EXCLUDED.filters;

CREATE OR REPLACE FUNCTION public.ai_work_link__registry_version()
RETURNS text
LANGUAGE sql IMMUTABLE
SET search_path = pg_catalog, pg_temp
AS $fn$ SELECT 'd499a232b869a155ed0b38b0645903c3e02aec1094b6a2982369b964caab1d3a'::text $fn$;

REVOKE ALL ON FUNCTION public.ai_work_link__registry_version() FROM PUBLIC, anon, authenticated, app_runtime;
GRANT EXECUTE ON FUNCTION public.ai_work_link__registry_version() TO service_role;
-- END GENERATED

-- =============================================================================================================================================
-- GROUP 2: the schema facts the new services need, the meeting tombstone, and the blast-radius read.
-- =============================================================================================================================================

-- 2a. the soft delete of a project meeting
DO $do$
BEGIN
  IF to_regclass('compliance.pms_meetings') IS NOT NULL THEN
    ALTER TABLE compliance.pms_meetings ADD COLUMN IF NOT EXISTS deleted_at timestamptz;
  END IF;
END
$do$;

-- 2b. the cancelled change order (Postgres has no DROP VALUE: see the down file)
DO $do$
BEGIN
  IF to_regtype('compliance.construction_change_order_status') IS NOT NULL THEN
    ALTER TYPE compliance.construction_change_order_status ADD VALUE IF NOT EXISTS 'cancelled';
  END IF;
END
$do$;

-- 2c. the meeting tombstone. Runs AFTER 0683's projexa_track_change on the same UPDATE (triggers of one event fire in name order:
-- "projexa_track_change" < "projexa_track_meeting_tombstone"), so the head already holds the update's version; this bumps it once more as a
-- delete. Best effort like 0683's trigger: tracking must never be the reason a business write fails.
CREATE OR REPLACE FUNCTION platform.projexa_track_meeting_tombstone()
RETURNS trigger
LANGUAGE plpgsql SECURITY DEFINER
SET search_path = pg_catalog, pg_temp
SET timezone = 'UTC'
AS $fn$
DECLARE
  v_ver bigint;
  v_hash text;
BEGIN
  IF NEW.deleted_at IS NOT NULL AND OLD.deleted_at IS NULL THEN
    BEGIN
      UPDATE platform.projexa_record_head h
      SET version = h.version + 1, deleted = true, updated_at = clock_timestamp(), actor_id = NULL
      WHERE h.org_id = NEW.org_id AND h.kind = 'meetings' AND h.record_id = NEW.id
      RETURNING h.version, h.content_hash INTO v_ver, v_hash;
      IF FOUND THEN
        INSERT INTO platform.projexa_change_log (org_id, project_id, kind, record_id, version, op, content_hash, actor_id, db_role)
        VALUES (NEW.org_id, NEW.project_id, 'meetings', NEW.id, v_ver, 'D', v_hash, NULL, session_user::text);
      END IF;
    EXCEPTION WHEN OTHERS THEN
      RAISE WARNING 'projexa_track_meeting_tombstone: % (%)', SQLERRM, SQLSTATE;
    END;
  END IF;
  RETURN NULL;
END
$fn$;
REVOKE ALL ON FUNCTION platform.projexa_track_meeting_tombstone() FROM PUBLIC;
DO $do$
BEGIN
  IF EXISTS (SELECT 1 FROM pg_roles WHERE rolname = 'anon') THEN
    EXECUTE 'REVOKE ALL ON FUNCTION platform.projexa_track_meeting_tombstone() FROM anon, authenticated';
  END IF;
  IF EXISTS (SELECT 1 FROM pg_roles WHERE rolname = 'app_runtime') THEN
    EXECUTE 'REVOKE ALL ON FUNCTION platform.projexa_track_meeting_tombstone() FROM app_runtime';
  END IF;
  IF to_regclass('compliance.pms_meetings') IS NOT NULL THEN
    DROP TRIGGER IF EXISTS projexa_track_meeting_tombstone ON compliance.pms_meetings;
    CREATE TRIGGER projexa_track_meeting_tombstone AFTER UPDATE OF deleted_at ON compliance.pms_meetings
      FOR EACH ROW EXECUTE FUNCTION platform.projexa_track_meeting_tombstone();
  END IF;
END
$do$;

-- 2d. the blast radius of an organisation change, for the person about to confirm it
CREATE OR REPLACE FUNCTION public.ai_work_link_draft_impact(p_draft_id text, p_actor_user_id text, p_confirm_token text)
RETURNS jsonb
LANGUAGE plpgsql STABLE SECURITY DEFINER
SET search_path = pg_catalog, pg_temp
AS $fn$
DECLARE
  v_i record;
  v_name text;
  v_lines integer;
  v_projects integer;
BEGIN
  SELECT i.id, i.user_id, i.org_id, i.function_id, i.params, i.confirm_token_hash INTO v_i
  FROM platform.ai_work_link_intent i WHERE i.id = p_draft_id AND i.kind = 'draft';
  IF NOT FOUND THEN
    RETURN jsonb_build_object('status', 'refused', 'reason', 'not_found');
  END IF;
  IF v_i.user_id IS DISTINCT FROM p_actor_user_id THEN
    RETURN jsonb_build_object('status', 'refused', 'reason', 'not_owner');
  END IF;
  IF v_i.confirm_token_hash IS DISTINCT FROM encode(sha256(convert_to(coalesce(p_confirm_token, ''), 'UTF8')), 'hex') THEN
    RETURN jsonb_build_object('status', 'refused', 'reason', 'not_found');
  END IF;
  IF v_i.function_id NOT IN ('rename_boq_category', 'delete_boq_category') THEN
    RETURN jsonb_build_object('status', 'ok', 'impact', NULL);
  END IF;
  -- the category of THIS draft's organisation only: an id of another organisation has no impact to show (the change itself is refused)
  SELECT c.name INTO v_name FROM compliance.construction_boq_categories c WHERE c.id = (v_i.params ->> 'categoryId') AND c.org_id = v_i.org_id;
  IF NOT FOUND THEN
    RETURN jsonb_build_object('status', 'ok', 'impact', NULL);
  END IF;
  SELECT count(*)::int, count(DISTINCT b.project_id)::int INTO v_lines, v_projects
  FROM compliance.construction_boq_line_items l
  JOIN compliance.construction_boqs b ON b.id = l.boq_id AND b.org_id = v_i.org_id
  WHERE l.org_id = v_i.org_id AND lower(l.category) = lower(v_name);
  RETURN jsonb_build_object('status', 'ok', 'impact', jsonb_build_object(
    'kind', 'boq_category',
    'function_id', v_i.function_id,
    'category', v_name,
    'new_name', CASE WHEN v_i.function_id = 'rename_boq_category' THEN v_i.params ->> 'name' END,
    'lines', v_lines,
    'projects', v_projects));
END
$fn$;
REVOKE ALL ON FUNCTION public.ai_work_link_draft_impact(text, text, text) FROM PUBLIC;
DO $do$
BEGIN
  IF EXISTS (SELECT 1 FROM pg_roles WHERE rolname = 'anon') THEN
    EXECUTE 'REVOKE ALL ON FUNCTION public.ai_work_link_draft_impact(text, text, text) FROM anon, authenticated';
  END IF;
  IF EXISTS (SELECT 1 FROM pg_roles WHERE rolname = 'app_runtime') THEN
    EXECUTE 'REVOKE ALL ON FUNCTION public.ai_work_link_draft_impact(text, text, text) FROM app_runtime';
  END IF;
  IF EXISTS (SELECT 1 FROM pg_roles WHERE rolname = 'service_role') THEN
    EXECUTE 'GRANT EXECUTE ON FUNCTION public.ai_work_link_draft_impact(text, text, text) TO service_role';
  END IF;
END
$do$;

COMMIT;
