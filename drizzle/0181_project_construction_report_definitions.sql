-- Reports & Analysis Engine, Priority 11 wave 2 (Owner directive 2026-07-13):
-- the Owner's own catalog -- 30 Project Reports, 30 Project Analysis
-- Dashboards, and 20 Executive Dashboard KPIs. Every row below was checked
-- against real schema/service code before being written (see report-
-- engine-service.ts's TABLE_REGISTRY/FORMULA_REGISTRY additions in this
-- same wave, and construction-reports-service.ts's 17 existing functions)
-- -- status='built' only where the underlying data genuinely exists and a
-- real execution_type/execution_config is wired; status='data_gap' with a
-- specific, real data_gap_note everywhere else. org_id is NULL (platform-
-- wide, matches 0180's convention).
--
-- 6 of the Owner's 30 Project Reports are NOT re-added here because they're
-- already covered by an existing report-catalog-service.ts entry (the
-- construction-reports-service.ts 17 + 4 ERP + 4 AI-ops + 1 custom = 26
-- pre-existing catalog entries) -- see PR description for the skip list
-- with reasoning per item. Re-adding those as new rows here would be the
-- exact "duplicacy" the Reports & Analysis Engine exists to avoid.

-- ═══════════════════════════════════════════════════════════════════════
-- SECTION 1 of 3: 30 PROJECT REPORTS (24 new rows -- 6 skipped as already
-- covered: Project Status Report/construction-project-status, Weekly
-- Progress Report/construction-weekly-project, Budget vs Actual Report/
-- construction-budget-vs-actual, Material Consumption Report/construction-
-- material-consumption, Labour Attendance Report/construction-attendance,
-- Completion & Handover Report/construction-project-completion)
-- ═══════════════════════════════════════════════════════════════════════

INSERT INTO compliance.report_definitions
  (id, org_id, name, description, category, classifications, periodicity, periodicity_config, execution_type, execution_config, status, data_gap_note, created_by)
VALUES

-- 1. Project Summary Report -- Daily -- portfolio-wide health breakdown.
('rptdef_project_summary', NULL, 'Project Summary Report',
 'Overall health of every project in the organisation, grouped by health status (on_track/at_risk/off_track).',
 'software_report', '["executive","project","construction"]', 'daily', NULL,
 'deterministic_aggregation', '{"kind":"aggregation","tableLabel":"projects","tableKey":"projects","groupByColumn":"healthStatus","aggregation":"count"}',
 'built', NULL, 'system'),

-- 2. Project Progress Report -- Daily -- physical progress vs the time-linear plan (reuses SPI's real actual-vs-planned computation).
('rptdef_project_progress', NULL, 'Project Progress Report',
 'Physical progress (actual % complete) vs a time-linear planned baseline, for one project -- the same computation the Schedule Performance Index formula already performs, surfaced under this name.',
 'software_analysis', '["project","construction"]', 'daily', NULL,
 'deterministic_formula', '{"kind":"formula","formulaKey":"schedule_performance_index"}',
 'built', NULL, 'system'),

-- 4. Milestone Completion Report -- Weekly.
('rptdef_milestone_completion', NULL, 'Milestone Completion Report',
 'Completed & pending PMS milestones, grouped by status, org-wide.',
 'software_report', '["project"]', 'weekly', '{"dayOfWeek":1}',
 'deterministic_aggregation', '{"kind":"aggregation","tableLabel":"pms_milestones","tableKey":"pms_milestones","groupByColumn":"status","aggregation":"count"}',
 'built', NULL, 'system'),

-- 5. Task Completion Report -- Daily.
('rptdef_task_completion', NULL, 'Task Completion Report',
 'PMS task (pms_issues) counts grouped by their internal status ID, org-wide -- a human-readable done/pending bucket would require joining pms_issue_statuses'' category, which the generic aggregation engine does not support (single-table group-by only); raw status counts are still real and honest.',
 'software_report', '["project","resource"]', 'daily', NULL,
 'deterministic_aggregation', '{"kind":"aggregation","tableLabel":"pms_issues","tableKey":"pms_issues","groupByColumn":"statusId","aggregation":"count"}',
 'built', NULL, 'system'),

-- 6. Delay Report -- Daily.
('rptdef_delay_report', NULL, 'Delay Report',
 'PMS tasks (pms_issues) past their due date and not yet fully complete, grouped by project.',
 'software_analysis', '["project","predictive"]', 'daily', NULL,
 'deterministic_formula', '{"kind":"formula","formulaKey":"delayed_tasks_report"}',
 'built', NULL, 'system'),

-- 7. Critical Path Report -- Daily -- data gap.
('rptdef_critical_path', NULL, 'Critical Path Report',
 'Current critical-path activities for a project.',
 'software_analysis', '["project","predictive"]', 'daily', NULL,
 'deterministic_formula', '{"kind":"formula","formulaKey":"critical_path_report"}',
 'data_gap', 'pms_issue_relations tracks blocks/blocked_by dependencies with lag_days, but no critical-path (CPM) algorithm is implemented over that graph yet -- the raw dependency data exists, the computation does not.', 'system'),

-- 8. Look Ahead Plan (7/14/30 Days) -- Weekly.
('rptdef_look_ahead_plan', NULL, 'Look Ahead Plan (7/14/30 Days)',
 'PMS tasks due in the next N days (default 7, pass params.days for 14/30), grouped by project.',
 'software_report', '["project"]', 'weekly', '{"dayOfWeek":1}',
 'deterministic_formula', '{"kind":"formula","formulaKey":"look_ahead_plan"}',
 'built', NULL, 'system'),

-- 9. Daily Site Progress Report -- Daily -- logging-volume proxy, not diary narrative content.
('rptdef_daily_site_progress', NULL, 'Daily Site Progress Report',
 'Count of site-diary entries logged per project (a real logging-cadence indicator) -- for full diary content (weather, work done, visitors, issues, instructions) use the Site Diary module directly; this report surfaces logging volume, not narrative text.',
 'software_report', '["project","construction"]', 'daily', NULL,
 'deterministic_aggregation', '{"kind":"aggregation","tableLabel":"construction_site_diaries","tableKey":"construction_site_diaries","groupByColumn":"projectId","aggregation":"count"}',
 'built', NULL, 'system'),

-- 11. Monthly Project Report -- Monthly -- data gap.
('rptdef_monthly_project_report', NULL, 'Monthly Project Report',
 'Client-facing monthly project summary (composite: progress, labour, diary, expenses over a calendar month).',
 'external_ingested', '["project","construction","executive"]', 'monthly', '{"dayOfMonth":1}',
 'deterministic_formula', '{"kind":"formula","formulaKey":"monthly_project_report"}',
 'data_gap', 'construction-reports-service.ts''s weeklyProjectReport() computes a fixed 7-day composite window; no monthly-window (weekStart -> monthStart) variant exists yet -- would need a straightforward generalization of that existing function, not new data.', 'system'),

-- 13. Cash Flow Report -- Monthly, project-scoped -- data gap (existing erp-cash-flow catalog entry is company-wide, not per-project).
('rptdef_project_cash_flow', NULL, 'Cash Flow Report (Project-Scoped)',
 'Project-level cash inflow/outflow, monthly.',
 'software_report', '["financial","project","construction"]', 'monthly', '{"dayOfMonth":1}',
 'deterministic_formula', '{"kind":"formula","formulaKey":"project_cash_flow_report"}',
 'data_gap', 'The existing erp-cash-flow catalog entry (erp-financial-report-service.ts#cashFlowStatement) is company-wide and GL-account-derived, not project-scoped -- a project-level cash-flow report would need to filter GL account movement by the project''s cost centre (erp_cost_centers.project_id), which is not implemented.', 'system'),

-- 14. Cost Overrun Report -- Weekly.
('rptdef_cost_overrun', NULL, 'Cost Overrun Report',
 'Active projects whose actual expense currently exceeds budget, ranked by overrun amount.',
 'software_analysis', '["financial","project","construction"]', 'weekly', '{"dayOfWeek":1}',
 'deterministic_formula', '{"kind":"formula","formulaKey":"cost_overrun_report"}',
 'built', NULL, 'system'),

-- 15. Purchase Order Status Report -- Daily.
('rptdef_po_status', NULL, 'Purchase Order Status Report',
 'Open/closed purchase order counts, grouped by status, org-wide.',
 'software_report', '["procurement","financial"]', 'daily', NULL,
 'deterministic_aggregation', '{"kind":"aggregation","tableLabel":"erp_purchase_orders","tableKey":"erp_purchase_orders","groupByColumn":"status","aggregation":"count"}',
 'built', NULL, 'system'),

-- 17. Inventory Stock Report -- Daily.
('rptdef_inventory_stock', NULL, 'Inventory Stock Report',
 'Net stock movement per item, org-wide (sum of quantity_change across erp_stock_ledger_entries -- a positive/negative net position, not a live warehouse-bin snapshot).',
 'software_report', '["procurement","resource"]', 'daily', NULL,
 'deterministic_aggregation', '{"kind":"aggregation","tableLabel":"erp_stock_ledger_entries","tableKey":"erp_stock_ledger_entries","groupByColumn":"itemId","aggregation":"sum","aggregationColumnKey":"quantityChange"}',
 'built', NULL, 'system'),

-- 18. Vendor Performance Report -- Monthly -- data gap.
('rptdef_vendor_performance_report', NULL, 'Vendor Performance Report',
 'Supplier evaluation (on-time delivery %, defect rate, or similar delivery-performance metrics).',
 'software_analysis', '["vendor_management","procurement"]', 'monthly', '{"dayOfMonth":1}',
 'deterministic_formula', '{"kind":"formula","formulaKey":"vendor_performance_score"}',
 'data_gap', 'erp_suppliers tracks qualification_status/sanction_screening_status only -- no on-time-delivery %, defect rate, or other delivery-performance metric is tracked anywhere in the schema. erp_purchase_orders has expected_delivery_date but no actual-delivery-date column to compare against for a real on-time metric.', 'system'),

-- 19. Contractor Performance Report -- Monthly.
('rptdef_contractor_performance_report', NULL, 'Contractor Performance Report',
 'Labour contractor cost, worker-days, and attendance, grouped by vendor, org-wide -- cost/attendance-based, not a quality score (see Contractor Performance Score for that gap).',
 'software_report', '["resource","financial","hr","construction"]', 'monthly', '{"dayOfMonth":1}',
 'deterministic_formula', '{"kind":"formula","formulaKey":"contractor_performance_report"}',
 'built', NULL, 'system'),

-- 21. Equipment Utilization Report -- Weekly -- data gap.
('rptdef_equipment_utilization', NULL, 'Equipment Utilization Report',
 'Machine/equipment utilization (hours used vs available), by project.',
 'software_report', '["resource","construction"]', 'weekly', '{"dayOfWeek":1}',
 'deterministic_formula', '{"kind":"formula","formulaKey":"equipment_utilization_report"}',
 'data_gap', 'No equipment/machinery table exists in this schema -- construction_expense_entries has an ''equipment'' expense head for cost classification only, and construction_boq_line_items has an equipment_cost rate-buildup field, but neither tracks hours-logged or utilization for a specific machine.', 'system'),

-- 22. Equipment Breakdown Report -- Weekly -- data gap.
('rptdef_equipment_breakdown', NULL, 'Equipment Breakdown Report',
 'Equipment downtime/breakdown-event analysis.',
 'software_report', '["resource","construction"]', 'weekly', '{"dayOfWeek":1}',
 'deterministic_formula', '{"kind":"formula","formulaKey":"equipment_breakdown_report"}',
 'data_gap', 'Same equipment-table gap as Equipment Utilization Report -- no equipment/machinery entity exists to log a downtime or breakdown event against.', 'system'),

-- 23. Quality Inspection Report -- Weekly -- data gap.
('rptdef_quality_inspection', NULL, 'Quality Inspection Report',
 'QA/QC inspection findings.',
 'software_report', '["quality_safety","construction"]', 'weekly', '{"dayOfWeek":1}',
 'deterministic_formula', '{"kind":"formula","formulaKey":"quality_inspection_report"}',
 'data_gap', 'No QA/QC inspection-checkpoint table exists -- construction_punch_list_items tracks defects/snags once found (see Snag List Report), but there is no scheduled/passed-or-failed formal inspection record distinct from that.', 'system'),

-- 24. Snag List Report -- Daily.
('rptdef_snag_list', NULL, 'Snag List Report',
 'Open & closed punch-list/snag items, grouped by status, org-wide.',
 'software_report', '["quality_safety","construction"]', 'daily', NULL,
 'deterministic_aggregation', '{"kind":"aggregation","tableLabel":"construction_punch_list_items","tableKey":"construction_punch_list_items","groupByColumn":"status","aggregation":"count"}',
 'built', NULL, 'system'),

-- 25. Safety Incident Report -- Immediate.
('rptdef_safety_incident', NULL, 'Safety Incident Report',
 'Safety-category incidents (near-misses & accidents), grouped by severity, org-wide.',
 'software_report', '["quality_safety","compliance"]', 'immediate', NULL,
 'deterministic_aggregation', '{"kind":"aggregation","tableLabel":"incidents","tableKey":"incidents","groupByColumn":"severity","aggregation":"count","filterEquals":{"columnKey":"category","value":"Safety"}}',
 'built', NULL, 'system'),

-- 26. RFI Report -- Weekly.
('rptdef_rfi_report', NULL, 'RFI Report',
 'Requests for Information, grouped by status, org-wide.',
 'software_report', '["project","construction"]', 'weekly', '{"dayOfWeek":1}',
 'deterministic_aggregation', '{"kind":"aggregation","tableLabel":"construction_rfis","tableKey":"construction_rfis","groupByColumn":"status","aggregation":"count"}',
 'built', NULL, 'system'),

-- 27. Change Order Report -- Weekly.
('rptdef_change_order_report', NULL, 'Change Order Report',
 'Total cost impact of approved change orders, org-wide.',
 'software_report', '["financial","project","construction"]', 'weekly', '{"dayOfWeek":1}',
 'deterministic_aggregation', '{"kind":"aggregation","tableLabel":"construction_change_orders","tableKey":"construction_change_orders","aggregation":"sum","aggregationColumnKey":"costImpact","filterEquals":{"columnKey":"status","value":"approved"}}',
 'built', NULL, 'system'),

-- 28. Client Approval Report -- Weekly -- data gap.
('rptdef_client_approval_report', NULL, 'Client Approval Report',
 'Pending client-specific approvals.',
 'software_report', '["project","construction"]', 'weekly', '{"dayOfWeek":1}',
 'deterministic_formula', '{"kind":"formula","formulaKey":"client_approval_report"}',
 'data_gap', 'construction_submittals and construction_change_orders both track pending-approval status, but neither has a field distinguishing a client-role approver from an internal architect/consultant reviewer (reviewed_by_id/approved_by_id are plain user references) -- no client-specific approval routing exists in this schema.', 'system'),

-- 29. Document Status Report -- Weekly.
('rptdef_document_status', NULL, 'Document Status Report',
 'Drawing/submittal approval status, grouped by status, org-wide.',
 'software_report', '["project","construction"]', 'weekly', '{"dayOfWeek":1}',
 'deterministic_aggregation', '{"kind":"aggregation","tableLabel":"construction_submittals","tableKey":"construction_submittals","groupByColumn":"status","aggregation":"count"}',
 'built', NULL, 'system')

ON CONFLICT (id) DO NOTHING;

-- ═══════════════════════════════════════════════════════════════════════
-- SECTION 2 of 3: 30 PROJECT ANALYSIS DASHBOARDS (all 30 as new rows --
-- none pre-existed in report_definitions since 0180 created an empty
-- table, and none of report-catalog-service.ts's 26 static entries are
-- analysis-flavored in this way)
-- ═══════════════════════════════════════════════════════════════════════

INSERT INTO compliance.report_definitions
  (id, org_id, name, description, category, classifications, periodicity, periodicity_config, execution_type, execution_config, status, data_gap_note, created_by)
VALUES

-- 1. Project Health Index -- already-built formula, catalogued here.
('rptdef_project_health_index', NULL, 'Project Health Index',
 'Overall project score (0-100), a transparent weighted average of normalized SPI and CPI.',
 'software_analysis', '["executive","project","predictive"]', 'on_demand', NULL,
 'deterministic_formula', '{"kind":"formula","formulaKey":"project_health_index"}',
 'built', NULL, 'system'),

-- 2. Schedule Variance Analysis -- reuses the earned_value_analysis formula (SV row).
('rptdef_schedule_variance_analysis', NULL, 'Schedule Variance Analysis',
 'Ahead/behind schedule, in Planned-Value terms (Schedule Variance = Earned Value - Planned Value).',
 'software_analysis', '["project","predictive"]', 'on_demand', NULL,
 'deterministic_formula', '{"kind":"formula","formulaKey":"earned_value_analysis"}',
 'built', NULL, 'system'),

-- 3. Cost Variance Analysis -- reuses the earned_value_analysis formula (CV row).
('rptdef_cost_variance_analysis', NULL, 'Cost Variance Analysis',
 'Budget deviation, in cost terms (Cost Variance = Earned Value - Actual Cost).',
 'software_analysis', '["financial","project"]', 'on_demand', NULL,
 'deterministic_formula', '{"kind":"formula","formulaKey":"earned_value_analysis"}',
 'built', NULL, 'system'),

-- 4. SPI -- already-built formula, catalogued here.
('rptdef_spi', NULL, 'Schedule Performance Index (SPI)',
 'SPI = Earned Value / Planned Value (time-linear proxy) for one project.',
 'software_analysis', '["project","predictive"]', 'on_demand', NULL,
 'deterministic_formula', '{"kind":"formula","formulaKey":"schedule_performance_index"}',
 'built', NULL, 'system'),

-- 5. CPI -- already-built formula, catalogued here.
('rptdef_cpi', NULL, 'Cost Performance Index (CPI)',
 'CPI = Earned Value / Actual Cost (Budget x %-Complete proxy) for one project.',
 'software_analysis', '["financial","project"]', 'on_demand', NULL,
 'deterministic_formula', '{"kind":"formula","formulaKey":"cost_performance_index"}',
 'built', NULL, 'system'),

-- 6. Earned Value Analysis -- the full PV/EV/AC/SV/CV composite view.
('rptdef_earned_value_analysis', NULL, 'Earned Value Analysis',
 'Full Earned Value Management quintet (PV, EV, AC, SV, CV) for one project.',
 'software_analysis', '["financial","project","executive"]', 'on_demand', NULL,
 'deterministic_formula', '{"kind":"formula","formulaKey":"earned_value_analysis"}',
 'built', NULL, 'system'),

-- 7. Resource Utilization Analysis -- present/absent/half-day breakdown as an idle-vs-productive proxy.
('rptdef_resource_utilization_analysis', NULL, 'Resource Utilization Analysis',
 'Attendance status breakdown (present/absent/half-day), org-wide -- a real idle-vs-productive-manpower proxy, not a per-worker idle-time ledger.',
 'software_analysis', '["resource","hr","construction"]', 'weekly', '{"dayOfWeek":1}',
 'deterministic_aggregation', '{"kind":"aggregation","tableLabel":"construction_attendance","tableKey":"construction_attendance","groupByColumn":"status","aggregation":"count"}',
 'built', NULL, 'system'),

-- 8. Labour Productivity Analysis -- data gap.
('rptdef_labour_productivity_analysis', NULL, 'Labour Productivity Analysis',
 'Output (quantity done) per labour worker-day.',
 'software_analysis', '["resource","construction","predictive"]', 'weekly', '{"dayOfWeek":1}',
 'deterministic_formula', '{"kind":"formula","formulaKey":"labour_productivity_analysis"}',
 'data_gap', 'No per-worker output linkage exists between construction_attendance (labour input, by roster entry) and construction_work_progress_entries (quantity output, by activity) -- activities are not assigned to specific workers, so an output-per-labour metric cannot be computed from current schema.', 'system'),

-- 9. Equipment Productivity Analysis -- data gap.
('rptdef_equipment_productivity_analysis', NULL, 'Equipment Productivity Analysis',
 'Machine efficiency (output per equipment-hour).',
 'software_analysis', '["resource","construction","predictive"]', 'weekly', '{"dayOfWeek":1}',
 'deterministic_formula', '{"kind":"formula","formulaKey":"equipment_productivity_analysis"}',
 'data_gap', 'No equipment/machinery table exists in this schema (same gap as Equipment Utilization/Breakdown Reports) -- there is no entity to compute output-per-equipment-hour against.', 'system'),

-- 10. Material Wastage Analysis -- data gap.
('rptdef_material_wastage_analysis', NULL, 'Material Wastage Analysis',
 'Material loss/wastage, distinct from normal consumption.',
 'software_analysis', '["resource","procurement","construction"]', 'weekly', '{"dayOfWeek":1}',
 'deterministic_formula', '{"kind":"formula","formulaKey":"material_wastage_analysis"}',
 'data_gap', 'erp_stock_ledger_entries has no distinct ''wastage''/''damage'' movement-reason classification separate from normal consumption -- the existing Material Consumption Report already shows net stock movement, but nothing in the schema separates wastage from planned usage.', 'system'),

-- 11. Procurement Delay Analysis.
('rptdef_procurement_delay_analysis', NULL, 'Procurement Delay Analysis',
 'Purchase order bottlenecks: POs past their expected delivery date and not yet completed/cancelled, grouped by supplier.',
 'software_analysis', '["procurement","predictive"]', 'weekly', '{"dayOfWeek":1}',
 'deterministic_formula', '{"kind":"formula","formulaKey":"vendors_delayed_purchase_orders"}',
 'built', NULL, 'system'),

-- 12. Vendor Performance Score -- data gap.
('rptdef_vendor_performance_score', NULL, 'Vendor Performance Score',
 'Supplier ranking by delivery/quality performance.',
 'software_analysis', '["vendor_management","procurement"]', 'monthly', '{"dayOfMonth":1}',
 'deterministic_formula', '{"kind":"formula","formulaKey":"vendor_performance_score"}',
 'data_gap', 'Same gap as Vendor Performance Report -- no delivery-performance or quality metric is tracked for suppliers anywhere in the schema, so no real ranking/score can be computed.', 'system'),

-- 13. Contractor Performance Score -- data gap (distinct from the real cost/worker-day Contractor Performance Report).
('rptdef_contractor_performance_score', NULL, 'Contractor Performance Score',
 'Execution-quality score/ranking for labour contractors.',
 'software_analysis', '["resource","hr","construction"]', 'monthly', '{"dayOfMonth":1}',
 'deterministic_formula', '{"kind":"formula","formulaKey":"contractor_performance_score"}',
 'data_gap', 'No quality/execution scoring exists for labour contractors -- see ''Contractor Performance Report'' for real cost/worker-day data by vendor, which is volume/cost-based, not a quality score.', 'system'),

-- 14. Quality Trend Analysis -- data gap.
('rptdef_quality_trend_analysis', NULL, 'Quality Trend Analysis',
 'Recurring quality-issue trends over time.',
 'software_analysis', '["quality_safety","construction","predictive"]', 'weekly', '{"dayOfWeek":1}',
 'deterministic_formula', '{"kind":"formula","formulaKey":"quality_trend_analysis"}',
 'data_gap', 'Same gap as Quality Inspection Report -- no QA/QC inspection-finding table exists to trend over time (Snag Trend Analysis below covers the closest real substitute, punch-list/snag items, not formal inspection findings).', 'system'),

-- 15. Snag Trend Analysis.
('rptdef_snag_trend_analysis', NULL, 'Snag Trend Analysis',
 'Monthly trend of punch-list/snag items raised, org-wide.',
 'software_analysis', '["quality_safety","construction","predictive"]', 'weekly', '{"dayOfWeek":1}',
 'deterministic_formula', '{"kind":"formula","formulaKey":"snag_trend_analysis"}',
 'built', NULL, 'system'),

-- 16. Risk Heat Map.
('rptdef_risk_heat_map', NULL, 'Risk Heat Map',
 'Open organisational risks grouped by (likelihood, impact) cell -- a real 2-axis heat map. compliance.risks has no project_id column, so this is organisation-wide, not filterable to a single project.',
 'software_analysis', '["predictive","executive"]', 'weekly', '{"dayOfWeek":1}',
 'deterministic_formula', '{"kind":"formula","formulaKey":"risk_heat_map"}',
 'built', NULL, 'system'),

-- 17. Issue Resolution Analysis.
('rptdef_issue_resolution_analysis', NULL, 'Issue Resolution Analysis',
 'Average closure time for punch-list/snag items and RFI response time -- the 2 real closure-timestamp pairs in this schema.',
 'software_analysis', '["project","quality_safety"]', 'weekly', '{"dayOfWeek":1}',
 'deterministic_formula', '{"kind":"formula","formulaKey":"issue_resolution_analysis"}',
 'built', NULL, 'system'),

-- 18. Approval Bottleneck Analysis.
('rptdef_approval_bottleneck_analysis', NULL, 'Approval Bottleneck Analysis',
 'Average decision time for submittals and change orders -- only covers decisions actually made, not still-pending items.',
 'software_analysis', '["project","operations"]', 'weekly', '{"dayOfWeek":1}',
 'deterministic_formula', '{"kind":"formula","formulaKey":"approval_bottleneck_analysis"}',
 'built', NULL, 'system'),

-- 19. Cash Flow Forecast Analysis -- ai_recipe, grounded on real recent expense data.
('rptdef_cash_flow_forecast_analysis', NULL, 'Cash Flow Forecast Analysis',
 'AI-grounded projection of near-term cash needs, based on real recent construction_expense_entries totals by head (the model reasons over real queried totals, it does not invent figures).',
 'ai_analysis', '["financial","predictive"]', 'monthly', '{"dayOfMonth":1}',
 'ai_recipe', '{"kind":"ai_recipe","promptKey":"cash_flow_forecast_analysis","groundingNote":"Grounded on real construction_expense_entries totals summed by expense_head, org-wide -- not a full cash-flow model (no AR/AP aging or bank-balance input), a directional read of recent spend patterns only.","groundingQuery":{"tableKey":"construction_expense_entries","groupByColumn":"expenseHead","aggregation":"sum","aggregationColumnKey":"amount"}}',
 'built', NULL, 'system'),

-- 20. Forecast Completion Date -- ai_recipe, grounded on real progress data.
('rptdef_forecast_completion_date', NULL, 'Forecast Completion Date',
 'AI-predicted completion date, grounded on real average percent-complete by project (the model reasons over real queried progress data, it does not invent a date without basis).',
 'ai_analysis', '["predictive","project"]', 'weekly', '{"dayOfWeek":1}',
 'ai_recipe', '{"kind":"ai_recipe","promptKey":"forecast_completion_date","groundingNote":"Grounded on average construction_work_progress_entries.percent_complete by project -- a coarse trajectory signal, not a schedule-network-based forecast (no baseline S-curve or CPM data exists to ground a precise date on).","groundingQuery":{"tableKey":"construction_work_progress_entries","groupByColumn":"projectId","aggregation":"avg","aggregationColumnKey":"percentComplete"}}',
 'built', NULL, 'system'),

-- 21. Forecast Final Cost -- ai_recipe, grounded on real expense data.
('rptdef_forecast_final_cost', NULL, 'Forecast Final Cost',
 'AI-predicted final project cost, grounded on real construction_expense_entries totals by head.',
 'ai_analysis', '["financial","predictive"]', 'monthly', '{"dayOfMonth":1}',
 'ai_recipe', '{"kind":"ai_recipe","promptKey":"forecast_final_cost","groundingNote":"Grounded on construction_expense_entries totals by expense_head, org-wide -- a directional read of spend-to-date, not a bottom-up estimate-to-complete model.","groundingQuery":{"tableKey":"construction_expense_entries","groupByColumn":"expenseHead","aggregation":"sum","aggregationColumnKey":"amount"}}',
 'built', NULL, 'system'),

-- 22. Profitability Analysis.
('rptdef_profitability_analysis', NULL, 'Profitability Analysis',
 'Revenue minus expense (margin) for one project -- not a full accrual-basis GL profit/loss.',
 'software_analysis', '["financial","project","revenue"]', 'monthly', '{"dayOfMonth":1}',
 'deterministic_formula', '{"kind":"formula","formulaKey":"profitability_analysis"}',
 'built', NULL, 'system'),

-- 23. Customer Satisfaction Analysis -- data gap.
('rptdef_customer_satisfaction_analysis', NULL, 'Customer Satisfaction Analysis',
 'Client feedback/satisfaction trends for construction projects.',
 'software_analysis', '["customer","construction"]', 'monthly', '{"dayOfMonth":1}',
 'deterministic_formula', '{"kind":"formula","formulaKey":"customer_satisfaction_analysis"}',
 'data_gap', 'No client-feedback/rating table exists for construction projects -- ticket_satisfaction_surveys is scoped to support tickets, not construction project delivery, and cannot be repurposed without conflating the two.', 'system'),

-- 24. Delay Root Cause Analysis -- data gap (genuinely no causally-structured data to ground an AI recipe on).
('rptdef_delay_root_cause_analysis', NULL, 'Delay Root Cause Analysis',
 'AI-identified reasons for project delays.',
 'ai_analysis', '["project","predictive"]', 'weekly', '{"dayOfWeek":1}',
 'ai_recipe', '{"kind":"ai_recipe","promptKey":"delay_root_cause_analysis","groundingNote":"No structured delay-reason field exists on any activity/task/RFI table -- construction_site_diaries.issues is free text and is not linked causally to a specific delayed activity. Without a real causally-structured data source, an AI root-cause analysis would have nothing genuine to ground on beyond generic aggregates, which risks fabricating causes the data does not actually support -- left as a data gap rather than force a fragile implementation."}',
 'data_gap', 'No structured delay-reason field exists anywhere in the schema (site-diary ''issues'' is unlinked free text) -- there is no real data to ground an AI root-cause analysis on without risking fabricated causes.', 'system'),

-- 25. Weather Impact Analysis.
('rptdef_weather_impact_analysis', NULL, 'Weather Impact Analysis',
 'Correlates site-diary weather (free text) with same-day, same-project progress entries.',
 'software_analysis', '["project","construction","predictive"]', 'weekly', '{"dayOfWeek":1}',
 'deterministic_formula', '{"kind":"formula","formulaKey":"weather_impact_analysis"}',
 'built', NULL, 'system'),

-- 26. Rework Analysis -- data gap.
('rptdef_rework_analysis', NULL, 'Rework Analysis',
 'Cost of rework.',
 'software_analysis', '["financial","quality_safety","construction"]', 'monthly', '{"dayOfMonth":1}',
 'deterministic_formula', '{"kind":"formula","formulaKey":"rework_analysis"}',
 'data_gap', 'construction_expense_entries.expense_head enum (material/labour/transport/subcontractor/equipment/misc) has no ''rework'' value, and construction_punch_list_items has no cost field -- cost-of-rework is not computable from the current schema.', 'system'),

-- 27. Design Change Impact Analysis.
('rptdef_design_change_impact_analysis', NULL, 'Design Change Impact Analysis',
 'Cost and schedule impact of approved change orders, grouped by project.',
 'software_analysis', '["project","financial","construction"]', 'weekly', '{"dayOfWeek":1}',
 'deterministic_formula', '{"kind":"formula","formulaKey":"design_change_impact_analysis"}',
 'built', NULL, 'system'),

-- 28. Resource Forecast Analysis -- data gap.
('rptdef_resource_forecast_analysis', NULL, 'Resource Forecast Analysis',
 'Future manpower/material needs projection.',
 'software_analysis', '["resource","predictive"]', 'weekly', '{"dayOfWeek":1}',
 'deterministic_formula', '{"kind":"formula","formulaKey":"resource_forecast_analysis"}',
 'data_gap', 'No historical-trend baseline or forecasting model exists for future manpower/material needs -- would require a real time-series projection over attendance/consumption history, not implemented.', 'system'),

-- 29. Executive Portfolio Analysis.
('rptdef_executive_portfolio_analysis', NULL, 'Executive Portfolio Analysis',
 'All organisation projects compared by health status, org-wide.',
 'software_report', '["executive","project"]', 'weekly', '{"dayOfWeek":1}',
 'deterministic_aggregation', '{"kind":"aggregation","tableLabel":"projects","tableKey":"projects","groupByColumn":"healthStatus","aggregation":"count"}',
 'built', NULL, 'system'),

-- 30. AI Project Risk Prediction -- ai_recipe, grounded on real safety-incident data.
('rptdef_ai_project_risk_prediction', NULL, 'AI Project Risk Prediction',
 'AI-estimated probability of project failure/serious risk, partially grounded on real open safety-incident severity counts (the model reasons over real queried data; this is a partial grounding, not the full SPI/CPI/open-issues composite a production version would ideally use).',
 'ai_analysis', '["predictive","quality_safety","executive"]', 'weekly', '{"dayOfWeek":1}',
 'ai_recipe', '{"kind":"ai_recipe","promptKey":"ai_project_risk_prediction","groundingNote":"Grounded on open incidents (category=Safety) grouped by severity, org-wide -- a partial, honest grounding; a fuller version would also feed SPI/CPI/open-RFI/change-order counts, which the current single-table groundingQuery mechanism does not yet compose across multiple tables in one call.","groundingQuery":{"tableKey":"incidents","groupByColumn":"severity","aggregation":"count","filterEquals":{"columnKey":"category","value":"Safety"}}}',
 'built', NULL, 'system')

ON CONFLICT (id) DO NOTHING;

-- ═══════════════════════════════════════════════════════════════════════
-- SECTION 3 of 3: 20 EXECUTIVE DASHBOARD KPIs (CEO view)
-- ═══════════════════════════════════════════════════════════════════════

INSERT INTO compliance.report_definitions
  (id, org_id, name, description, category, classifications, periodicity, periodicity_config, execution_type, execution_config, status, data_gap_note, created_by)
VALUES

-- 1. Total Projects.
('rptdef_kpi_total_projects', NULL, 'Total Projects',
 'Count of all projects in the organisation.',
 'software_report', '["executive","project"]', 'daily', NULL,
 'deterministic_aggregation', '{"kind":"aggregation","tableLabel":"projects","tableKey":"projects","aggregation":"count"}',
 'built', NULL, 'system'),

-- 2. Active Projects.
('rptdef_kpi_active_projects', NULL, 'Active Projects',
 'Count of projects with is_active = true.',
 'software_report', '["executive","project"]', 'daily', NULL,
 'deterministic_aggregation', '{"kind":"aggregation","tableLabel":"projects","tableKey":"projects","aggregation":"count","filterEquals":{"columnKey":"isActive","value":true}}',
 'built', NULL, 'system'),

-- 3. Projects Delayed.
('rptdef_kpi_projects_delayed', NULL, 'Projects Delayed',
 'Count of projects with health_status = off_track (the real proxy for "delayed" this schema has -- there is no separate delayed flag).',
 'software_report', '["executive","project"]', 'daily', NULL,
 'deterministic_aggregation', '{"kind":"aggregation","tableLabel":"projects","tableKey":"projects","aggregation":"count","filterEquals":{"columnKey":"healthStatus","value":"off_track"}}',
 'built', NULL, 'system'),

-- 4. Projects at Risk.
('rptdef_kpi_projects_at_risk', NULL, 'Projects at Risk',
 'Count of projects with health_status = at_risk.',
 'software_report', '["executive","project"]', 'daily', NULL,
 'deterministic_aggregation', '{"kind":"aggregation","tableLabel":"projects","tableKey":"projects","aggregation":"count","filterEquals":{"columnKey":"healthStatus","value":"at_risk"}}',
 'built', NULL, 'system'),

-- 5. Today's Progress.
('rptdef_kpi_todays_progress', NULL, 'Today''s Progress',
 'Progress entries logged and total quantity done today, grouped by project.',
 'software_report', '["executive","project"]', 'daily', NULL,
 'deterministic_formula', '{"kind":"formula","formulaKey":"todays_site_progress"}',
 'built', NULL, 'system'),

-- 6. Overall Completion %.
('rptdef_kpi_overall_completion', NULL, 'Overall Completion %',
 'Org-wide average of each construction activity''s latest logged percent-complete.',
 'software_analysis', '["executive","project"]', 'daily', NULL,
 'deterministic_formula', '{"kind":"formula","formulaKey":"portfolio_completion_percent"}',
 'built', NULL, 'system'),

-- 7. Budget Utilized %.
('rptdef_kpi_budget_utilized', NULL, 'Budget Utilized %',
 'Org-wide actual expense as a % of total budget, scoped to project-linked cost centres.',
 'software_analysis', '["executive","financial"]', 'daily', NULL,
 'deterministic_formula', '{"kind":"formula","formulaKey":"portfolio_budget_utilization"}',
 'built', NULL, 'system'),

-- 8. Profit Forecast -- data gap.
('rptdef_kpi_profit_forecast', NULL, 'Profit Forecast',
 'Organisation-wide profit projection.',
 'ai_analysis', '["executive","financial","predictive"]', 'monthly', '{"dayOfMonth":1}',
 'ai_recipe', '{"kind":"ai_recipe","promptKey":"profit_forecast","groundingNote":"No forecasting model or historical-trend baseline exists for organisation-wide profit projection -- see Profitability Analysis for a real (non-forecast, current-period) per-project margin figure instead."}',
 'data_gap', 'No forecasting model or historical-trend baseline exists for organisation-wide profit projection -- see Profitability Analysis for a real, current-period (non-forecast) per-project margin figure instead.', 'system'),

-- 9. Cash Required Next 30 Days -- ai_recipe, same grounding pattern as Cash Flow Forecast Analysis.
('rptdef_kpi_cash_required_30d', NULL, 'Cash Required Next 30 Days',
 'AI-grounded estimate of near-term cash needs, based on real recent construction_expense_entries totals by head.',
 'ai_analysis', '["executive","financial","predictive"]', 'weekly', '{"dayOfWeek":1}',
 'ai_recipe', '{"kind":"ai_recipe","promptKey":"cash_required_next_30_days","groundingNote":"Same grounding as Cash Flow Forecast Analysis (construction_expense_entries totals by expense_head) -- a directional read of recent spend, not a full AR/AP-aware cash model.","groundingQuery":{"tableKey":"construction_expense_entries","groupByColumn":"expenseHead","aggregation":"sum","aggregationColumnKey":"amount"}}',
 'built', NULL, 'system'),

-- 10. Client Approvals Pending -- data gap.
('rptdef_kpi_client_approvals_pending', NULL, 'Client Approvals Pending',
 'Count of approvals specifically awaiting a client (not internal reviewer) decision.',
 'software_report', '["executive","project"]', 'daily', NULL,
 'deterministic_formula', '{"kind":"formula","formulaKey":"client_approvals_pending"}',
 'data_gap', 'Same gap as Client Approval Report -- construction_submittals/construction_change_orders track pending-approval status but have no field distinguishing a client-role approver from an internal reviewer.', 'system'),

-- 11. RFIs Pending.
('rptdef_kpi_rfis_pending', NULL, 'RFIs Pending',
 'Count of open RFIs, org-wide.',
 'software_report', '["executive","project"]', 'daily', NULL,
 'deterministic_aggregation', '{"kind":"aggregation","tableLabel":"construction_rfis","tableKey":"construction_rfis","aggregation":"count","filterEquals":{"columnKey":"status","value":"open"}}',
 'built', NULL, 'system'),

-- 12. Change Orders Pending.
('rptdef_kpi_change_orders_pending', NULL, 'Change Orders Pending',
 'Count of change orders awaiting approval, org-wide.',
 'software_report', '["executive","project","financial"]', 'daily', NULL,
 'deterministic_aggregation', '{"kind":"aggregation","tableLabel":"construction_change_orders","tableKey":"construction_change_orders","aggregation":"count","filterEquals":{"columnKey":"status","value":"pending_approval"}}',
 'built', NULL, 'system'),

-- 13. Labour on Site Today.
('rptdef_kpi_labour_on_site_today', NULL, 'Labour on Site Today',
 'Count of labour marked present today, grouped by project.',
 'software_report', '["executive","resource"]', 'daily', NULL,
 'deterministic_formula', '{"kind":"formula","formulaKey":"labour_on_site_today"}',
 'built', NULL, 'system'),

-- 14. Equipment Idle Today -- data gap.
('rptdef_kpi_equipment_idle_today', NULL, 'Equipment Idle Today',
 'Count of equipment currently idle.',
 'software_report', '["executive","resource"]', 'daily', NULL,
 'deterministic_formula', '{"kind":"formula","formulaKey":"equipment_idle_today"}',
 'data_gap', 'No equipment/machinery table exists in this schema -- same gap as Equipment Utilization/Breakdown Reports.', 'system'),

-- 15. Materials Running Low -- data gap.
('rptdef_kpi_materials_running_low', NULL, 'Materials Running Low',
 'Items whose current stock is below their reorder level.',
 'software_report', '["executive","procurement"]', 'daily', NULL,
 'deterministic_formula', '{"kind":"formula","formulaKey":"materials_running_low"}',
 'data_gap', 'erp_reorder_levels defines a per-item reorder threshold and erp_stock_ledger_entries can compute current stock via sum(quantity_change) -- both tables exist, but no report compares the two yet; the comparison is not wired.', 'system'),

-- 16. Vendors Delayed.
('rptdef_kpi_vendors_delayed', NULL, 'Vendors Delayed',
 'Suppliers with purchase orders past their expected delivery date and not yet completed/cancelled.',
 'software_report', '["executive","procurement","vendor_management"]', 'daily', NULL,
 'deterministic_formula', '{"kind":"formula","formulaKey":"vendors_delayed_purchase_orders"}',
 'built', NULL, 'system'),

-- 17. Safety Incidents This Month.
('rptdef_kpi_safety_incidents_month', NULL, 'Safety Incidents This Month',
 'Safety-category incidents logged this calendar month, grouped by severity.',
 'software_report', '["executive","quality_safety","compliance"]', 'monthly', '{"dayOfMonth":1}',
 'deterministic_formula', '{"kind":"formula","formulaKey":"safety_incidents_this_month"}',
 'built', NULL, 'system'),

-- 18. Quality Issues Open -- data gap.
('rptdef_kpi_quality_issues_open', NULL, 'Quality Issues Open',
 'Count of open formal QA/QC quality issues.',
 'software_report', '["executive","quality_safety"]', 'daily', NULL,
 'deterministic_formula', '{"kind":"formula","formulaKey":"quality_issues_open"}',
 'data_gap', 'No dedicated quality-inspection tracking table exists -- see Snag List Report (construction_punch_list_items) for the closest real substitute, which tracks defects/punch-items, not formal QA/QC inspection findings.', 'system'),

-- 19. AI Risk Score -- ai_recipe, same grounding as AI Project Risk Prediction.
('rptdef_kpi_ai_risk_score', NULL, 'AI Risk Score',
 'AI-estimated organisation-wide risk score, partially grounded on real open safety-incident severity counts.',
 'ai_analysis', '["executive","predictive","quality_safety"]', 'daily', NULL,
 'ai_recipe', '{"kind":"ai_recipe","promptKey":"ai_risk_score","groundingNote":"Same partial grounding as AI Project Risk Prediction -- open incidents (category=Safety) grouped by severity, org-wide. Not the full SPI/CPI/open-issues composite a production score would ideally use.","groundingQuery":{"tableKey":"incidents","groupByColumn":"severity","aggregation":"count","filterEquals":{"columnKey":"category","value":"Safety"}}}',
 'built', NULL, 'system'),

-- 20. AI Recommended Actions -- ai_recipe, grounded on real open-risk data.
('rptdef_kpi_ai_recommended_actions', NULL, 'AI Recommended Actions',
 'AI-suggested next actions, grounded on real open organisational risks grouped by category.',
 'ai_analysis', '["executive","predictive"]', 'daily', NULL,
 'ai_recipe', '{"kind":"ai_recipe","promptKey":"ai_recommended_actions","groundingNote":"Grounded on open compliance.risks grouped by category, org-wide -- suggestions are scoped to what the open risk register actually shows, not a full-context recommendation across every module.","groundingQuery":{"tableKey":"risks","groupByColumn":"category","aggregation":"count","filterEquals":{"columnKey":"status","value":"open"}}}',
 'built', NULL, 'system')

ON CONFLICT (id) DO NOTHING;
