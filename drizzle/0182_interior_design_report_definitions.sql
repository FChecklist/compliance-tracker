-- Interior Design Reports & Analysis Engine seed data (Priority 11, Owner
-- directive 2026-07-13). Platform-wide (org_id NULL) report_definitions
-- rows for the Owner's 10 Interior Design Reports + 10 Interior Design
-- Analyses catalog. See src/lib/services/report-engine-service.ts's new
-- "Interior Design formulas" section for the 8 real deterministic_formula
-- functions this migration wires up (added to FORMULA_REGISTRY, additive
-- only -- the existing schedule_performance_index/cost_performance_index/
-- project_health_index entries are untouched).
--
-- Honest split: 8 of the 20 rows are status='built' (verified against the
-- real interior_* schema and wired to a real, dispatcher-executable
-- formula function). The other 12 are status='data_gap' with a specific
-- data_gap_note explaining exactly which column/table doesn't exist --
-- this domain's schema (Wave 142/143) is genuinely thinner than
-- Construction/Project's, so a high data_gap count here is expected, not
-- a shortfall. No new tables/columns are added by this migration -- every
-- data_gap row documents what a *future* migration would need, it does
-- not attempt to invent that coverage here.
--
-- execution_config on data_gap rows uses a placeholder formulaKey that is
-- deliberately NOT registered in FORMULA_REGISTRY -- safe, because
-- report-engine-service.ts's executeReportDefinition() checks
-- `definition.status !== 'built'` and returns the data_gap_note BEFORE
-- ever dispatching by executionType/executionConfig, so an unregistered
-- placeholder key is never actually looked up.
--
-- A partial unique index on (name) WHERE org_id IS NULL makes this
-- migration safe to re-run (ON CONFLICT DO NOTHING) without duplicating
-- rows -- report_definitions itself (0180) has no uniqueness beyond its
-- primary key.
CREATE UNIQUE INDEX IF NOT EXISTS ux_report_definitions_platform_name
  ON compliance.report_definitions (name) WHERE org_id IS NULL;

INSERT INTO compliance.report_definitions
  (org_id, name, description, category, classifications, periodicity, periodicity_config, execution_type, execution_config, output_formats, status, data_gap_note, created_by)
