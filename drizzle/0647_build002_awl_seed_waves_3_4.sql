-- PROJEXA-BUILD-002 WP-05c and WP-05d (register rows AW-303, AW-304): the fourth generated seed of the Universal AI Work Link's function
-- allow-list, for coverage waves 3 and 4. It follows drizzle/0644_build002_awl_seed_project_boq.sql, drizzle/0643_build002_record_kinds.sql
-- (WP-06, applied after 0644) and drizzle/0650_build002_awl_seed_coverage_waves_1_2.sql (WP-05a), which stay as they were.
--
-- WHAT
--   platform.ai_work_link_functions       eighteen rows added to the 52 of 0650, from src/lib/pipeline/function-registry.ts and
--                                         scripts/gen-ai-link-registry.data.ts (function, link level, money sensitive, minimum role rank), so
--                                         the table holds 70 rows and 52 of them are on links:
--                                           wave 3, field records
--                                             create_rfi                  write, level 1, rank 2
--                                             answer_rfi                  write, level 2 (a draft the person confirms), rank 2
--                                             close_rfi                   write, level 1, rank 2
--                                             create_submittal            write, level 1, rank 2
--                                             review_submittal            write, level 2, rank 3 (an approval decision)
--                                             create_punch_list_item      write, level 1, rank 2
--                                             mark_punch_item_ready       write, level 1, rank 2
--                                             verify_punch_item_closed    write, level 2, rank 3 (a sign-off)
--                                             create_site_diary           write, level 1, rank 2
--                                           wave 4, progress, attendance, roster, materials
--                                             create_progress_category    write, level 1, rank 2
--                                             update_progress_entry       write, level 1, money sensitive, rank 2
--                                             get_daily_progress_report   read, level 0, rank 2
--                                             record_attendance_batch     write, level 1, money sensitive, rank 2
--                                             update_roster_entry         write, level 2, money sensitive (a daily rate), rank 2
--                                             record_material_issue       write, level 1, rank 2
--                                             create_material             write, level 2, money sensitive (a unit cost), rank 2
--                                             void_material_receipt       write, level 2, money sensitive, rank 3 (reverses a ledger row)
--                                             get_material_cost_report    read, level 0, money sensitive, rank 3
--                                         The other 52 rows are written again exactly as 0650 wrote them. create_activity, the tenth function
--                                         of wave 4, is WP-07's and is already a row of 0644.
--   platform.ai_work_link_record_kinds    the same 33 record kinds as 0643, unchanged.
--   public.ai_work_link__registry_version()  the sha256 of exactly the rows above, so the running database can say it holds this seed.
--
-- WHAT IS NOT HERE. Which parameters a function declares, its id parameters and its text parameters are read by the Edge Function from
-- supabase/functions/ai-work-link/function-registry.generated.json, not from the database. Links already minted keep the function
-- ceiling they were minted with (allowed_functions): a person re-mints a link to use a new function.
--
-- ORDER, read before applying. The block below deletes every function row it does not name, exactly as 0650, 0644 and 0628 do. It names the 70
-- functions of this branch (0650 plus waves 3 and 4). Apply it after 0650 and take it as the whole truth; another wave's seed that merges later
-- is regenerated from the merged registry so that one block names every wave. Applying an older seed after this one would remove these rows.
--
-- GENERATED. The block between the BEGIN and END GENERATED markers is written by scripts/gen-ai-link-registry.ts (CURRENT_SEED_MIGRATION
-- points here). Do not edit it by hand. `bun scripts/gen-ai-link-registry.ts --check` and src/scripts/gen-ai-link-registry.test.ts fail
-- while this block, or either JSON file under supabase/functions/ai-work-link/, differs from what the registry generates.
--
-- ONE-SHOT ONCE APPLIED. After this file has been applied live it is never edited again; the next registry change adds another seed
-- migration and moves CURRENT_SEED_MIGRATION.
--
-- IDEMPOTENT: rows are upserted by key and rows of a function or kind the block no longer names are deleted, so applying this file twice, or
-- after 0628, 0644, 0643 or 0650, leaves the tables exactly as the block says. Nothing here touches platform.ai_work_link_settings.
--
-- DATA LOSS: none. Additive: eighteen rows and a function body.
--
-- HOW IT IS APPLIED: by the PM through the Supabase MCP, after the always-aborted rehearsal passed and migrations 0621 to 0628, 0644, 0643 and 0650
-- are applied. This migration is written by an engineer agent and is not applied by it.
--
-- ROLLBACK: drizzle/down/0647_build002_awl_seed_waves_3_4.down.sql