VALUES
  -- ── 10 Interior Design Reports ──────────────────────────────────────
  (NULL, 'Mood Board Approval Report',
   'Draft/shared/approved status of every mood board for a project -- tracks client approval progress. Current-state snapshot (interior_mood_boards has no approvedAt timestamp).',
   'software_report', '["interior_design","project"]'::jsonb, 'weekly', '{"dayOfWeek":1}'::jsonb,
   'deterministic_formula', '{"kind":"formula","formulaKey":"interior_mood_board_approval_report"}'::jsonb,
   '["table"]'::jsonb, 'built', NULL, 'system'),

  (NULL, 'Design Revision History',
   'Version-by-version history of interior design deliverables (mood boards, floor plans, FF&E specs, materials).',
   'software_report', '["interior_design","project"]'::jsonb, 'on_demand', NULL,
   'deterministic_formula', '{"kind":"formula","formulaKey":"interior_design_revision_history"}'::jsonb,
   '["table"]'::jsonb, 'data_gap',
   'No revision/version tracking exists on any interior design entity -- interior_mood_boards/interior_floor_plans/interior_ffe_items/interior_materials all lack a version number or parentId revision chain (unlike construction_boqs'' version/parent_boq_id, Wave 125). Would need a new migration adding version/revision-chain columns (or a dedicated revision-log table) to these tables -- out of this pass''s scope.',
   'system'),

  (NULL, 'Material Selection Report',
   'Selected flooring/wall/ceiling materials per room (via floor plans) plus fabric/finish FF&E selections for a project.',
   'software_report', '["interior_design","procurement","project"]'::jsonb, 'on_demand', NULL,
   'deterministic_formula', '{"kind":"formula","formulaKey":"interior_material_selection_report"}'::jsonb,
   '["table"]'::jsonb, 'built', NULL, 'system'),

  (NULL, 'Furniture Procurement Report',
   'Specified/ordered/received/installed status for every furniture FF&E line item in a project.',
   'software_report', '["interior_design","procurement","resource"]'::jsonb, 'weekly', '{"dayOfWeek":1}'::jsonb,
   'deterministic_formula', '{"kind":"formula","formulaKey":"interior_furniture_procurement_report"}'::jsonb,
   '["table"]'::jsonb, 'built', NULL, 'system'),

  (NULL, 'Custom Furniture Production Report',
   'Factory production progress for custom-manufactured furniture items.',
   'software_report', '["interior_design","procurement","vendor_management"]'::jsonb, 'weekly', '{"dayOfWeek":1}'::jsonb,
   'deterministic_formula', '{"kind":"formula","formulaKey":"interior_custom_furniture_production_report"}'::jsonb,
   '["table"]'::jsonb, 'data_gap',
   'interior_ffe_items.status only has specified/ordered/received/installed -- there is no distinct ''in production at factory'' stage, no percent-complete-at-factory field, and no flag distinguishing custom-manufactured items from off-the-shelf purchases. Folding ''ordered'' into ''in production'' would misrepresent regular stock purchase orders as factory progress. Would need new status granularity plus a custom-item flag -- out of this pass''s scope.',
   'system'),

  (NULL, 'Site Measurement Report',
   'Per-room floor area (computed from the recorded 2D floor plan polygon) and ceiling height for a project.',
   'software_report', '["interior_design","project"]'::jsonb, 'on_demand', NULL,
   'deterministic_formula', '{"kind":"formula","formulaKey":"interior_site_measurement_report"}'::jsonb,
   '["table"]'::jsonb, 'built', NULL, 'system'),

  (NULL, 'Client Decision Tracker',
   'Pending client choices/decisions awaiting a response, per project.',
   'software_report', '["interior_design","project","customer"]'::jsonb, 'on_demand', NULL,
   'deterministic_formula', '{"kind":"formula","formulaKey":"interior_client_decision_tracker"}'::jsonb,
   '["table"]'::jsonb, 'data_gap',
   'No client-decision entity exists -- the generic tasks table has no category/type field to distinguish a ''pending client design decision'' from any other task, and interior_mood_boards/interior_ffe_items'' status fields (draft/shared/approved, specified/ordered/received/installed) track internal review state, not itemized pending-decision records with due dates or decision options. Would need a new interior_client_decisions-style table -- out of this pass''s scope.',
   'system'),

  (NULL, 'Room-wise Progress Report',
   'FF&E installation completion percentage per room for a project (installed / total placed FF&E items).',
   'software_report', '["interior_design","project"]'::jsonb, 'weekly', '{"dayOfWeek":1}'::jsonb,
   'deterministic_formula', '{"kind":"formula","formulaKey":"interior_room_progress_report"}'::jsonb,
   '["table"]'::jsonb, 'built', NULL, 'system'),

  (NULL, 'BOQ Consumption Report',
   'Interior-design-scope material consumption against the project BOQ.',
   'software_report', '["interior_design","procurement","construction"]'::jsonb, 'monthly', '{"dayOfMonth":1}'::jsonb,
   'deterministic_formula', '{"kind":"formula","formulaKey":"interior_boq_consumption_report"}'::jsonb,
   '["table"]'::jsonb, 'data_gap',
   'construction-reports-service.ts#materialConsumptionReport already computes net stock movement per item for a project (erp_stock_ledger_entries x erp_items), but neither that table nor construction_boq_line_items has any field distinguishing interior-design-scope material (finishes, fixtures) from general construction material -- an honestly interior-scoped version would require a trade/category tag that doesn''t exist in the current schema, and a project-wide (non-interior-specific) version would just duplicate the Construction/Project domain''s own existing report rather than add real interior-specific value. Out of this pass''s scope.',
   'system'),

  (NULL, 'Final Styling Checklist',
   'Itemized handover-readiness checklist for a project''s interior styling.',
   'software_report', '["interior_design","project"]'::jsonb, 'on_demand', NULL,
   'deterministic_formula', '{"kind":"formula","formulaKey":"interior_final_styling_checklist"}'::jsonb,
   '["table"]'::jsonb, 'data_gap',
   'No handover/styling-checklist entity exists (itemized items like ''keys handed over'', ''punch list closed'', ''final cleaning done'' with individual sign-off). The closest available signals -- interior_floor_plans.status=''final'', interior_ffe_items.status=''installed'', interior_mood_boards.status=''approved'' -- could be blended into a ''readiness %'', but that would be a fabricated proxy checklist standing in for a real tracked one, not honest coverage. Would need a new interior_handover_checklists-style table -- out of this pass''s scope.',
   'system'),

  -- ── 10 Interior Design Analyses ─────────────────────────────────────
  (NULL, 'Client Change Frequency Analysis',
   'How often each client requests changes to their interior design -- identifies indecisive clients.',
   'software_analysis', '["interior_design","customer","project"]'::jsonb, 'monthly', '{"dayOfMonth":1}'::jsonb,
   'deterministic_formula', '{"kind":"formula","formulaKey":"interior_client_change_frequency_analysis"}'::jsonb,
   '["table"]'::jsonb, 'data_gap',
   'Same root gap as Design Revision History: no change/revision-history log exists for interior deliverables (mood board item edits, FF&E respecification) -- only current state is stored, not a log of when/how often something changed. ''Change frequency per client'' cannot be computed without that history. Out of this pass''s scope.',
   'system'),

  (NULL, 'Design Revision Cost Analysis',
   'Cost impact attributable to interior design revisions.',
   'software_analysis', '["interior_design","financial","project"]'::jsonb, 'monthly', '{"dayOfMonth":1}'::jsonb,
   'deterministic_formula', '{"kind":"formula","formulaKey":"interior_design_revision_cost_analysis"}'::jsonb,
   '["table"]'::jsonb, 'data_gap',
   'construction_change_orders does track cost_impact for scope/schedule changes generically, but nothing links a change order to a specific interior design revision (a mood board version, an FF&E respecification), and interior deliverables have no revision history to begin with (see Design Revision History gap). There is no baseline to attribute cost impact against. Out of this pass''s scope.',
   'system'),

  (NULL, 'Vendor Lead Time Analysis',
   'Average quoted lead time by vendor across FF&E items -- a planned-lead-time comparison, not measured on-time-delivery reliability (see the formula''s own note for why).',
   'software_analysis', '["interior_design","vendor_management","procurement"]'::jsonb, 'monthly', '{"dayOfMonth":1}'::jsonb,
   'deterministic_formula', '{"kind":"formula","formulaKey":"interior_vendor_lead_time_analysis"}'::jsonb,
   '["table"]'::jsonb, 'built', NULL, 'system'),

  (NULL, 'Furniture Manufacturing Analysis',
   'Factory efficiency for custom-manufactured furniture items.',
   'software_analysis', '["interior_design","vendor_management","procurement"]'::jsonb, 'monthly', '{"dayOfMonth":1}'::jsonb,
   'deterministic_formula', '{"kind":"formula","formulaKey":"interior_furniture_manufacturing_analysis"}'::jsonb,
   '["table"]'::jsonb, 'data_gap',
   'Same root gap as Custom Furniture Production Report: no factory-stage/percent-complete tracking and no custom-vs-stock item distinction exists on interior_ffe_items, so ''factory efficiency'' has no underlying data to compute from. Out of this pass''s scope.',
   'system'),

  (NULL, 'Client Approval Cycle Time Analysis',
   'How quickly clients move from reviewing a mood board to approving it -- decision speed.',
   'software_analysis', '["interior_design","customer","project"]'::jsonb, 'monthly', '{"dayOfMonth":1}'::jsonb,
   'deterministic_formula', '{"kind":"formula","formulaKey":"interior_client_approval_cycle_time_analysis"}'::jsonb,
   '["table"]'::jsonb, 'data_gap',
   'interior_mood_boards has only a createdAt timestamp -- no updatedAt/approvedAt column and no status-change history, so the time between a board being shared and being approved cannot be computed. Would need status-change timestamp columns (or a status-history table) -- out of this pass''s scope.',
   'system'),

  (NULL, 'Room Delay Analysis',
   'Rooms whose interior design/fit-out is behind schedule -- problem-area identification.',
   'software_analysis', '["interior_design","project"]'::jsonb, 'monthly', '{"dayOfMonth":1}'::jsonb,
   'deterministic_formula', '{"kind":"formula","formulaKey":"interior_room_delay_analysis"}'::jsonb,
   '["table"]'::jsonb, 'data_gap',
   'No planned/target completion date exists at the room level -- interior_floor_plan_rooms has no target-date column, and interior_ffe_items has no room-scoped due date either. Room-wise Progress Report (built) shows CURRENT completion state, but ''delay'' requires a planned-vs-actual comparison with no planned baseline to compare against. Out of this pass''s scope.',
   'system'),

  (NULL, 'Material Delivery Accuracy Analysis',
   'On-time delivery accuracy for ordered materials/FF&E items.',
   'software_analysis', '["interior_design","vendor_management","procurement"]'::jsonb, 'monthly', '{"dayOfMonth":1}'::jsonb,
   'deterministic_formula', '{"kind":"formula","formulaKey":"interior_material_delivery_accuracy_analysis"}'::jsonb,
   '["table"]'::jsonb, 'data_gap',
   'interior_ffe_items tracks a ''received'' status but has no orderedAt/receivedAt timestamp columns -- on-time-delivery accuracy requires comparing an expected delivery date (order date + lead_time_days) against an actual receipt date, and neither is recorded. Vendor Lead Time Analysis (built) can only report the planned/quoted lead time, not actual accuracy. Out of this pass''s scope.',
   'system'),

  (NULL, 'Variation Order Analysis',
   'Scope-creep tracking for interior-design-caused variation/change orders.',
   'software_analysis', '["interior_design","project","financial"]'::jsonb, 'monthly', '{"dayOfMonth":1}'::jsonb,
   'deterministic_formula', '{"kind":"formula","formulaKey":"interior_variation_order_analysis"}'::jsonb,
   '["table"]'::jsonb, 'data_gap',
   'construction_change_orders (cost_impact/schedule_impact_days/status) does track variation/change orders generically at the project level, but nothing distinguishes an interior-design-caused scope change from a civil/MEP/other-trade one -- an honestly interior-scoped version needs a trade/category tag that doesn''t exist. The generic project-wide version is the Construction/Project domain''s own report to build; duplicating it here with an interior_design tag on data that isn''t actually filtered to interior scope would misrepresent it. Out of this pass''s scope.',
   'system'),

  (NULL, 'Profit by Room Analysis',
   'FF&E procurement margin (unit price minus unit cost) grouped by room/area for a project.',
   'software_analysis', '["interior_design","financial","project"]'::jsonb, 'monthly', '{"dayOfMonth":1}'::jsonb,
   'deterministic_formula', '{"kind":"formula","formulaKey":"interior_profit_by_room_analysis"}'::jsonb,
   '["table"]'::jsonb, 'built', NULL, 'system'),

  (NULL, 'Designer Productivity Analysis',
   'Output volume (mood boards + floor plans + FF&E specs created) by designer, org-wide.',
   'software_analysis', '["interior_design","hr","resource"]'::jsonb, 'monthly', '{"dayOfMonth":1}'::jsonb,
   'deterministic_formula', '{"kind":"formula","formulaKey":"interior_designer_productivity_analysis"}'::jsonb,
   '["table"]'::jsonb, 'built', NULL, 'system')
ON CONFLICT (name) WHERE org_id IS NULL DO NOTHING;