BEGIN;

SET LOCAL lock_timeout = '5s';

-- BEGIN GENERATED BY scripts/gen-ai-link-registry.ts (do not edit by hand; run the generator)
-- registry version 1b5f621a65fe1a636ae74a628ee0b55ad027f1413b21bfb61e7d27395c8711a6
DELETE FROM platform.ai_work_link_functions WHERE function_id <> ALL (ARRAY['add_boq_lines', 'add_roster_entry', 'answer_rfi', 'apply_boq_import', 'close_rfi', 'create_activity', 'create_boq', 'create_boq_revision', 'create_change_order', 'create_document', 'create_material', 'create_meeting', 'create_milestone', 'create_progress_category', 'create_project', 'create_punch_list_item', 'create_rfi', 'create_schedule_task', 'create_site_diary', 'create_site_instruction', 'create_submittal', 'detect_construction_budget_schedule_risk', 'generate_construction_progress_summary', 'get_billing_due_queue', 'get_boq_line_items', 'get_change_order', 'get_compliance_stats', 'get_construction_budget_status', 'get_construction_kpi_status', 'get_construction_project_dashboard', 'get_daily_progress_report', 'get_designer_timesheet_report', 'get_manpower_cost_report', 'get_material_cost_report', 'get_overdue_items', 'get_project_analysis', 'get_project_schedule', 'get_sales_pipeline_overview', 'list_billing_claims', 'list_change_orders', 'list_compliance_items', 'list_customers', 'list_delayed_activities', 'list_departments', 'list_gst_import_batches', 'list_gst_returns', 'list_leads', 'list_milestones', 'list_notices', 'list_opportunities', 'list_over_budget_projects', 'list_sales_orders', 'mark_punch_item_ready', 'preview_boq_import', 'record_attendance', 'record_attendance_batch', 'record_material_issue', 'record_timesheet', 'record_work_progress', 'review_budget', 'review_submittal', 'run_named_report', 'seal_boq', 'update_line_item_budget', 'update_milestone', 'update_progress_entry', 'update_project', 'update_roster_entry', 'verify_punch_item_closed', 'void_material_receipt']::text[]);
INSERT INTO platform.ai_work_link_functions (function_id, product, kind, link_level, money_sensitive, min_role_rank, excluded_reason, text_params) VALUES
  ('add_boq_lines', 'projexa', 'write', 2, true, 2, NULL, '{}'::text[]),
  ('add_roster_entry', 'projexa', 'write', 2, true, 2, NULL, ARRAY['name', 'trade', 'employeeCode']::text[]),
  ('answer_rfi', 'projexa', 'write', 2, false, 2, NULL, ARRAY['answer']::text[]),
  ('apply_boq_import', 'projexa', 'write', 2, true, 2, NULL, ARRAY['title']::text[]),
  ('close_rfi', 'projexa', 'write', 1, false, 2, NULL, '{}'::text[]),
  ('create_activity', 'projexa', 'write', 1, false, 2, NULL, ARRAY['name', 'unit']::text[]),
  ('create_boq', 'projexa', 'write', 2, true, 2, NULL, ARRAY['title']::text[]),
  ('create_boq_revision', 'projexa', 'write', 2, true, 2, NULL, ARRAY['title']::text[]),
  ('create_change_order', 'projexa', 'write', 2, true, 2, NULL, ARRAY['title', 'description', 'reason', 'trade']::text[]),
  ('create_document', 'projexa', 'write', 1, false, 2, NULL, ARRAY['name', 'category']::text[]),
  ('create_material', 'projexa', 'write', 2, true, 2, NULL, ARRAY['name', 'unit', 'spec']::text[]),
  ('create_meeting', 'projexa', 'write', 1, false, 2, NULL, ARRAY['title']::text[]),
  ('create_milestone', 'projexa', 'write', 1, false, 2, NULL, ARRAY['title', 'description']::text[]),
  ('create_progress_category', 'projexa', 'write', 1, false, 2, NULL, ARRAY['name']::text[]),
  ('create_project', 'projexa', 'write', NULL, false, 0, 'A link is bound to one project, so it cannot make another one: the New project with my AI flow and the internal pipeline do.', '{}'::text[]),
  ('create_punch_list_item', 'projexa', 'write', 1, false, 2, NULL, ARRAY['description', 'location', 'trade']::text[]),
  ('create_rfi', 'projexa', 'write', 1, false, 2, NULL, ARRAY['subject', 'question']::text[]),
  ('create_schedule_task', 'projexa', 'write', 1, false, 2, NULL, ARRAY['title', 'description']::text[]),
  ('create_site_diary', 'projexa', 'write', 1, false, 2, NULL, ARRAY['weather', 'workDone', 'visitors', 'issues', 'instructions', 'materialReceived', 'remarks']::text[]),
  ('create_site_instruction', 'projexa', 'write', 2, false, 2, NULL, ARRAY['toContractor', 'description', 'drawingRef']::text[]),
  ('create_submittal', 'projexa', 'write', 1, false, 2, NULL, ARRAY['title', 'specSection']::text[]),
  ('detect_construction_budget_schedule_risk', 'projexa', 'read', NULL, false, 0, 'Calls a server-side model (F-2): the internal AI never runs on link traffic.', '{}'::text[]),
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
  ('get_manpower_cost_report', 'projexa', 'read', 0, true, 2, NULL, '{}'::text[]),
  ('get_material_cost_report', 'projexa', 'read', 0, true, 3, NULL, '{}'::text[]),
  ('get_overdue_items', 'projexa', 'read', NULL, false, 0, 'Organisation-scoped read, not project data (F-3).', '{}'::text[]),
  ('get_project_analysis', 'projexa', 'read', 0, true, 3, NULL, '{}'::text[]),
  ('get_project_schedule', 'projexa', 'read', 0, false, 2, NULL, '{}'::text[]),
  ('get_sales_pipeline_overview', 'projexa', 'read', NULL, false, 0, 'Organisation-scoped read, not project data (F-3).', '{}'::text[]),
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
  ('list_over_budget_projects', 'projexa', 'read', NULL, false, 0, 'Reads the whole organisation, not one project (F-3).', '{}'::text[]),
  ('list_sales_orders', 'projexa', 'read', NULL, false, 0, 'Organisation-scoped read, not project data (F-3).', '{}'::text[]),
  ('mark_punch_item_ready', 'projexa', 'write', 1, false, 2, NULL, '{}'::text[]),
  ('preview_boq_import', 'projexa', 'read', 0, true, 3, NULL, '{}'::text[]),
  ('record_attendance', 'projexa', 'write', 1, false, 2, NULL, '{}'::text[]),
  ('record_attendance_batch', 'projexa', 'write', 1, true, 2, NULL, '{}'::text[]),
  ('record_material_issue', 'projexa', 'write', 1, false, 2, NULL, ARRAY['issuedTo', 'note']::text[]),
  ('record_timesheet', 'projexa', 'write', 1, false, 2, NULL, ARRAY['task', 'activityType']::text[]),
  ('record_work_progress', 'projexa', 'write', 1, false, 2, NULL, ARRAY['remarks']::text[]),
  ('review_budget', 'projexa', 'read', NULL, false, 0, 'An alias that duplicates get_construction_budget_status.', '{}'::text[]),
  ('review_submittal', 'projexa', 'write', 2, false, 3, NULL, ARRAY['comments']::text[]),
  ('run_named_report', 'projexa', 'read', 0, true, 2, NULL, '{}'::text[]),
  ('seal_boq', 'projexa', 'write', 2, true, 3, NULL, '{}'::text[]),
  ('update_line_item_budget', 'projexa', 'write', 2, true, 3, NULL, ARRAY['category']::text[]),
  ('update_milestone', 'projexa', 'write', 1, false, 2, NULL, ARRAY['title', 'description']::text[]),
  ('update_progress_entry', 'projexa', 'write', 1, true, 2, NULL, ARRAY['remarks']::text[]),
  ('update_project', 'projexa', 'write', 2, true, 2, NULL, ARRAY['name', 'description']::text[]),
  ('update_roster_entry', 'projexa', 'write', 2, true, 2, NULL, ARRAY['name', 'trade', 'skillLevel']::text[]),
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
AS $fn$ SELECT '1b5f621a65fe1a636ae74a628ee0b55ad027f1413b21bfb61e7d27395c8711a6'::text $fn$;

REVOKE ALL ON FUNCTION public.ai_work_link__registry_version() FROM PUBLIC, anon, authenticated, app_runtime;
GRANT EXECUTE ON FUNCTION public.ai_work_link__registry_version() TO service_role;
-- END GENERATED

COMMIT;
