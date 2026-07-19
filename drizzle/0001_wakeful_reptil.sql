CREATE SCHEMA "platform";
--> statement-breakpoint
CREATE TYPE "compliance"."abac_policy_effect" AS ENUM('deny');--> statement-breakpoint
CREATE TYPE "platform"."ai_model_health" AS ENUM('healthy', 'degraded', 'down');--> statement-breakpoint
CREATE TYPE "platform"."ai_model_status" AS ENUM('active', 'disabled', 'deprecated');--> statement-breakpoint
CREATE TYPE "compliance"."ai_provider" AS ENUM('groq', 'openai', 'anthropic', 'google', 'openrouter');--> statement-breakpoint
CREATE TYPE "platform"."ai_router_scope" AS ENUM('software_team', 'end_user_org', 'sales_marketing', 'customer_success');--> statement-breakpoint
CREATE TYPE "compliance"."application_stage" AS ENUM('applied', 'screening', 'interview', 'offer', 'hired', 'rejected');--> statement-breakpoint
CREATE TYPE "compliance"."approval_request_status" AS ENUM('pending', 'approved', 'rejected');--> statement-breakpoint
CREATE TYPE "compliance"."asset_status" AS ENUM('draft', 'active', 'archived', 'deleted');--> statement-breakpoint
CREATE TYPE "compliance"."asset_type" AS ENUM('report', 'screen', 'dashboard', 'ai_agent', 'workflow', 'api', 'prompt', 'function', 'policy', 'rule', 'sql_query', 'email_template', 'notification', 'template', 'project', 'task', 'document', 'decision', 'automation', 'role', 'permission', 'computation_engine', 'dynamic_chain', 'other');--> statement-breakpoint
CREATE TYPE "compliance"."board_meeting_status" AS ENUM('scheduled', 'held', 'cancelled');--> statement-breakpoint
CREATE TYPE "compliance"."board_meeting_type" AS ENUM('board_meeting', 'agm', 'egm', 'committee_meeting');--> statement-breakpoint
CREATE TYPE "compliance"."construction_attendance_status" AS ENUM('present', 'absent', 'half_day');--> statement-breakpoint
CREATE TYPE "compliance"."construction_ball_in_court" AS ENUM('contractor', 'architect', 'owner', 'consultant');--> statement-breakpoint
CREATE TYPE "compliance"."construction_boq_status" AS ENUM('draft', 'submitted', 'approved', 'superseded');--> statement-breakpoint
CREATE TYPE "compliance"."construction_change_order_status" AS ENUM('draft', 'pending_approval', 'approved', 'rejected');--> statement-breakpoint
CREATE TYPE "compliance"."construction_expense_head" AS ENUM('material', 'labour', 'transport', 'subcontractor', 'equipment', 'misc');--> statement-breakpoint
CREATE TYPE "compliance"."construction_kpi_approval_status" AS ENUM('draft', 'submitted', 'approved');--> statement-breakpoint
CREATE TYPE "compliance"."construction_kpi_period" AS ENUM('monthly', 'quarterly', 'milestone');--> statement-breakpoint
CREATE TYPE "compliance"."construction_punch_priority" AS ENUM('low', 'medium', 'high');--> statement-breakpoint
CREATE TYPE "compliance"."construction_punch_status" AS ENUM('open', 'ready_for_review', 'verified_closed');--> statement-breakpoint
CREATE TYPE "compliance"."construction_rfi_status" AS ENUM('open', 'answered', 'closed');--> statement-breakpoint
CREATE TYPE "compliance"."construction_submittal_status" AS ENUM('pending', 'approved', 'approved_as_noted', 'revise_resubmit', 'rejected');--> statement-breakpoint
CREATE TYPE "compliance"."construction_submittal_type" AS ENUM('shop_drawing', 'product_data', 'sample', 'other');--> statement-breakpoint
CREATE TYPE "compliance"."cost_type" AS ENUM('government_fee', 'consultant_fee', 'penalty_paid', 'other');--> statement-breakpoint
CREATE TYPE "compliance"."crm_account_lifecycle_stage" AS ENUM('prospect', 'active_client', 'dormant', 'churned');--> statement-breakpoint
CREATE TYPE "compliance"."delegation_scope_type" AS ENUM('task', 'workflow', 'project', 'module', 'communication_type', 'approval_type');--> statement-breakpoint
CREATE TYPE "compliance"."document_matching_rule_field" AS ENUM('filename', 'content', 'both');--> statement-breakpoint
CREATE TYPE "compliance"."document_matching_rule_type" AS ENUM('any_word', 'all_words', 'exact', 'regex');--> statement-breakpoint
CREATE TYPE "compliance"."employment_status" AS ENUM('active', 'on_leave', 'terminated', 'resigned');--> statement-breakpoint
CREATE TYPE "compliance"."erp_account_root_type" AS ENUM('asset', 'liability', 'equity', 'income', 'expense');--> statement-breakpoint
CREATE TYPE "compliance"."erp_asset_status" AS ENUM('draft', 'submitted', 'in_use', 'disposed', 'scrapped');--> statement-breakpoint
CREATE TYPE "compliance"."erp_bank_reconciliation_status" AS ENUM('unmatched', 'matched', 'ignored');--> statement-breakpoint
CREATE TYPE "compliance"."erp_budget_action" AS ENUM('ignore', 'warn', 'stop');--> statement-breakpoint
CREATE TYPE "compliance"."erp_budget_status" AS ENUM('draft', 'submitted', 'cancelled');--> statement-breakpoint
CREATE TYPE "compliance"."erp_cash_voucher_status" AS ENUM('draft', 'submitted', 'cancelled');--> statement-breakpoint
CREATE TYPE "compliance"."erp_cash_voucher_type" AS ENUM('receipt', 'payment');--> statement-breakpoint
CREATE TYPE "compliance"."erp_component_calc_type" AS ENUM('flat', 'percentage_of_basic', 'percentage_of_gross');--> statement-breakpoint
CREATE TYPE "compliance"."erp_contract_amendment_status" AS ENUM('draft', 'approved');--> statement-breakpoint
CREATE TYPE "compliance"."erp_contract_billing_frequency" AS ENUM('monthly', 'quarterly', 'half_yearly', 'annually', 'milestone');--> statement-breakpoint
CREATE TYPE "compliance"."erp_contract_obligation_status" AS ENUM('pending', 'completed', 'overdue');--> statement-breakpoint
CREATE TYPE "compliance"."erp_contract_status" AS ENUM('draft', 'active', 'expired', 'terminated', 'renewed');--> statement-breakpoint
CREATE TYPE "compliance"."erp_credit_note_status" AS ENUM('draft', 'submitted', 'cancelled');--> statement-breakpoint
CREATE TYPE "compliance"."erp_depreciation_method" AS ENUM('straight_line', 'written_down_value');--> statement-breakpoint
CREATE TYPE "compliance"."erp_invoice_status" AS ENUM('draft', 'submitted', 'partially_paid', 'paid', 'overdue', 'cancelled');--> statement-breakpoint
CREATE TYPE "compliance"."erp_item_serial_status" AS ENUM('in_stock', 'delivered', 'returned');--> statement-breakpoint
CREATE TYPE "compliance"."erp_journal_entry_status" AS ENUM('draft', 'submitted', 'cancelled');--> statement-breakpoint
CREATE TYPE "compliance"."erp_party_type" AS ENUM('customer', 'supplier');--> statement-breakpoint
CREATE TYPE "compliance"."erp_payment_entry_status" AS ENUM('draft', 'submitted', 'approved', 'rejected', 'cancelled');--> statement-breakpoint
CREATE TYPE "compliance"."erp_payment_type" AS ENUM('receive', 'pay');--> statement-breakpoint
CREATE TYPE "compliance"."erp_payroll_run_status" AS ENUM('draft', 'processed', 'paid', 'cancelled');--> statement-breakpoint
CREATE TYPE "compliance"."erp_payslip_line_type" AS ENUM('earning', 'deduction');--> statement-breakpoint
CREATE TYPE "compliance"."erp_period_status" AS ENUM('open', 'closed');--> statement-breakpoint
CREATE TYPE "compliance"."erp_pricing_applies_to" AS ENUM('all', 'customer', 'item');--> statement-breakpoint
CREATE TYPE "compliance"."erp_pricing_discount_type" AS ENUM('percentage', 'flat');--> statement-breakpoint
CREATE TYPE "compliance"."erp_purchase_return_status" AS ENUM('requested', 'approved', 'dispatched', 'rejected');--> statement-breakpoint
CREATE TYPE "compliance"."erp_requisition_status" AS ENUM('draft', 'submitted', 'approved', 'rejected', 'converted');--> statement-breakpoint
CREATE TYPE "compliance"."erp_rfq_status" AS ENUM('draft', 'sent', 'closed');--> statement-breakpoint
CREATE TYPE "compliance"."erp_salary_component_type" AS ENUM('earning', 'deduction');--> statement-breakpoint
CREATE TYPE "compliance"."erp_sales_return_status" AS ENUM('requested', 'approved', 'received', 'rejected');--> statement-breakpoint
CREATE TYPE "compliance"."erp_statutory_rule_type" AS ENUM('pf', 'esi', 'professional_tax');--> statement-breakpoint
CREATE TYPE "compliance"."erp_subscription_status" AS ENUM('active', 'paused', 'cancelled', 'expired');--> statement-breakpoint
CREATE TYPE "compliance"."erp_supplier_quotation_status" AS ENUM('draft', 'submitted');--> statement-breakpoint
CREATE TYPE "compliance"."approval_workflow_condition_operator" AS ENUM('gt', 'gte', 'lt', 'lte', 'eq');--> statement-breakpoint
CREATE TYPE "compliance"."approval_workflow_instance_status" AS ENUM('pending', 'approved', 'rejected', 'cancelled');--> statement-breakpoint
CREATE TYPE "compliance"."approval_workflow_step_status" AS ENUM('pending', 'approved', 'rejected', 'skipped');--> statement-breakpoint
CREATE TYPE "compliance"."firm_fee_type" AS ENUM('fixed', 'hourly', 'retainer');--> statement-breakpoint
CREATE TYPE "compliance"."firm_invoice_status" AS ENUM('draft', 'sent', 'paid', 'overdue', 'void');--> statement-breakpoint
CREATE TYPE "compliance"."firm_service_line" AS ENUM('ca_services', 'cs_services', 'legal_services', 'grc_services', 'audit_services');--> statement-breakpoint
CREATE TYPE "compliance"."firm_staff_role" AS ENUM('partner', 'manager', 'associate', 'staff');--> statement-breakpoint
CREATE TYPE "compliance"."fm_amc_payment_frequency" AS ENUM('monthly', 'quarterly', 'half_yearly', 'annually', 'one_time');--> statement-breakpoint
CREATE TYPE "compliance"."fm_ppm_frequency" AS ENUM('daily', 'weekly', 'fortnightly', 'monthly', 'quarterly', 'half_yearly', 'annually');--> statement-breakpoint
CREATE TYPE "compliance"."fm_ppm_occurrence_status" AS ENUM('due', 'in_progress', 'completed', 'overdue', 'skipped');--> statement-breakpoint
CREATE TYPE "compliance"."fm_visitor_log_status" AS ENUM('checked_in', 'checked_out', 'denied');--> statement-breakpoint
CREATE TYPE "compliance"."gst_finding_severity" AS ENUM('error', 'warning', 'info');--> statement-breakpoint
CREATE TYPE "compliance"."gst_import_batch_status" AS ENUM('processing', 'staged', 'confirmed', 'failed', 'cancelled');--> statement-breakpoint
CREATE TYPE "compliance"."gst_invoice_direction" AS ENUM('sales', 'purchase', 'gstr2b');--> statement-breakpoint
CREATE TYPE "compliance"."gst_match_type" AS ENUM('exact', 'probable', 'mismatch', 'missing_in_2b', 'missing_in_books');--> statement-breakpoint
CREATE TYPE "compliance"."gst_return_status" AS ENUM('draft', 'generated', 'filed');--> statement-breakpoint
CREATE TYPE "compliance"."gst_return_type" AS ENUM('gstr1', 'gstr3b');--> statement-breakpoint
CREATE TYPE "compliance"."gst_source_type" AS ENUM('excel_generic', 'csv_generic', 'tally_xml', 'busy', 'zoho_books');--> statement-breakpoint
CREATE TYPE "compliance"."hr_attendance_status" AS ENUM('present', 'absent', 'half_day', 'on_leave', 'holiday');--> statement-breakpoint
CREATE TYPE "compliance"."incident_stage" AS ENUM('logged', 'triaged', 'investigating', 'contained', 'notified', 'remediated', 'closed');--> statement-breakpoint
CREATE TYPE "compliance"."ingestion_batch_status" AS ENUM('processing', 'review_pending', 'confirmed', 'cancelled', 'failed');--> statement-breakpoint
CREATE TYPE "compliance"."ingestion_item_status" AS ENUM('pending', 'approved', 'rejected', 'edited');--> statement-breakpoint
CREATE TYPE "compliance"."interior_ffe_category" AS ENUM('furniture', 'fixture', 'equipment', 'finish', 'textile', 'lighting', 'other');--> statement-breakpoint
CREATE TYPE "compliance"."interior_ffe_status" AS ENUM('specified', 'ordered', 'received', 'installed');--> statement-breakpoint
CREATE TYPE "compliance"."interior_material_category" AS ENUM('flooring', 'wall', 'ceiling');--> statement-breakpoint
CREATE TYPE "compliance"."interior_mood_board_status" AS ENUM('draft', 'shared', 'approved');--> statement-breakpoint
CREATE TYPE "compliance"."interview_recommendation" AS ENUM('strong_yes', 'yes', 'no', 'strong_no');--> statement-breakpoint
CREATE TYPE "compliance"."job_opening_status" AS ENUM('open', 'on_hold', 'closed', 'filled');--> statement-breakpoint
CREATE TYPE "compliance"."litigation_stage" AS ENUM('filed', 'hearing_scheduled', 'judgment_reserved', 'judgment_passed', 'appeal_filed', 'closed');--> statement-breakpoint
CREATE TYPE "compliance"."notice_status" AS ENUM('received', 'in_progress', 'replied', 'closed', 'appealed');--> statement-breakpoint
CREATE TYPE "compliance"."payment_status" AS ENUM('pending', 'unpaid', 'partially_paid', 'paid');--> statement-breakpoint
CREATE TYPE "compliance"."performance_review_cycle_status" AS ENUM('draft', 'active', 'closed');--> statement-breakpoint
CREATE TYPE "compliance"."performance_review_status" AS ENUM('pending', 'submitted', 'acknowledged');--> statement-breakpoint
CREATE TYPE "compliance"."pms_budget_line_kind" AS ENUM('labor', 'material');--> statement-breakpoint
CREATE TYPE "compliance"."pms_issue_priority" AS ENUM('no_priority', 'urgent', 'high', 'medium', 'low');--> statement-breakpoint
CREATE TYPE "compliance"."pms_issue_relation_type" AS ENUM('blocks', 'blocked_by', 'duplicates', 'relates_to');--> statement-breakpoint
CREATE TYPE "compliance"."pms_milestone_status" AS ENUM('planned', 'in_progress', 'completed', 'cancelled');--> statement-breakpoint
CREATE TYPE "compliance"."pms_sprint_status" AS ENUM('planned', 'active', 'completed', 'cancelled');--> statement-breakpoint
CREATE TYPE "compliance"."pms_status_group" AS ENUM('backlog', 'unstarted', 'started', 'completed', 'cancelled', 'triage');--> statement-breakpoint
CREATE TYPE "compliance"."pms_view_access" AS ENUM('private', 'shared');--> statement-breakpoint
CREATE TYPE "compliance"."policy_status" AS ENUM('draft', 'under_review', 'published');--> statement-breakpoint
CREATE TYPE "compliance"."recurrence_type" AS ENUM('none', 'monthly', 'quarterly', 'half_yearly', 'annually');--> statement-breakpoint
CREATE TYPE "compliance"."risk_category" AS ENUM('regulatory', 'operational', 'financial', 'strategic', 'reputational', 'cyber');--> statement-breakpoint
CREATE TYPE "compliance"."risk_status" AS ENUM('open', 'mitigating', 'closed');--> statement-breakpoint
CREATE TYPE "compliance"."rpt_approval_status" AS ENUM('pending', 'approved', 'rejected');--> statement-breakpoint
CREATE TYPE "compliance"."sales_commission_accrual_status" AS ENUM('accrued', 'paid', 'void');--> statement-breakpoint
CREATE TYPE "compliance"."sales_commission_type" AS ENUM('percentage', 'flat');--> statement-breakpoint
CREATE TYPE "compliance"."sales_partner_status" AS ENUM('active', 'suspended', 'offboarded');--> statement-breakpoint
CREATE TYPE "compliance"."sales_partner_type" AS ENUM('reseller', 'consultant', 'referral_agent', 'commission_agent', 'third_party', 'internal_employee', 'call_centre_agent');--> statement-breakpoint
CREATE TYPE "compliance"."sales_referral_status" AS ENUM('clicked', 'signup_completed', 'org_provisioned', 'paid', 'lost');--> statement-breakpoint
CREATE TYPE "compliance"."training_course_status" AS ENUM('draft', 'published', 'archived');--> statement-breakpoint
CREATE TYPE "compliance"."training_enrollment_status" AS ENUM('not_started', 'in_progress', 'completed');--> statement-breakpoint
CREATE TYPE "compliance"."training_lesson_content_type" AS ENUM('rich_text', 'video_url', 'document');--> statement-breakpoint
CREATE TYPE "compliance"."training_question_type" AS ENUM('multiple_choice', 'true_false', 'short_answer');--> statement-breakpoint
CREATE TYPE "compliance"."webhook_event" AS ENUM('item.created', 'item.completed', 'item.overdue', 'notice.received', 'challan.recorded', 'item.status_changed');--> statement-breakpoint
ALTER TYPE "compliance"."notification_type" ADD VALUE 'instruction_mismatch';--> statement-breakpoint
ALTER TYPE "compliance"."user_role" ADD VALUE 'veridian_admin';--> statement-breakpoint
ALTER TYPE "compliance"."user_role" ADD VALUE 'branch_manager';--> statement-breakpoint
ALTER TYPE "compliance"."user_role" ADD VALUE 'senior_professional';--> statement-breakpoint
ALTER TYPE "compliance"."user_role" ADD VALUE 'team_member';--> statement-breakpoint
ALTER TYPE "compliance"."user_role" ADD VALUE 'client_viewer';--> statement-breakpoint
ALTER TYPE "compliance"."user_role" ADD VALUE 'external_auditor';--> statement-breakpoint
ALTER TYPE "compliance"."user_role" ADD VALUE 'stage_0';--> statement-breakpoint
CREATE TABLE "compliance"."abac_policies" (
	"id" text PRIMARY KEY NOT NULL,
	"org_id" text NOT NULL,
	"resource_type" text NOT NULL,
	"action" text NOT NULL,
	"effect" "compliance"."abac_policy_effect" DEFAULT 'deny' NOT NULL,
	"conditions" jsonb DEFAULT '[]'::jsonb NOT NULL,
	"description" text,
	"priority" integer DEFAULT 100 NOT NULL,
	"is_active" boolean DEFAULT true NOT NULL,
	"created_by_id" text,
	"created_at" timestamp DEFAULT now() NOT NULL,
	"updated_at" timestamp DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "compliance"."access_review_certifications" (
	"id" text PRIMARY KEY NOT NULL,
	"cycle_id" text NOT NULL,
	"org_id" text NOT NULL,
	"user_id" text NOT NULL,
	"reviewed_role" text NOT NULL,
	"decision" text DEFAULT 'pending' NOT NULL,
	"reviewed_by_id" text,
	"reviewed_at" timestamp,
	"created_at" timestamp DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "compliance"."access_review_cycles" (
	"id" text PRIMARY KEY NOT NULL,
	"org_id" text NOT NULL,
	"name" text NOT NULL,
	"due_date" date,
	"status" text DEFAULT 'open' NOT NULL,
	"created_by_id" text NOT NULL,
	"completed_at" timestamp,
	"created_at" timestamp DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "compliance"."activity_log" (
	"id" text PRIMARY KEY NOT NULL,
	"org_id" text NOT NULL,
	"client_id" text,
	"user_id" text,
	"activity_type" text NOT NULL,
	"detail_table" text,
	"detail_id" text,
	"lifecycle_stage" text DEFAULT 'requested' NOT NULL,
	"objective" text,
	"self_assessment" jsonb,
	"reviewed_by" text,
	"review_notes" text,
	"review_decision" text,
	"role_key" text,
	"duration_ms" integer,
	"error_reason" text,
	"risk_level" text,
	"confidence_percentage" numeric,
	"confidence_band" text,
	"complexity_tier" text,
	"re_audit_requested_at" timestamp,
	"re_audit_reason" text,
	"re_audit_requested_by" text,
	"executive_reviewed_at" timestamp,
	"executive_reviewed_by" text,
	"executive_review_notes" text,
	"created_at" timestamp DEFAULT now() NOT NULL,
	"updated_at" timestamp DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "compliance"."agent_review_records" (
	"id" text PRIMARY KEY NOT NULL,
	"role_key" text NOT NULL,
	"title" text,
	"team" text,
	"model" text,
	"period_start" timestamp NOT NULL,
	"period_end" timestamp NOT NULL,
	"dispatch_count" integer DEFAULT 0 NOT NULL,
	"terminal_count" integer DEFAULT 0 NOT NULL,
	"success_count" integer DEFAULT 0 NOT NULL,
	"failure_count" integer DEFAULT 0 NOT NULL,
	"success_rate" numeric,
	"reviewed_count" integer DEFAULT 0 NOT NULL,
	"audit_finding_count" integer DEFAULT 0 NOT NULL,
	"audit_finding_rate" numeric,
	"escalation_count" integer DEFAULT 0 NOT NULL,
	"escalation_rate" numeric,
	"complexity_tier_trust" jsonb,
	"verdict" text NOT NULL,
	"verdict_reason" text NOT NULL,
	"trust_tier_flag" text,
	"reviewed_at" timestamp DEFAULT now() NOT NULL,
	"created_at" timestamp DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "compliance"."ai_agent_directory" (
	"id" text PRIMARY KEY NOT NULL,
	"role_key" text NOT NULL,
	"title" text,
	"team" text,
	"latest_task_summary" text,
	"latest_prompt_version" integer,
	"total_dispatches" integer DEFAULT 0 NOT NULL,
	"success_count" integer DEFAULT 0 NOT NULL,
	"failure_count" integer DEFAULT 0 NOT NULL,
	"avg_duration_ms" numeric,
	"common_errors" jsonb DEFAULT '[]'::jsonb NOT NULL,
	"improvement_suggestions" text,
	"validation_rules" jsonb,
	"loop_engineering_status" text DEFAULT 'not_yet_assessed' NOT NULL,
	"last_computed_at" timestamp,
	"created_at" timestamp DEFAULT now() NOT NULL,
	"updated_at" timestamp DEFAULT now() NOT NULL,
	CONSTRAINT "ai_agent_directory_role_key_unique" UNIQUE("role_key")
);
--> statement-breakpoint
CREATE TABLE "compliance"."ai_assistants" (
	"id" text PRIMARY KEY NOT NULL,
	"user_id" text NOT NULL,
	"assistant_number" integer NOT NULL,
	"label" text NOT NULL,
	"status" text DEFAULT 'idle' NOT NULL,
	"personality_config" jsonb DEFAULT '{}'::jsonb NOT NULL,
	"created_at" timestamp DEFAULT now() NOT NULL,
	"updated_at" timestamp DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "compliance"."ai_configurations" (
	"id" text PRIMARY KEY NOT NULL,
	"org_id" text NOT NULL,
	"provider" "compliance"."ai_provider" NOT NULL,
	"encrypted_api_key" text,
	"is_default" boolean DEFAULT false NOT NULL,
	"use_for_extraction" boolean DEFAULT false NOT NULL,
	"use_for_qa" boolean DEFAULT false NOT NULL,
	"use_for_drafting" boolean DEFAULT false NOT NULL,
	"is_active" boolean DEFAULT true NOT NULL,
	"created_at" timestamp DEFAULT now() NOT NULL,
	"updated_at" timestamp DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "platform"."ai_model_registry" (
	"id" text PRIMARY KEY NOT NULL,
	"provider" text NOT NULL,
	"model" text NOT NULL,
	"tier" text NOT NULL,
	"status" "platform"."ai_model_status" DEFAULT 'active' NOT NULL,
	"cost_per_1k_input" numeric(10, 6),
	"cost_per_1k_output" numeric(10, 6),
	"health_status" "platform"."ai_model_health" DEFAULT 'healthy' NOT NULL,
	"notes" text,
	"role" text,
	"created_at" timestamp DEFAULT now() NOT NULL,
	"updated_at" timestamp DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "compliance"."ai_reduction_snapshots" (
	"id" text PRIMARY KEY NOT NULL,
	"snapshot_date" date NOT NULL,
	"full_software_count" integer NOT NULL,
	"package_available_count" integer NOT NULL,
	"novel_count" integer NOT NULL,
	"total_count" integer NOT NULL,
	"created_at" timestamp DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "platform"."ai_routing_audit_log" (
	"id" text PRIMARY KEY NOT NULL,
	"scope" "platform"."ai_router_scope" NOT NULL,
	"context" jsonb DEFAULT '{}'::jsonb NOT NULL,
	"resolved_provider" text NOT NULL,
	"resolved_model" text NOT NULL,
	"policy_version" integer,
	"reason" text,
	"created_at" timestamp DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "platform"."ai_routing_policies" (
	"id" text PRIMARY KEY NOT NULL,
	"scope" "platform"."ai_router_scope" NOT NULL,
	"version" integer NOT NULL,
	"is_active" boolean DEFAULT false NOT NULL,
	"rule" jsonb DEFAULT '{}'::jsonb NOT NULL,
	"created_at" timestamp DEFAULT now() NOT NULL,
	"created_by" text
);
--> statement-breakpoint
CREATE TABLE "platform"."ai_team_role_overrides" (
	"id" text PRIMARY KEY NOT NULL,
	"role_key" text NOT NULL,
	"model" text NOT NULL,
	"reason" text,
	"updated_by_user_id" text,
	"created_at" timestamp DEFAULT now() NOT NULL,
	"updated_at" timestamp DEFAULT now() NOT NULL,
	CONSTRAINT "ai_team_role_overrides_role_key_unique" UNIQUE("role_key")
);
--> statement-breakpoint
CREATE TABLE "compliance"."api_key_request_log" (
	"id" text PRIMARY KEY NOT NULL,
	"api_key_id" text NOT NULL,
	"org_id" text NOT NULL,
	"route" text NOT NULL,
	"method" text NOT NULL,
	"was_rate_limited" boolean DEFAULT false NOT NULL,
	"created_at" timestamp DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "compliance"."api_keys" (
	"id" text PRIMARY KEY NOT NULL,
	"name" text NOT NULL,
	"key_hash" text NOT NULL,
	"key_prefix" text NOT NULL,
	"org_id" text NOT NULL,
	"scopes" text DEFAULT 'read' NOT NULL,
	"is_active" boolean DEFAULT true NOT NULL,
	"last_used_at" timestamp,
	"domain_scope" text,
	"rate_limit_per_minute" integer,
	"issued_for_application_id" text,
	"created_at" timestamp DEFAULT now() NOT NULL,
	"updated_at" timestamp DEFAULT now() NOT NULL,
	CONSTRAINT "api_keys_key_hash_unique" UNIQUE("key_hash")
);
--> statement-breakpoint
CREATE TABLE "compliance"."application_errors" (
	"id" text PRIMARY KEY NOT NULL,
	"route" text,
	"message" text NOT NULL,
	"stack" text,
	"org_id" text,
	"user_id" text,
	"digest_id" text,
	"created_at" timestamp DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "compliance"."approval_preferences" (
	"id" text PRIMARY KEY NOT NULL,
	"org_id" text NOT NULL,
	"user_id" text NOT NULL,
	"scope_type" text NOT NULL,
	"scope_id" text,
	"action_category" text NOT NULL,
	"decision" text NOT NULL,
	"created_at" timestamp DEFAULT now() NOT NULL,
	"updated_at" timestamp DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "compliance"."approval_requests" (
	"id" text PRIMARY KEY NOT NULL,
	"request_type" text NOT NULL,
	"entity_type" text NOT NULL,
	"entity_id" text NOT NULL,
	"description" text,
	"status" "compliance"."approval_request_status" DEFAULT 'pending' NOT NULL,
	"requested_by_id" text NOT NULL,
	"approved_by_id" text,
	"rejection_reason" text,
	"org_id" text NOT NULL,
	"client_id" text,
	"created_at" timestamp DEFAULT now() NOT NULL,
	"resolved_at" timestamp,
	"dynamic_chain_id" text
);
--> statement-breakpoint
CREATE TABLE "compliance"."approval_workflow_definitions" (
	"id" text PRIMARY KEY NOT NULL,
	"org_id" text NOT NULL,
	"entity_type" text NOT NULL,
	"name" text NOT NULL,
	"is_active" boolean DEFAULT true NOT NULL,
	"created_by_id" text,
	"created_at" timestamp DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "compliance"."approval_workflow_instances" (
	"id" text PRIMARY KEY NOT NULL,
	"org_id" text NOT NULL,
	"workflow_definition_id" text NOT NULL,
	"entity_type" text NOT NULL,
	"entity_id" text NOT NULL,
	"status" "compliance"."approval_workflow_instance_status" DEFAULT 'pending' NOT NULL,
	"created_by_id" text,
	"created_at" timestamp DEFAULT now() NOT NULL,
	"completed_at" timestamp
);
--> statement-breakpoint
CREATE TABLE "compliance"."approval_workflow_step_approvals" (
	"id" text PRIMARY KEY NOT NULL,
	"step_instance_id" text NOT NULL,
	"approved_by_id" text NOT NULL,
	"decision" text NOT NULL,
	"comment" text,
	"created_at" timestamp DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "compliance"."approval_workflow_step_definitions" (
	"id" text PRIMARY KEY NOT NULL,
	"workflow_definition_id" text NOT NULL,
	"step_order" integer NOT NULL,
	"name" text NOT NULL,
	"approver_role" text NOT NULL,
	"required_approvals" integer DEFAULT 1 NOT NULL,
	"condition_field" text,
	"condition_operator" "compliance"."approval_workflow_condition_operator",
	"condition_value" numeric,
	"conditions" jsonb
);
--> statement-breakpoint
CREATE TABLE "compliance"."approval_workflow_step_instances" (
	"id" text PRIMARY KEY NOT NULL,
	"workflow_instance_id" text NOT NULL,
	"step_definition_id" text NOT NULL,
	"step_order" integer NOT NULL,
	"approver_role" text NOT NULL,
	"required_approvals" integer DEFAULT 1 NOT NULL,
	"approvals_received" integer DEFAULT 0 NOT NULL,
	"status" "compliance"."approval_workflow_step_status" DEFAULT 'pending' NOT NULL,
	"created_at" timestamp DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "compliance"."asset_registration_config" (
	"id" text PRIMARY KEY NOT NULL,
	"source_table" text NOT NULL,
	"asset_type" "compliance"."asset_type" NOT NULL,
	"name_column" text NOT NULL,
	"purpose_column" text,
	"module_column" text,
	"org_column" text,
	"owner_column" text,
	"active_column" text,
	"is_active" boolean DEFAULT true NOT NULL,
	"created_at" timestamp DEFAULT now() NOT NULL,
	"updated_at" timestamp DEFAULT now() NOT NULL,
	CONSTRAINT "asset_registration_config_source_table_unique" UNIQUE("source_table")
);
--> statement-breakpoint
CREATE TABLE "compliance"."assistant_memories" (
	"id" text PRIMARY KEY NOT NULL,
	"assistant_id" text NOT NULL,
	"category" text DEFAULT 'general' NOT NULL,
	"content" text NOT NULL,
	"metadata" jsonb DEFAULT '{}'::jsonb NOT NULL,
	"valid_from" timestamp DEFAULT now() NOT NULL,
	"valid_until" timestamp,
	"superseded_by_memory_id" text,
	"created_at" timestamp DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "compliance"."assistant_metrics_daily" (
	"id" text PRIMARY KEY NOT NULL,
	"assistant_id" text NOT NULL,
	"date" date NOT NULL,
	"tasks_assigned" integer DEFAULT 0 NOT NULL,
	"tasks_completed" integer DEFAULT 0 NOT NULL,
	"tasks_auto_submitted" integer DEFAULT 0 NOT NULL,
	"avg_completion_time_ms" integer,
	"human_interventions" integer DEFAULT 0 NOT NULL,
	"agents_called_count" integer DEFAULT 0 NOT NULL
);
--> statement-breakpoint
CREATE TABLE "compliance"."assistant_sessions" (
	"id" text PRIMARY KEY NOT NULL,
	"assistant_id" text NOT NULL,
	"started_at" timestamp DEFAULT now() NOT NULL,
	"ended_at" timestamp,
	"task_count" integer DEFAULT 0 NOT NULL
);
--> statement-breakpoint
CREATE TABLE "compliance"."audit_engagements" (
	"id" text PRIMARY KEY NOT NULL,
	"name" text NOT NULL,
	"audit_type" text DEFAULT 'internal' NOT NULL,
	"status" text DEFAULT 'planned' NOT NULL,
	"covers_risk_ids" jsonb DEFAULT '[]'::jsonb NOT NULL,
	"org_id" text NOT NULL,
	"client_id" text,
	"created_at" timestamp DEFAULT now() NOT NULL,
	"updated_at" timestamp DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "compliance"."audit_findings" (
	"id" text PRIMARY KEY NOT NULL,
	"audit_engagement_id" text NOT NULL,
	"title" text NOT NULL,
	"severity" text DEFAULT 'medium' NOT NULL,
	"capa_status" text DEFAULT 'open' NOT NULL,
	"linked_risk_id" text,
	"owner_id" text,
	"due_date" timestamp,
	"retest_result" text DEFAULT 'not_started',
	"org_id" text NOT NULL,
	"client_id" text,
	"created_at" timestamp DEFAULT now() NOT NULL,
	"updated_at" timestamp DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "compliance"."audit_protocol_findings" (
	"id" text PRIMARY KEY NOT NULL,
	"pr_number" integer,
	"pr_url" text,
	"branch_name" text,
	"objective_understood" text,
	"standards_reviewed" text,
	"scope_confirmed" text,
	"evidence_recorded" text,
	"severity_classified" text,
	"verdict" text,
	"corrective_action_owner" text,
	"re_audit_scheduled" text,
	"submitted_by" text,
	"submitted_at" timestamp DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "compliance"."auth_failure_events" (
	"id" text PRIMARY KEY NOT NULL,
	"email" text NOT NULL,
	"method" text NOT NULL,
	"ip_address" text,
	"created_at" timestamp DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "platform"."automation_rule_runs" (
	"id" text PRIMARY KEY NOT NULL,
	"rule_id" text NOT NULL,
	"triggered_at" timestamp DEFAULT now() NOT NULL,
	"trigger_payload" jsonb DEFAULT '{}'::jsonb NOT NULL,
	"status" text NOT NULL,
	"result_summary" text,
	"error_message" text
);
--> statement-breakpoint
CREATE TABLE "platform"."automation_rules" (
	"id" text PRIMARY KEY NOT NULL,
	"org_id" text NOT NULL,
	"name" text NOT NULL,
	"description" text,
	"trigger_type" text NOT NULL,
	"trigger_conditions" jsonb DEFAULT '{}'::jsonb NOT NULL,
	"action_type" text NOT NULL,
	"action_config" jsonb DEFAULT '{}'::jsonb NOT NULL,
	"is_active" boolean DEFAULT true NOT NULL,
	"created_by_id" text,
	"created_at" timestamp DEFAULT now() NOT NULL,
	"updated_at" timestamp DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "compliance"."bcm_business_impact_analyses" (
	"id" text PRIMARY KEY NOT NULL,
	"plan_id" text NOT NULL,
	"business_process_name" text NOT NULL,
	"impact_description" text,
	"rto_hours" numeric,
	"rpo_hours" numeric,
	"criticality_level" text DEFAULT 'medium' NOT NULL,
	"dependencies" text,
	"created_at" timestamp DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "compliance"."bcm_exercises" (
	"id" text PRIMARY KEY NOT NULL,
	"plan_id" text NOT NULL,
	"exercise_date" date NOT NULL,
	"exercise_type" text NOT NULL,
	"outcome" text NOT NULL,
	"findings" text,
	"conducted_by_id" text,
	"created_at" timestamp DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "compliance"."bcm_plans" (
	"id" text PRIMARY KEY NOT NULL,
	"plan_name" text NOT NULL,
	"last_tested_date" timestamp,
	"status" text DEFAULT 'not_tested' NOT NULL,
	"org_id" text NOT NULL,
	"client_id" text,
	"created_at" timestamp DEFAULT now() NOT NULL,
	"updated_at" timestamp DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "compliance"."bcm_recovery_procedures" (
	"id" text PRIMARY KEY NOT NULL,
	"plan_id" text NOT NULL,
	"step_number" integer NOT NULL,
	"description" text NOT NULL,
	"responsible_user_id" text,
	"estimated_duration_minutes" numeric,
	"created_at" timestamp DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "compliance"."board_action_items" (
	"id" text PRIMARY KEY NOT NULL,
	"board_meeting_id" text NOT NULL,
	"item" text NOT NULL,
	"owner_id" text,
	"due_date" timestamp,
	"status" text DEFAULT 'open' NOT NULL,
	"org_id" text NOT NULL,
	"client_id" text,
	"created_at" timestamp DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "compliance"."board_evaluations" (
	"id" text PRIMARY KEY NOT NULL,
	"cycle" text NOT NULL,
	"current_stage" text DEFAULT 'initiated' NOT NULL,
	"scope" jsonb DEFAULT '[]'::jsonb NOT NULL,
	"respondents" jsonb DEFAULT '[]'::jsonb NOT NULL,
	"action_items" jsonb DEFAULT '[]'::jsonb NOT NULL,
	"history" jsonb DEFAULT '[]'::jsonb NOT NULL,
	"org_id" text NOT NULL,
	"client_id" text,
	"created_at" timestamp DEFAULT now() NOT NULL,
	"updated_at" timestamp DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "compliance"."board_meetings" (
	"id" text PRIMARY KEY NOT NULL,
	"title" text NOT NULL,
	"meeting_type" "compliance"."board_meeting_type" DEFAULT 'board_meeting' NOT NULL,
	"meeting_date" timestamp NOT NULL,
	"status" "compliance"."board_meeting_status" DEFAULT 'scheduled' NOT NULL,
	"agenda" jsonb DEFAULT '[]'::jsonb NOT NULL,
	"attendees" jsonb DEFAULT '[]'::jsonb NOT NULL,
	"minutes" text,
	"minutes_history" jsonb DEFAULT '[]'::jsonb NOT NULL,
	"classification" text DEFAULT 'board_only' NOT NULL,
	"org_id" text NOT NULL,
	"client_id" text,
	"created_by_id" text NOT NULL,
	"created_at" timestamp DEFAULT now() NOT NULL,
	"updated_at" timestamp DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "compliance"."branches" (
	"id" text PRIMARY KEY NOT NULL,
	"org_id" text NOT NULL,
	"name" text NOT NULL,
	"is_active" boolean DEFAULT true NOT NULL,
	"created_at" timestamp DEFAULT now() NOT NULL,
	"updated_at" timestamp DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "compliance"."business_terminology_glossary" (
	"id" text PRIMARY KEY NOT NULL,
	"org_id" text,
	"term" text NOT NULL,
	"definition" text NOT NULL,
	"category" text,
	"aliases" jsonb DEFAULT '[]'::jsonb NOT NULL,
	"created_at" timestamp DEFAULT now() NOT NULL,
	"updated_at" timestamp DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "compliance"."calculation_invocations" (
	"id" text PRIMARY KEY NOT NULL,
	"engine_key" text NOT NULL,
	"engine_version" text NOT NULL,
	"org_id" text NOT NULL,
	"user_id" text,
	"task_id" text,
	"status" text NOT NULL,
	"input" jsonb DEFAULT '{}'::jsonb NOT NULL,
	"output" jsonb,
	"error_message" text,
	"created_at" timestamp DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "compliance"."candidates" (
	"id" text PRIMARY KEY NOT NULL,
	"org_id" text NOT NULL,
	"name" text NOT NULL,
	"email" text NOT NULL,
	"phone" text,
	"source" text,
	"created_at" timestamp DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "compliance"."cap_table_entries" (
	"id" text PRIMARY KEY NOT NULL,
	"holder_name" text NOT NULL,
	"shares" integer NOT NULL,
	"percent" numeric(5, 2),
	"share_class" text DEFAULT 'Equity',
	"org_id" text NOT NULL,
	"client_id" text,
	"created_at" timestamp DEFAULT now() NOT NULL,
	"updated_at" timestamp DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "compliance"."cap_table_events" (
	"id" text PRIMARY KEY NOT NULL,
	"event_type" text NOT NULL,
	"description" text,
	"shares" integer,
	"event_date" timestamp,
	"status" text DEFAULT 'registered',
	"org_id" text NOT NULL,
	"client_id" text,
	"recorded_by_id" text NOT NULL,
	"created_at" timestamp DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "platform"."capability_improvement_proposals" (
	"id" text PRIMARY KEY NOT NULL,
	"capability_id" text NOT NULL,
	"capability_version" integer NOT NULL,
	"findings" jsonb NOT NULL,
	"existing_asset_match" jsonb,
	"occurrence_count" integer DEFAULT 1 NOT NULL,
	"status" text DEFAULT 'open' NOT NULL,
	"dispatched_to_role" text,
	"dispatched_at" timestamp,
	"dispatch_output" text,
	"pr_url" text,
	"rejection_reason" text,
	"created_at" timestamp DEFAULT now() NOT NULL,
	"updated_at" timestamp DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "compliance"."challans" (
	"id" text PRIMARY KEY NOT NULL,
	"compliance_item_id" text NOT NULL,
	"bsr_code" text,
	"challan_serial_number" text,
	"payment_date" timestamp,
	"amount" numeric(14, 2),
	"bank_name" text,
	"description" text,
	"org_id" text NOT NULL,
	"client_id" text,
	"created_by_id" text NOT NULL,
	"created_at" timestamp DEFAULT now() NOT NULL,
	"updated_at" timestamp DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "compliance"."client_entities" (
	"id" text PRIMARY KEY NOT NULL,
	"client_id" text NOT NULL,
	"legal_name" text NOT NULL,
	"entity_type" text,
	"gstin" text,
	"pan" text,
	"cin" text,
	"is_active" boolean DEFAULT true NOT NULL,
	"created_at" timestamp DEFAULT now() NOT NULL,
	"updated_at" timestamp DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "compliance"."client_model_config" (
	"id" text PRIMARY KEY NOT NULL,
	"client_id" text NOT NULL,
	"orchestra_layer_id" text,
	"provider" "compliance"."ai_provider" NOT NULL,
	"encrypted_api_key" text,
	"model_name" text,
	"is_active" boolean DEFAULT true NOT NULL,
	"last_used_at" timestamp,
	"created_at" timestamp DEFAULT now() NOT NULL,
	"updated_at" timestamp DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "compliance"."clients" (
	"id" text PRIMARY KEY NOT NULL,
	"org_id" text NOT NULL,
	"branch_id" text,
	"name" text NOT NULL,
	"is_self" boolean DEFAULT false NOT NULL,
	"is_active" boolean DEFAULT true NOT NULL,
	"created_at" timestamp DEFAULT now() NOT NULL,
	"updated_at" timestamp DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "compliance"."clm_clauses" (
	"id" text PRIMARY KEY NOT NULL,
	"org_id" text NOT NULL,
	"title" text NOT NULL,
	"category" text,
	"body_text" text NOT NULL,
	"risk_level" text,
	"is_standard" boolean DEFAULT true NOT NULL,
	"version" integer DEFAULT 1 NOT NULL,
	"created_by_id" text,
	"created_at" timestamp DEFAULT now() NOT NULL,
	"updated_at" timestamp DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "compliance"."clm_contract_templates" (
	"id" text PRIMARY KEY NOT NULL,
	"org_id" text NOT NULL,
	"name" text NOT NULL,
	"contract_type" text,
	"description" text,
	"is_active" boolean DEFAULT true NOT NULL,
	"created_by_id" text,
	"created_at" timestamp DEFAULT now() NOT NULL,
	"updated_at" timestamp DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "compliance"."clm_template_clauses" (
	"id" text PRIMARY KEY NOT NULL,
	"template_id" text NOT NULL,
	"clause_id" text NOT NULL,
	"position" integer NOT NULL,
	"is_optional" boolean DEFAULT false NOT NULL
);
--> statement-breakpoint
CREATE TABLE "compliance"."code_change_requests" (
	"id" text PRIMARY KEY NOT NULL,
	"approval_request_id" text NOT NULL,
	"originating_layer" text NOT NULL,
	"requested_change" text NOT NULL,
	"justification" text,
	"status" text DEFAULT 'pending' NOT NULL,
	"implemented_at" timestamp,
	"implementation_note" text,
	"org_id" text NOT NULL,
	"created_at" timestamp DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "compliance"."committees" (
	"id" text PRIMARY KEY NOT NULL,
	"name" text NOT NULL,
	"charter" text,
	"chair_id" text,
	"cadence" text,
	"last_met_date" timestamp,
	"org_id" text NOT NULL,
	"client_id" text,
	"created_at" timestamp DEFAULT now() NOT NULL,
	"updated_at" timestamp DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "compliance"."company_charges" (
	"id" text PRIMARY KEY NOT NULL,
	"charge_holder" text NOT NULL,
	"charge_type" text,
	"amount" numeric(14, 2),
	"filing_reference" text,
	"status" text DEFAULT 'open' NOT NULL,
	"org_id" text NOT NULL,
	"client_id" text,
	"created_at" timestamp DEFAULT now() NOT NULL,
	"updated_at" timestamp DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "compliance"."compliance_costs" (
	"id" text PRIMARY KEY NOT NULL,
	"compliance_item_id" text,
	"notice_id" text,
	"cost_type" "compliance"."cost_type" NOT NULL,
	"description" text,
	"amount" numeric(14, 2) NOT NULL,
	"amount_paid" numeric(14, 2) DEFAULT '0' NOT NULL,
	"payment_status" "compliance"."payment_status" DEFAULT 'pending' NOT NULL,
	"paid_to" text,
	"due_date" timestamp,
	"receipt_document_id" text,
	"org_id" text NOT NULL,
	"client_id" text,
	"recorded_by_id" text NOT NULL,
	"created_at" timestamp DEFAULT now() NOT NULL,
	"updated_at" timestamp DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "compliance"."compliance_frameworks" (
	"id" text PRIMARY KEY NOT NULL,
	"framework_key" text NOT NULL,
	"name" text NOT NULL,
	"relevance_note" text,
	"org_id" text NOT NULL,
	"client_id" text,
	"created_at" timestamp DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "compliance"."computation_engines" (
	"id" text PRIMARY KEY NOT NULL,
	"engine_key" text NOT NULL,
	"name" text NOT NULL,
	"category" text NOT NULL,
	"description" text,
	"status" text DEFAULT 'not_started' NOT NULL,
	"implementation_ref" text,
	"open_source_ref" text,
	"input_schema" jsonb DEFAULT '{}'::jsonb NOT NULL,
	"output_schema" jsonb DEFAULT '{}'::jsonb NOT NULL,
	"notes" text,
	"engine_version" text DEFAULT '1.0.0' NOT NULL,
	"effective_from" timestamp DEFAULT now() NOT NULL,
	"effective_to" timestamp,
	"created_at" timestamp DEFAULT now() NOT NULL,
	"updated_at" timestamp DEFAULT now() NOT NULL,
	CONSTRAINT "computation_engines_engine_key_unique" UNIQUE("engine_key")
);
--> statement-breakpoint
CREATE TABLE "compliance"."connector_accounts" (
	"id" text PRIMARY KEY NOT NULL,
	"org_id" text NOT NULL,
	"user_id" text NOT NULL,
	"toolkit_slug" text NOT NULL,
	"composio_connected_account_id" text NOT NULL,
	"status" text DEFAULT 'INITIALIZING' NOT NULL,
	"connected_email" text,
	"created_at" timestamp DEFAULT now() NOT NULL,
	"updated_at" timestamp DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "compliance"."connector_documents" (
	"id" text PRIMARY KEY NOT NULL,
	"org_id" text NOT NULL,
	"user_id" text NOT NULL,
	"toolkit_slug" text NOT NULL,
	"business_object_type" text NOT NULL,
	"external_id" text NOT NULL,
	"title" text,
	"source_url" text,
	"owner_id" text,
	"last_modified_at" timestamp,
	"metadata" jsonb,
	"created_at" timestamp DEFAULT now() NOT NULL,
	"updated_at" timestamp DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "compliance"."construction_activities" (
	"id" text PRIMARY KEY NOT NULL,
	"org_id" text NOT NULL,
	"project_id" text NOT NULL,
	"category_id" text NOT NULL,
	"name" text NOT NULL,
	"unit" text,
	"planned_quantity" numeric,
	"created_at" timestamp DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "compliance"."construction_attendance" (
	"id" text PRIMARY KEY NOT NULL,
	"org_id" text NOT NULL,
	"project_id" text NOT NULL,
	"roster_id" text NOT NULL,
	"attendance_date" date NOT NULL,
	"status" "compliance"."construction_attendance_status" DEFAULT 'present' NOT NULL,
	"hours_worked" numeric,
	"daily_cost" numeric DEFAULT '0' NOT NULL,
	"created_at" timestamp DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "compliance"."construction_boq_line_items" (
	"id" text PRIMARY KEY NOT NULL,
	"boq_id" text NOT NULL,
	"activity_id" text,
	"item_code" text,
	"description" text NOT NULL,
	"unit" text NOT NULL,
	"quantity" numeric DEFAULT '0' NOT NULL,
	"rate" numeric DEFAULT '0' NOT NULL,
	"amount" numeric DEFAULT '0' NOT NULL,
	"material_cost" numeric,
	"labour_cost" numeric,
	"equipment_cost" numeric,
	"overhead_percent" numeric,
	"profit_percent" numeric,
	"created_at" timestamp DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "compliance"."construction_boqs" (
	"id" text PRIMARY KEY NOT NULL,
	"org_id" text NOT NULL,
	"project_id" text NOT NULL,
	"version" integer DEFAULT 1 NOT NULL,
	"parent_boq_id" text,
	"title" text NOT NULL,
	"status" "compliance"."construction_boq_status" DEFAULT 'draft' NOT NULL,
	"created_by_id" text NOT NULL,
	"approved_by_id" text,
	"approved_at" timestamp,
	"created_at" timestamp DEFAULT now() NOT NULL,
	"updated_at" timestamp DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "compliance"."construction_categories" (
	"id" text PRIMARY KEY NOT NULL,
	"org_id" text NOT NULL,
	"project_id" text NOT NULL,
	"name" text NOT NULL,
	"parent_category_id" text,
	"created_at" timestamp DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "compliance"."construction_change_orders" (
	"id" text PRIMARY KEY NOT NULL,
	"org_id" text NOT NULL,
	"project_id" text NOT NULL,
	"number" integer NOT NULL,
	"title" text NOT NULL,
	"description" text,
	"reason" text,
	"cost_impact" numeric DEFAULT '0' NOT NULL,
	"schedule_impact_days" integer DEFAULT 0 NOT NULL,
	"status" "compliance"."construction_change_order_status" DEFAULT 'draft' NOT NULL,
	"requested_by_id" text NOT NULL,
	"approved_by_id" text,
	"approved_at" timestamp,
	"esignature_request_id" text,
	"created_at" timestamp DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "compliance"."construction_expense_entries" (
	"id" text PRIMARY KEY NOT NULL,
	"org_id" text NOT NULL,
	"project_id" text NOT NULL,
	"expense_head" "compliance"."construction_expense_head" NOT NULL,
	"description" text,
	"amount" numeric NOT NULL,
	"expense_date" date NOT NULL,
	"linked_entity_type" text,
	"linked_entity_id" text,
	"recorded_by_id" text NOT NULL,
	"created_at" timestamp DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "compliance"."construction_kpi_definitions" (
	"id" text PRIMARY KEY NOT NULL,
	"org_id" text NOT NULL,
	"project_id" text,
	"metric_name" text NOT NULL,
	"target_value" numeric,
	"unit" text,
	"period" "compliance"."construction_kpi_period" DEFAULT 'monthly' NOT NULL,
	"owner_id" text,
	"created_at" timestamp DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "compliance"."construction_kpi_entries" (
	"id" text PRIMARY KEY NOT NULL,
	"kpi_definition_id" text NOT NULL,
	"period" text NOT NULL,
	"actual_value" numeric NOT NULL,
	"filled_by_id" text NOT NULL,
	"approval_status" "compliance"."construction_kpi_approval_status" DEFAULT 'draft' NOT NULL,
	"approved_by_id" text,
	"approved_at" timestamp,
	"created_at" timestamp DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "compliance"."construction_labour_roster" (
	"id" text PRIMARY KEY NOT NULL,
	"org_id" text NOT NULL,
	"project_id" text NOT NULL,
	"name" text NOT NULL,
	"trade" text,
	"skill_level" text,
	"vendor_id" text,
	"daily_rate" numeric DEFAULT '0' NOT NULL,
	"is_active" boolean DEFAULT true NOT NULL,
	"created_at" timestamp DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "compliance"."construction_punch_list_items" (
	"id" text PRIMARY KEY NOT NULL,
	"org_id" text NOT NULL,
	"project_id" text NOT NULL,
	"number" integer NOT NULL,
	"description" text NOT NULL,
	"location" text,
	"trade" text,
	"priority" "compliance"."construction_punch_priority" DEFAULT 'medium' NOT NULL,
	"status" "compliance"."construction_punch_status" DEFAULT 'open' NOT NULL,
	"assigned_to_id" text,
	"due_date" date,
	"verified_by_id" text,
	"verified_at" timestamp,
	"created_by_id" text NOT NULL,
	"created_at" timestamp DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "compliance"."construction_rfis" (
	"id" text PRIMARY KEY NOT NULL,
	"org_id" text NOT NULL,
	"project_id" text NOT NULL,
	"number" integer NOT NULL,
	"subject" text NOT NULL,
	"question" text NOT NULL,
	"status" "compliance"."construction_rfi_status" DEFAULT 'open' NOT NULL,
	"ball_in_court" "compliance"."construction_ball_in_court" DEFAULT 'architect' NOT NULL,
	"raised_by_id" text NOT NULL,
	"assigned_to_id" text,
	"due_date" date,
	"answer" text,
	"answered_by_id" text,
	"answered_at" timestamp,
	"created_at" timestamp DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "compliance"."construction_site_diaries" (
	"id" text PRIMARY KEY NOT NULL,
	"org_id" text NOT NULL,
	"project_id" text NOT NULL,
	"diary_date" date NOT NULL,
	"weather" text,
	"work_done" text,
	"visitors" text,
	"issues" text,
	"instructions" text,
	"material_received" text,
	"labour_count" integer,
	"remarks" text,
	"recorded_by_id" text NOT NULL,
	"created_at" timestamp DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "compliance"."construction_submittals" (
	"id" text PRIMARY KEY NOT NULL,
	"org_id" text NOT NULL,
	"project_id" text NOT NULL,
	"number" integer NOT NULL,
	"title" text NOT NULL,
	"spec_section" text,
	"type" "compliance"."construction_submittal_type" DEFAULT 'shop_drawing' NOT NULL,
	"status" "compliance"."construction_submittal_status" DEFAULT 'pending' NOT NULL,
	"submitted_by_id" text NOT NULL,
	"due_date" date,
	"reviewed_by_id" text,
	"reviewed_at" timestamp,
	"review_comments" text,
	"created_at" timestamp DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "compliance"."construction_work_progress_entries" (
	"id" text PRIMARY KEY NOT NULL,
	"org_id" text NOT NULL,
	"project_id" text NOT NULL,
	"activity_id" text NOT NULL,
	"entry_date" date NOT NULL,
	"quantity_done" numeric DEFAULT '0' NOT NULL,
	"percent_complete" integer DEFAULT 0 NOT NULL,
	"remarks" text,
	"recorded_by_id" text NOT NULL,
	"created_at" timestamp DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "compliance"."contact_submissions" (
	"id" text PRIMARY KEY NOT NULL,
	"visitor_id" text NOT NULL,
	"category" text,
	"name" text,
	"email" text,
	"mobile" text,
	"message" text,
	"status" text DEFAULT 'draft' NOT NULL,
	"confirm_token" text,
	"email_confirmed_at" timestamp,
	"submitted_at" timestamp,
	"created_at" timestamp DEFAULT now() NOT NULL,
	"updated_at" timestamp DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "compliance"."contract_compliance_items" (
	"id" text PRIMARY KEY NOT NULL,
	"vendor_name" text NOT NULL,
	"clause_description" text,
	"renewal_date" timestamp,
	"org_id" text NOT NULL,
	"client_id" text,
	"created_at" timestamp DEFAULT now() NOT NULL,
	"updated_at" timestamp DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "compliance"."conversation_guest_access" (
	"id" text PRIMARY KEY NOT NULL,
	"conversation_id" text NOT NULL,
	"token" text NOT NULL,
	"guest_name" text NOT NULL,
	"guest_email" text,
	"invited_by_id" text NOT NULL,
	"expires_at" timestamp NOT NULL,
	"revoked_at" timestamp,
	"stage0_signup_count" integer DEFAULT 0 NOT NULL,
	"created_at" timestamp DEFAULT now() NOT NULL,
	CONSTRAINT "conversation_guest_access_token_unique" UNIQUE("token")
);
--> statement-breakpoint
CREATE TABLE "compliance"."conversation_participants" (
	"id" text PRIMARY KEY NOT NULL,
	"conversation_id" text NOT NULL,
	"user_id" text NOT NULL,
	"last_read_at" timestamp,
	"created_at" timestamp DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "compliance"."conversation_share_links" (
	"id" text PRIMARY KEY NOT NULL,
	"conversation_id" text NOT NULL,
	"token" text NOT NULL,
	"created_by_id" text NOT NULL,
	"expires_at" timestamp NOT NULL,
	"revoked_at" timestamp,
	"stage0_signup_count" integer DEFAULT 0 NOT NULL,
	"created_at" timestamp DEFAULT now() NOT NULL,
	CONSTRAINT "conversation_share_links_token_unique" UNIQUE("token")
);
--> statement-breakpoint
CREATE TABLE "compliance"."conversations" (
	"id" text PRIMARY KEY NOT NULL,
	"org_id" text NOT NULL,
	"client_id" text,
	"type" text DEFAULT 'direct' NOT NULL,
	"is_ai_thread" boolean DEFAULT false NOT NULL,
	"title" text,
	"context_entity_type" text,
	"context_entity_id" text,
	"dynamic_chain_id" text,
	"current_state" text,
	"previous_state" text,
	"workflow_id" text,
	"status" text DEFAULT 'active' NOT NULL,
	"veri_participant" boolean DEFAULT false NOT NULL,
	"chain_selector_skipped" boolean DEFAULT false NOT NULL,
	"clarification_round_trips" integer DEFAULT 0 NOT NULL,
	"created_at" timestamp DEFAULT now() NOT NULL,
	"updated_at" timestamp DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "compliance"."cost_payments" (
	"id" text PRIMARY KEY NOT NULL,
	"compliance_cost_id" text NOT NULL,
	"amount" numeric(14, 2) NOT NULL,
	"payment_date" timestamp NOT NULL,
	"payment_method" text,
	"reference_number" text,
	"receipt_document_id" text,
	"org_id" text NOT NULL,
	"client_id" text,
	"recorded_by_id" text NOT NULL,
	"created_at" timestamp DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "compliance"."crm_accounts" (
	"id" text PRIMARY KEY NOT NULL,
	"org_id" text NOT NULL,
	"name" text NOT NULL,
	"industry" text,
	"website" text,
	"billing_line1" text,
	"billing_line2" text,
	"billing_city" text,
	"billing_state" text,
	"billing_postal_code" text,
	"billing_country" text,
	"shipping_same_as_billing" boolean DEFAULT true NOT NULL,
	"shipping_line1" text,
	"shipping_line2" text,
	"shipping_city" text,
	"shipping_state" text,
	"shipping_postal_code" text,
	"shipping_country" text,
	"owner_id" text,
	"parent_account_id" text,
	"lifecycle_stage" "compliance"."crm_account_lifecycle_stage" DEFAULT 'prospect' NOT NULL,
	"company_id" text,
	"converted_from_lead_id" text,
	"created_by_id" text NOT NULL,
	"created_at" timestamp DEFAULT now() NOT NULL,
	"updated_at" timestamp DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "compliance"."crm_contacts" (
	"id" text PRIMARY KEY NOT NULL,
	"org_id" text NOT NULL,
	"account_id" text NOT NULL,
	"name" text NOT NULL,
	"title" text,
	"email" text,
	"phone" text,
	"is_primary" boolean DEFAULT false NOT NULL,
	"created_by_id" text NOT NULL,
	"created_at" timestamp DEFAULT now() NOT NULL,
	"updated_at" timestamp DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "compliance"."crm_leads" (
	"id" text PRIMARY KEY NOT NULL,
	"org_id" text NOT NULL,
	"name" text NOT NULL,
	"contact_email" text,
	"contact_phone" text,
	"source" text,
	"status" text DEFAULT 'new' NOT NULL,
	"owner_id" text,
	"company_id" text,
	"account_id" text,
	"converted_client_id" text,
	"next_action_date" date,
	"next_action_note" text,
	"ai_score" integer,
	"ai_score_reasoning" text,
	"ai_recommended_action" text,
	"ai_scored_at" timestamp,
	"ai_rejected_alternatives" jsonb DEFAULT '[]'::jsonb NOT NULL,
	"ai_assumptions" jsonb DEFAULT '[]'::jsonb NOT NULL,
	"ai_confidence" text,
	"created_by_id" text NOT NULL,
	"created_at" timestamp DEFAULT now() NOT NULL,
	"updated_at" timestamp DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "compliance"."crm_opportunities" (
	"id" text PRIMARY KEY NOT NULL,
	"org_id" text NOT NULL,
	"lead_id" text,
	"client_id" text,
	"name" text NOT NULL,
	"stage" text DEFAULT 'prospecting' NOT NULL,
	"estimated_value" numeric,
	"expected_close_date" date,
	"owner_id" text,
	"ai_win_probability" integer,
	"ai_risk_factors" jsonb DEFAULT '[]'::jsonb NOT NULL,
	"ai_recommended_action" text,
	"ai_analyzed_at" timestamp,
	"ai_rejected_alternatives" jsonb DEFAULT '[]'::jsonb NOT NULL,
	"ai_assumptions" jsonb DEFAULT '[]'::jsonb NOT NULL,
	"ai_confidence" text,
	"next_action_date" date,
	"next_action_note" text,
	"erp_customer_id" text,
	"account_id" text,
	"created_by_id" text NOT NULL,
	"created_at" timestamp DEFAULT now() NOT NULL,
	"updated_at" timestamp DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "compliance"."crm_stage_history" (
	"id" text PRIMARY KEY NOT NULL,
	"org_id" text NOT NULL,
	"entity_type" text NOT NULL,
	"entity_id" text NOT NULL,
	"from_stage" text,
	"to_stage" text NOT NULL,
	"note" text,
	"changed_by_id" text,
	"changed_at" timestamp DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "compliance"."custom_charts" (
	"id" text PRIMARY KEY NOT NULL,
	"org_id" text NOT NULL,
	"name" text NOT NULL,
	"chart_type" text DEFAULT 'bar' NOT NULL,
	"aggregation_config" jsonb NOT NULL,
	"created_by_id" text NOT NULL,
	"created_at" timestamp DEFAULT now() NOT NULL,
	"updated_at" timestamp DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "compliance"."customer_model_config" (
	"id" text PRIMARY KEY NOT NULL,
	"org_id" text NOT NULL,
	"orchestra_layer_id" text,
	"provider" "compliance"."ai_provider" NOT NULL,
	"encrypted_api_key" text,
	"model_name" text,
	"is_active" boolean DEFAULT true NOT NULL,
	"shared_pool_eligible" boolean DEFAULT false NOT NULL,
	"last_used_at" timestamp,
	"created_at" timestamp DEFAULT now() NOT NULL,
	"updated_at" timestamp DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "compliance"."data_separation_audit" (
	"id" text PRIMARY KEY NOT NULL,
	"audit_type" text NOT NULL,
	"org_id" text,
	"user_id" text,
	"query_text" text,
	"vector_spaces_accessed" text[],
	"cross_contamination_detected" boolean DEFAULT false NOT NULL,
	"details" jsonb DEFAULT '{}'::jsonb NOT NULL,
	"created_at" timestamp DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "compliance"."delegation_of_authority" (
	"id" text PRIMARY KEY NOT NULL,
	"activity" text NOT NULL,
	"threshold_description" text,
	"approver_role" text,
	"org_id" text NOT NULL,
	"client_id" text,
	"created_at" timestamp DEFAULT now() NOT NULL,
	"updated_at" timestamp DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "compliance"."deployment_events" (
	"id" text PRIMARY KEY NOT NULL,
	"vercel_deployment_id" text NOT NULL,
	"event_type" text NOT NULL,
	"project_id" text,
	"project_name" text,
	"target" text,
	"deployment_url" text,
	"state" text,
	"signature_verified" boolean DEFAULT true NOT NULL,
	"received_at" timestamp DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "compliance"."directors_kmp" (
	"id" text PRIMARY KEY NOT NULL,
	"name" text NOT NULL,
	"din" text,
	"designation" text,
	"is_independent" boolean DEFAULT false NOT NULL,
	"kyc_status" text DEFAULT 'valid',
	"kyc_valid_till" timestamp,
	"appointed_date" timestamp,
	"org_id" text NOT NULL,
	"client_id" text,
	"created_at" timestamp DEFAULT now() NOT NULL,
	"updated_at" timestamp DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "compliance"."doc_processing_jobs" (
	"id" text PRIMARY KEY NOT NULL,
	"org_id" text NOT NULL,
	"user_id" text,
	"operation" text NOT NULL,
	"status" text DEFAULT 'pending' NOT NULL,
	"input_ref" text NOT NULL,
	"result" jsonb,
	"error" text,
	"created_at" timestamp DEFAULT now() NOT NULL,
	"completed_at" timestamp
);
--> statement-breakpoint
CREATE TABLE "compliance"."document_correspondents" (
	"id" text PRIMARY KEY NOT NULL,
	"org_id" text NOT NULL,
	"name" text NOT NULL,
	"created_at" timestamp DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "compliance"."document_matching_rules" (
	"id" text PRIMARY KEY NOT NULL,
	"org_id" text NOT NULL,
	"name" text NOT NULL,
	"is_active" boolean DEFAULT true NOT NULL,
	"match_field" "compliance"."document_matching_rule_field" DEFAULT 'both' NOT NULL,
	"rule_type" "compliance"."document_matching_rule_type" NOT NULL,
	"pattern" text NOT NULL,
	"priority" integer DEFAULT 100 NOT NULL,
	"target_correspondent_id" text,
	"target_category" text,
	"target_tags" jsonb,
	"created_at" timestamp DEFAULT now() NOT NULL,
	"updated_at" timestamp DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "compliance"."drafted_communications" (
	"id" text PRIMARY KEY NOT NULL,
	"org_id" text NOT NULL,
	"user_id" text NOT NULL,
	"communication_type" text NOT NULL,
	"trigger_type" text NOT NULL,
	"trigger_ref_type" text,
	"trigger_ref_id" text,
	"recipient_emails" jsonb DEFAULT '[]'::jsonb NOT NULL,
	"subject" text NOT NULL,
	"body" text NOT NULL,
	"attachments_recommendation" jsonb DEFAULT '[]'::jsonb NOT NULL,
	"status" text DEFAULT 'pending_approval' NOT NULL,
	"auto_approved_via_preference" boolean DEFAULT false NOT NULL,
	"approved_by_id" text,
	"approved_at" timestamp,
	"rejected_by_id" text,
	"rejected_at" timestamp,
	"rejection_reason" text,
	"sent_at" timestamp,
	"created_at" timestamp DEFAULT now() NOT NULL,
	"updated_at" timestamp DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "platform"."dynamic_chains" (
	"id" text PRIMARY KEY NOT NULL,
	"org_id" text NOT NULL,
	"mode_pill" text NOT NULL,
	"path_keys" jsonb DEFAULT '[]'::jsonb NOT NULL,
	"path_labels" jsonb DEFAULT '[]'::jsonb NOT NULL,
	"module_ref" text,
	"description" text,
	"created_by_id" text,
	"status" text DEFAULT 'approved' NOT NULL,
	"monitoring_rules" jsonb,
	"created_at" timestamp DEFAULT now() NOT NULL,
	"updated_at" timestamp DEFAULT now() NOT NULL,
	"linked_module_refs" jsonb DEFAULT '[]'::jsonb NOT NULL,
	"business_rules" jsonb,
	"permissions" jsonb,
	"workflow_ref" text,
	"ai_behavior_ref" text,
	"reports_kpis_slas" jsonb,
	"version" integer DEFAULT 1 NOT NULL,
	"previous_version_id" text,
	"linked_approval_workflow_ids" jsonb DEFAULT '[]'::jsonb NOT NULL,
	"governance_notes" text,
	"deprecation_reason" text,
	"classification" jsonb,
	"owner_department_id" text,
	"input_contract" jsonb,
	"output_contract" jsonb,
	"ai_config" jsonb,
	"workflow_steps_config" jsonb,
	"linked_knowledge_base_page_ids" jsonb DEFAULT '[]'::jsonb NOT NULL
);
--> statement-breakpoint
CREATE TABLE "compliance"."email_intelligence_action_items" (
	"id" text PRIMARY KEY NOT NULL,
	"email_intelligence_item_id" text NOT NULL,
	"suggested_index" integer NOT NULL,
	"task_id" text NOT NULL,
	"created_at" timestamp DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "compliance"."email_intelligence_items" (
	"id" text PRIMARY KEY NOT NULL,
	"org_id" text NOT NULL,
	"submitted_by_id" text NOT NULL,
	"subject" text NOT NULL,
	"sender_email" text,
	"body" text NOT NULL,
	"received_at" timestamp,
	"status" text DEFAULT 'analyzing' NOT NULL,
	"ai_summary" text,
	"ai_suggested_work_items" jsonb DEFAULT '[]'::jsonb NOT NULL,
	"ai_generated_at" timestamp,
	"created_at" timestamp DEFAULT now() NOT NULL,
	"updated_at" timestamp DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "compliance"."embedding_cache" (
	"id" text PRIMARY KEY NOT NULL,
	"content_hash" text NOT NULL,
	"content" text NOT NULL,
	"created_at" timestamp DEFAULT now() NOT NULL,
	"last_used_at" timestamp DEFAULT now() NOT NULL,
	CONSTRAINT "embedding_cache_content_hash_unique" UNIQUE("content_hash")
);
--> statement-breakpoint
CREATE TABLE "compliance"."embeddings" (
	"id" text PRIMARY KEY NOT NULL,
	"entity_type" text NOT NULL,
	"entity_id" text NOT NULL,
	"content_hash" text NOT NULL,
	"content" text,
	"org_id" text,
	"created_at" timestamp DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "compliance"."employee_profiles" (
	"id" text PRIMARY KEY NOT NULL,
	"user_id" text NOT NULL,
	"org_id" text NOT NULL,
	"company_id" text,
	"employee_code" text,
	"job_title" text,
	"employment_type" text DEFAULT 'full_time' NOT NULL,
	"date_of_joining" date,
	"date_of_birth" date,
	"income_tax_slab_id" text,
	"employment_status" "compliance"."employment_status" DEFAULT 'active' NOT NULL,
	"emergency_contact_name" text,
	"emergency_contact_phone" text,
	"created_at" timestamp DEFAULT now() NOT NULL,
	"updated_at" timestamp DEFAULT now() NOT NULL,
	CONSTRAINT "employee_profiles_user_id_unique" UNIQUE("user_id")
);
--> statement-breakpoint
CREATE TABLE "platform"."entity_relationships" (
	"id" text PRIMARY KEY NOT NULL,
	"org_id" text NOT NULL,
	"source_type" text NOT NULL,
	"source_id" text NOT NULL,
	"target_type" text NOT NULL,
	"target_id" text NOT NULL,
	"relationship_type" text NOT NULL,
	"metadata" jsonb,
	"created_at" timestamp DEFAULT now() NOT NULL,
	"updated_at" timestamp DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "compliance"."erp_abc_classifications" (
	"id" text PRIMARY KEY NOT NULL,
	"org_id" text NOT NULL,
	"item_id" text NOT NULL,
	"classification" text NOT NULL,
	"consumption_value" numeric NOT NULL,
	"computed_at" timestamp DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "compliance"."erp_accounting_periods" (
	"id" text PRIMARY KEY NOT NULL,
	"org_id" text NOT NULL,
	"fiscal_year_id" text NOT NULL,
	"period_name" text NOT NULL,
	"start_date" date NOT NULL,
	"end_date" date NOT NULL,
	"status" "compliance"."erp_period_status" DEFAULT 'open' NOT NULL,
	"closed_by_id" text,
	"closed_at" timestamp,
	"created_at" timestamp DEFAULT now() NOT NULL,
	"signed_off_by_id" text,
	"signed_off_at" timestamp
);
--> statement-breakpoint
CREATE TABLE "compliance"."erp_accounts" (
	"id" text PRIMARY KEY NOT NULL,
	"org_id" text NOT NULL,
	"account_name" text NOT NULL,
	"account_number" text,
	"parent_account_id" text,
	"root_type" "compliance"."erp_account_root_type" NOT NULL,
	"account_type" text,
	"is_group" boolean DEFAULT false NOT NULL,
	"currency_id" text,
	"is_frozen" boolean DEFAULT false NOT NULL,
	"created_at" timestamp DEFAULT now() NOT NULL,
	"updated_at" timestamp DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "compliance"."erp_addresses" (
	"id" text PRIMARY KEY NOT NULL,
	"org_id" text NOT NULL,
	"linked_entity_type" text NOT NULL,
	"linked_entity_id" text NOT NULL,
	"address_type" text DEFAULT 'billing' NOT NULL,
	"line1" text NOT NULL,
	"line2" text,
	"city" text,
	"state" text,
	"postal_code" text,
	"country" text,
	"is_primary" boolean DEFAULT false NOT NULL,
	"created_at" timestamp DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "compliance"."erp_asset_categories" (
	"id" text PRIMARY KEY NOT NULL,
	"org_id" text NOT NULL,
	"category_name" text NOT NULL,
	"default_depreciation_method" "compliance"."erp_depreciation_method" DEFAULT 'straight_line' NOT NULL,
	"default_useful_life_months" integer,
	"asset_account_id" text,
	"depreciation_expense_account_id" text,
	"accumulated_depreciation_account_id" text,
	"created_at" timestamp DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "compliance"."erp_asset_disposals" (
	"id" text PRIMARY KEY NOT NULL,
	"asset_id" text NOT NULL,
	"disposal_date" date NOT NULL,
	"disposal_type" text NOT NULL,
	"sale_value" numeric,
	"journal_entry_id" text,
	"created_by_id" text,
	"created_at" timestamp DEFAULT now() NOT NULL,
	"status" text DEFAULT 'pending' NOT NULL
);
--> statement-breakpoint
CREATE TABLE "compliance"."erp_asset_movements" (
	"id" text PRIMARY KEY NOT NULL,
	"asset_id" text NOT NULL,
	"movement_date" date NOT NULL,
	"from_location" text,
	"to_location" text,
	"from_custodian_id" text,
	"to_custodian_id" text,
	"purpose" text,
	"created_by_id" text,
	"created_at" timestamp DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "compliance"."erp_bank_accounts" (
	"id" text PRIMARY KEY NOT NULL,
	"org_id" text NOT NULL,
	"account_name" text NOT NULL,
	"bank_name" text,
	"account_number" text,
	"ifsc_or_swift" text,
	"currency_id" text,
	"gl_account_id" text,
	"is_default" boolean DEFAULT false NOT NULL,
	"created_at" timestamp DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "compliance"."erp_bank_statement_imports" (
	"id" text PRIMARY KEY NOT NULL,
	"org_id" text NOT NULL,
	"bank_account_id" text NOT NULL,
	"file_name" text NOT NULL,
	"total_lines" integer DEFAULT 0 NOT NULL,
	"imported_by_id" text,
	"imported_at" timestamp DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "compliance"."erp_bank_statement_lines" (
	"id" text PRIMARY KEY NOT NULL,
	"org_id" text NOT NULL,
	"import_id" text NOT NULL,
	"transaction_date" date NOT NULL,
	"description" text,
	"reference_no" text,
	"debit_amount" numeric DEFAULT '0' NOT NULL,
	"credit_amount" numeric DEFAULT '0' NOT NULL,
	"status" "compliance"."erp_bank_reconciliation_status" DEFAULT 'unmatched' NOT NULL,
	"matched_journal_entry_id" text,
	"created_at" timestamp DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "compliance"."erp_budget_line_items" (
	"id" text PRIMARY KEY NOT NULL,
	"budget_id" text NOT NULL,
	"account_id" text NOT NULL,
	"annual_amount" numeric DEFAULT '0' NOT NULL
);
--> statement-breakpoint
CREATE TABLE "compliance"."erp_budgets" (
	"id" text PRIMARY KEY NOT NULL,
	"org_id" text NOT NULL,
	"fiscal_year_id" text NOT NULL,
	"company_id" text,
	"cost_center_id" text,
	"name" text NOT NULL,
	"action_if_exceeded" "compliance"."erp_budget_action" DEFAULT 'warn' NOT NULL,
	"status" "compliance"."erp_budget_status" DEFAULT 'draft' NOT NULL,
	"created_by_id" text,
	"submitted_at" timestamp,
	"created_at" timestamp DEFAULT now() NOT NULL,
	"updated_at" timestamp DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "compliance"."erp_cash_accounts" (
	"id" text PRIMARY KEY NOT NULL,
	"org_id" text NOT NULL,
	"account_name" text NOT NULL,
	"gl_account_id" text,
	"is_petty_cash" boolean DEFAULT false NOT NULL,
	"created_at" timestamp DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "compliance"."erp_cash_vouchers" (
	"id" text PRIMARY KEY NOT NULL,
	"org_id" text NOT NULL,
	"cash_account_id" text NOT NULL,
	"voucher_number" integer NOT NULL,
	"voucher_type" "compliance"."erp_cash_voucher_type" NOT NULL,
	"amount" numeric NOT NULL,
	"party_type" "compliance"."erp_party_type",
	"party_id" text,
	"posting_date" date NOT NULL,
	"status" "compliance"."erp_cash_voucher_status" DEFAULT 'draft' NOT NULL,
	"journal_entry_id" text,
	"remark" text,
	"created_by_id" text,
	"created_at" timestamp DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "compliance"."erp_companies" (
	"id" text PRIMARY KEY NOT NULL,
	"org_id" text NOT NULL,
	"company_name" text NOT NULL,
	"abbr" text,
	"parent_company_id" text,
	"is_group" boolean DEFAULT false NOT NULL,
	"default_currency_id" text,
	"country" text,
	"date_of_incorporation" date,
	"is_active" boolean DEFAULT true NOT NULL,
	"created_at" timestamp DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "compliance"."erp_contacts" (
	"id" text PRIMARY KEY NOT NULL,
	"org_id" text NOT NULL,
	"linked_entity_type" text NOT NULL,
	"linked_entity_id" text NOT NULL,
	"contact_name" text NOT NULL,
	"designation" text,
	"email" text,
	"phone" text,
	"is_primary" boolean DEFAULT false NOT NULL,
	"created_at" timestamp DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "compliance"."erp_contract_amendments" (
	"id" text PRIMARY KEY NOT NULL,
	"contract_id" text NOT NULL,
	"amendment_number" integer NOT NULL,
	"description" text NOT NULL,
	"previous_value" numeric,
	"new_value" numeric,
	"effective_date" date NOT NULL,
	"status" "compliance"."erp_contract_amendment_status" DEFAULT 'draft' NOT NULL,
	"created_by_id" text,
	"approved_by_id" text,
	"created_at" timestamp DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "compliance"."erp_contract_billing_schedules" (
	"id" text PRIMARY KEY NOT NULL,
	"contract_id" text NOT NULL,
	"billing_frequency" "compliance"."erp_contract_billing_frequency" NOT NULL,
	"next_billing_date" date NOT NULL,
	"amount" numeric NOT NULL,
	"last_invoice_id" text,
	"is_active" boolean DEFAULT true NOT NULL,
	"created_at" timestamp DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "compliance"."erp_contract_negotiation_rounds" (
	"id" text PRIMARY KEY NOT NULL,
	"org_id" text NOT NULL,
	"contract_id" text NOT NULL,
	"round_number" integer NOT NULL,
	"proposed_value" numeric,
	"notes" text,
	"created_by_id" text,
	"created_at" timestamp DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "compliance"."erp_contract_obligations" (
	"id" text PRIMARY KEY NOT NULL,
	"contract_id" text NOT NULL,
	"description" text NOT NULL,
	"due_date" date NOT NULL,
	"status" "compliance"."erp_contract_obligation_status" DEFAULT 'pending' NOT NULL,
	"responsible_user_id" text,
	"completed_at" timestamp,
	"created_at" timestamp DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "compliance"."erp_contract_revenue_schedules" (
	"id" text PRIMARY KEY NOT NULL,
	"contract_id" text NOT NULL,
	"period_start" date NOT NULL,
	"period_end" date NOT NULL,
	"recognized_amount" numeric DEFAULT '0' NOT NULL,
	"deferred_amount" numeric DEFAULT '0' NOT NULL,
	"is_recognized" boolean DEFAULT false NOT NULL,
	"journal_entry_id" text,
	"created_at" timestamp DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "compliance"."erp_contracts" (
	"id" text PRIMARY KEY NOT NULL,
	"org_id" text NOT NULL,
	"customer_id" text NOT NULL,
	"contract_number" integer NOT NULL,
	"title" text NOT NULL,
	"contract_type" text,
	"start_date" date NOT NULL,
	"end_date" date,
	"auto_renew" boolean DEFAULT false NOT NULL,
	"renewal_notice_days" integer,
	"contract_value" numeric DEFAULT '0' NOT NULL,
	"currency_id" text,
	"sla_response_hours" numeric,
	"sla_resolution_hours" numeric,
	"owner_id" text,
	"status" "compliance"."erp_contract_status" DEFAULT 'draft' NOT NULL,
	"template_id" text,
	"body_text" text,
	"created_by_id" text,
	"created_at" timestamp DEFAULT now() NOT NULL,
	"updated_at" timestamp DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "compliance"."erp_cost_centers" (
	"id" text PRIMARY KEY NOT NULL,
	"org_id" text NOT NULL,
	"name" text NOT NULL,
	"parent_cost_center_id" text,
	"is_group" boolean DEFAULT false NOT NULL,
	"department_id" text,
	"project_id" text,
	"created_at" timestamp DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "compliance"."erp_currencies" (
	"id" text PRIMARY KEY NOT NULL,
	"org_id" text NOT NULL,
	"code" text NOT NULL,
	"name" text NOT NULL,
	"symbol" text,
	"is_base_currency" boolean DEFAULT false NOT NULL,
	"created_at" timestamp DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "compliance"."erp_customers" (
	"id" text PRIMARY KEY NOT NULL,
	"org_id" text NOT NULL,
	"customer_name" text NOT NULL,
	"client_id" text,
	"gstin" text,
	"pan_number" text,
	"default_payment_terms_days" integer,
	"credit_limit" numeric,
	"is_active" boolean DEFAULT true NOT NULL,
	"created_at" timestamp DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "compliance"."erp_cycle_count_lines" (
	"id" text PRIMARY KEY NOT NULL,
	"plan_id" text NOT NULL,
	"item_id" text NOT NULL,
	"system_qty" numeric NOT NULL,
	"counted_qty" numeric,
	"status" text DEFAULT 'pending' NOT NULL,
	"counted_by_id" text,
	"counted_at" timestamp
);
--> statement-breakpoint
CREATE TABLE "compliance"."erp_cycle_count_plans" (
	"id" text PRIMARY KEY NOT NULL,
	"org_id" text NOT NULL,
	"warehouse_id" text NOT NULL,
	"name" text NOT NULL,
	"status" text DEFAULT 'draft' NOT NULL,
	"scheduled_date" date,
	"created_by_id" text,
	"created_at" timestamp DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "compliance"."erp_delivery_note_items" (
	"id" text PRIMARY KEY NOT NULL,
	"delivery_note_id" text NOT NULL,
	"sales_order_item_id" text,
	"item_id" text,
	"quantity" numeric DEFAULT '1' NOT NULL,
	"warehouse_id" text
);
--> statement-breakpoint
CREATE TABLE "compliance"."erp_delivery_notes" (
	"id" text PRIMARY KEY NOT NULL,
	"org_id" text NOT NULL,
	"customer_id" text NOT NULL,
	"sales_order_id" text,
	"delivery_number" integer NOT NULL,
	"posting_date" date NOT NULL,
	"status" text DEFAULT 'draft' NOT NULL,
	"created_by_id" text,
	"created_at" timestamp DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "compliance"."erp_depreciation_schedules" (
	"id" text PRIMARY KEY NOT NULL,
	"asset_id" text NOT NULL,
	"schedule_date" date NOT NULL,
	"depreciation_amount" numeric NOT NULL,
	"accumulated_depreciation_after" numeric NOT NULL,
	"is_posted" boolean DEFAULT false NOT NULL,
	"journal_entry_id" text
);
--> statement-breakpoint
CREATE TABLE "compliance"."erp_e_invoice_logs" (
	"id" text PRIMARY KEY NOT NULL,
	"org_id" text NOT NULL,
	"reference_type" text DEFAULT 'sales_invoice' NOT NULL,
	"reference_id" text NOT NULL,
	"status" text DEFAULT 'draft' NOT NULL,
	"invoice_data" jsonb,
	"irn" text,
	"ack_number" text,
	"ack_date" timestamp,
	"signed_invoice" text,
	"signed_qr_code" text,
	"is_generated_in_sandbox" boolean DEFAULT true NOT NULL,
	"is_cancelled" boolean DEFAULT false NOT NULL,
	"cancelled_at" timestamp,
	"cancel_reason_code" text,
	"cancel_remark" text,
	"created_by_id" text,
	"created_at" timestamp DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "compliance"."erp_employee_tax_exemptions" (
	"id" text PRIMARY KEY NOT NULL,
	"org_id" text NOT NULL,
	"employee_id" text NOT NULL,
	"financial_year" text NOT NULL,
	"category" text NOT NULL,
	"amount" numeric NOT NULL,
	"created_at" timestamp DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "compliance"."erp_exchange_rates" (
	"id" text PRIMARY KEY NOT NULL,
	"org_id" text NOT NULL,
	"from_currency_id" text NOT NULL,
	"to_currency_id" text NOT NULL,
	"rate" numeric NOT NULL,
	"rate_date" date NOT NULL,
	"source" text DEFAULT 'manual' NOT NULL,
	"created_at" timestamp DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "compliance"."erp_fiscal_years" (
	"id" text PRIMARY KEY NOT NULL,
	"org_id" text NOT NULL,
	"year_name" text NOT NULL,
	"start_date" date NOT NULL,
	"end_date" date NOT NULL,
	"is_closed" boolean DEFAULT false NOT NULL,
	"created_at" timestamp DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "compliance"."erp_fixed_assets" (
	"id" text PRIMARY KEY NOT NULL,
	"org_id" text NOT NULL,
	"asset_name" text NOT NULL,
	"asset_category_id" text NOT NULL,
	"department_id" text,
	"custodian_user_id" text,
	"location" text,
	"purchase_date" date NOT NULL,
	"purchase_cost" numeric NOT NULL,
	"depreciation_method" "compliance"."erp_depreciation_method" DEFAULT 'straight_line' NOT NULL,
	"useful_life_months" integer,
	"salvage_value" numeric DEFAULT '0' NOT NULL,
	"status" "compliance"."erp_asset_status" DEFAULT 'draft' NOT NULL,
	"current_value" numeric,
	"accumulated_depreciation" numeric DEFAULT '0' NOT NULL,
	"journal_entry_id" text,
	"created_at" timestamp DEFAULT now() NOT NULL,
	"updated_at" timestamp DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "compliance"."erp_income_tax_slab_rates" (
	"id" text PRIMARY KEY NOT NULL,
	"slab_id" text NOT NULL,
	"from_amount" numeric NOT NULL,
	"to_amount" numeric,
	"percent_deduction" numeric NOT NULL
);
--> statement-breakpoint
CREATE TABLE "compliance"."erp_income_tax_slabs" (
	"id" text PRIMARY KEY NOT NULL,
	"org_id" text NOT NULL,
	"name" text NOT NULL,
	"effective_from" date NOT NULL,
	"standard_deduction" numeric DEFAULT '0' NOT NULL,
	"is_active" boolean DEFAULT true NOT NULL,
	"created_at" timestamp DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "compliance"."erp_item_batches" (
	"id" text PRIMARY KEY NOT NULL,
	"org_id" text NOT NULL,
	"item_id" text NOT NULL,
	"batch_number" text NOT NULL,
	"manufacturing_date" date,
	"expiry_date" date,
	"created_at" timestamp DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "compliance"."erp_item_groups" (
	"id" text PRIMARY KEY NOT NULL,
	"org_id" text NOT NULL,
	"group_name" text NOT NULL,
	"parent_group_id" text,
	"created_at" timestamp DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "compliance"."erp_item_serials" (
	"id" text PRIMARY KEY NOT NULL,
	"org_id" text NOT NULL,
	"item_id" text NOT NULL,
	"serial_number" text NOT NULL,
	"status" "compliance"."erp_item_serial_status" DEFAULT 'in_stock' NOT NULL,
	"warehouse_id" text,
	"created_at" timestamp DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "compliance"."erp_item_uom_conversions" (
	"id" text PRIMARY KEY NOT NULL,
	"org_id" text NOT NULL,
	"item_id" text NOT NULL,
	"uom" text NOT NULL,
	"conversion_factor" numeric NOT NULL,
	"created_at" timestamp DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "compliance"."erp_items" (
	"id" text PRIMARY KEY NOT NULL,
	"org_id" text NOT NULL,
	"item_code" text NOT NULL,
	"item_name" text NOT NULL,
	"item_group_id" text,
	"uom" text,
	"is_stock_item" boolean DEFAULT true NOT NULL,
	"is_sales_item" boolean DEFAULT true NOT NULL,
	"is_purchase_item" boolean DEFAULT true NOT NULL,
	"standard_selling_rate" numeric,
	"standard_buying_rate" numeric,
	"is_active" boolean DEFAULT true NOT NULL,
	"has_batch_no" boolean DEFAULT false NOT NULL,
	"has_serial_no" boolean DEFAULT false NOT NULL,
	"hsn_sac_code" text,
	"created_at" timestamp DEFAULT now() NOT NULL,
	"updated_at" timestamp DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "compliance"."erp_journal_entries" (
	"id" text PRIMARY KEY NOT NULL,
	"org_id" text NOT NULL,
	"entry_number" integer NOT NULL,
	"posting_date" date NOT NULL,
	"reference_type" text,
	"reference_id" text,
	"user_remark" text,
	"is_opening_entry" boolean DEFAULT false NOT NULL,
	"status" "compliance"."erp_journal_entry_status" DEFAULT 'draft' NOT NULL,
	"total_debit" numeric DEFAULT '0' NOT NULL,
	"total_credit" numeric DEFAULT '0' NOT NULL,
	"company_id" text,
	"created_by_id" text,
	"submitted_at" timestamp,
	"created_at" timestamp DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "compliance"."erp_journal_entry_lines" (
	"id" text PRIMARY KEY NOT NULL,
	"journal_entry_id" text NOT NULL,
	"account_id" text NOT NULL,
	"party_type" "compliance"."erp_party_type",
	"party_id" text,
	"debit" numeric DEFAULT '0' NOT NULL,
	"credit" numeric DEFAULT '0' NOT NULL,
	"cost_center" text,
	"cost_center_id" text,
	"client_id" text,
	"remark" text,
	"currency_id" text,
	"exchange_rate" numeric,
	"debit_in_currency" numeric,
	"credit_in_currency" numeric
);
--> statement-breakpoint
CREATE TABLE "compliance"."erp_landed_cost_allocations" (
	"id" text PRIMARY KEY NOT NULL,
	"org_id" text NOT NULL,
	"voucher_id" text NOT NULL,
	"receipt_item_id" text NOT NULL,
	"allocated_amount" numeric NOT NULL
);
--> statement-breakpoint
CREATE TABLE "compliance"."erp_landed_cost_charges" (
	"id" text PRIMARY KEY NOT NULL,
	"org_id" text NOT NULL,
	"voucher_id" text NOT NULL,
	"expense_type" text NOT NULL,
	"amount" numeric NOT NULL,
	"description" text
);
--> statement-breakpoint
CREATE TABLE "compliance"."erp_landed_cost_vouchers" (
	"id" text PRIMARY KEY NOT NULL,
	"org_id" text NOT NULL,
	"purchase_receipt_id" text NOT NULL,
	"posting_date" date NOT NULL,
	"created_by_id" text,
	"created_at" timestamp DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "compliance"."erp_payment_entries" (
	"id" text PRIMARY KEY NOT NULL,
	"org_id" text NOT NULL,
	"payment_type" "compliance"."erp_payment_type" NOT NULL,
	"party_type" "compliance"."erp_party_type" NOT NULL,
	"party_id" text NOT NULL,
	"paid_amount" numeric DEFAULT '0' NOT NULL,
	"received_amount" numeric DEFAULT '0' NOT NULL,
	"bank_account_id" text,
	"reference_no" text,
	"reference_date" date,
	"posting_date" date NOT NULL,
	"status" "compliance"."erp_payment_entry_status" DEFAULT 'draft' NOT NULL,
	"journal_entry_id" text,
	"invoice_type" text,
	"invoice_id" text,
	"created_by_id" text,
	"submitted_by_id" text,
	"submitted_at" timestamp,
	"decided_by_id" text,
	"decided_at" timestamp,
	"decision_comment" text,
	"created_at" timestamp DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "compliance"."erp_payroll_runs" (
	"id" text PRIMARY KEY NOT NULL,
	"org_id" text NOT NULL,
	"month" integer NOT NULL,
	"year" integer NOT NULL,
	"status" "compliance"."erp_payroll_run_status" DEFAULT 'draft' NOT NULL,
	"processed_at" timestamp,
	"created_by_id" text,
	"created_at" timestamp DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "compliance"."erp_payslip_lines" (
	"id" text PRIMARY KEY NOT NULL,
	"payslip_id" text NOT NULL,
	"component_id" text,
	"label" text NOT NULL,
	"line_type" "compliance"."erp_payslip_line_type" NOT NULL,
	"amount" numeric DEFAULT '0' NOT NULL
);
--> statement-breakpoint
CREATE TABLE "compliance"."erp_payslips" (
	"id" text PRIMARY KEY NOT NULL,
	"org_id" text NOT NULL,
	"payroll_run_id" text NOT NULL,
	"employee_id" text NOT NULL,
	"gross_earnings" numeric DEFAULT '0' NOT NULL,
	"total_deductions" numeric DEFAULT '0' NOT NULL,
	"net_pay" numeric DEFAULT '0' NOT NULL,
	"status" text DEFAULT 'draft' NOT NULL,
	"created_at" timestamp DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "compliance"."erp_period_closing_checklist_items" (
	"id" text PRIMARY KEY NOT NULL,
	"org_id" text NOT NULL,
	"period_id" text NOT NULL,
	"title" text NOT NULL,
	"task_type" text DEFAULT 'other' NOT NULL,
	"status" text DEFAULT 'pending' NOT NULL,
	"assigned_to_id" text,
	"completed_by_id" text,
	"completed_at" timestamp,
	"notes" text,
	"sort_order" integer DEFAULT 0 NOT NULL,
	"created_at" timestamp DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "compliance"."erp_pricing_rules" (
	"id" text PRIMARY KEY NOT NULL,
	"org_id" text NOT NULL,
	"name" text NOT NULL,
	"applies_to" "compliance"."erp_pricing_applies_to" DEFAULT 'all' NOT NULL,
	"target_id" text,
	"discount_type" "compliance"."erp_pricing_discount_type" DEFAULT 'percentage' NOT NULL,
	"discount_value" numeric NOT NULL,
	"min_qty" numeric DEFAULT '0' NOT NULL,
	"valid_from" date NOT NULL,
	"valid_to" date,
	"priority" integer DEFAULT 0 NOT NULL,
	"is_active" boolean DEFAULT true NOT NULL,
	"created_by_id" text,
	"created_at" timestamp DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "compliance"."erp_purchase_credit_note_items" (
	"id" text PRIMARY KEY NOT NULL,
	"credit_note_id" text NOT NULL,
	"item_id" text,
	"description" text NOT NULL,
	"quantity" numeric DEFAULT '1' NOT NULL,
	"rate" numeric DEFAULT '0' NOT NULL,
	"amount" numeric DEFAULT '0' NOT NULL
);
--> statement-breakpoint
CREATE TABLE "compliance"."erp_purchase_credit_notes" (
	"id" text PRIMARY KEY NOT NULL,
	"org_id" text NOT NULL,
	"supplier_id" text NOT NULL,
	"purchase_invoice_id" text,
	"credit_note_number" integer NOT NULL,
	"posting_date" date NOT NULL,
	"reason" text,
	"status" "compliance"."erp_credit_note_status" DEFAULT 'draft' NOT NULL,
	"total_amount" numeric DEFAULT '0' NOT NULL,
	"journal_entry_id" text,
	"created_by_id" text,
	"created_at" timestamp DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "compliance"."erp_purchase_invoice_items" (
	"id" text PRIMARY KEY NOT NULL,
	"invoice_id" text NOT NULL,
	"item_id" text,
	"description" text NOT NULL,
	"quantity" numeric DEFAULT '1' NOT NULL,
	"rate" numeric DEFAULT '0' NOT NULL,
	"amount" numeric DEFAULT '0' NOT NULL,
	"tax_template_id" text,
	"hsn_sac_code" text,
	"purchase_order_item_id" text
);
--> statement-breakpoint
CREATE TABLE "compliance"."erp_purchase_invoices" (
	"id" text PRIMARY KEY NOT NULL,
	"org_id" text NOT NULL,
	"supplier_id" text NOT NULL,
	"invoice_number" integer NOT NULL,
	"posting_date" date NOT NULL,
	"due_date" date,
	"currency_id" text,
	"exchange_rate" numeric DEFAULT '1' NOT NULL,
	"subtotal" numeric DEFAULT '0' NOT NULL,
	"tax_amount" numeric DEFAULT '0' NOT NULL,
	"grand_total" numeric DEFAULT '0' NOT NULL,
	"outstanding_amount" numeric DEFAULT '0' NOT NULL,
	"status" "compliance"."erp_invoice_status" DEFAULT 'draft' NOT NULL,
	"journal_entry_id" text,
	"purchase_order_id" text,
	"company_id" text,
	"tds_amount" numeric DEFAULT '0' NOT NULL,
	"created_by_id" text,
	"created_at" timestamp DEFAULT now() NOT NULL,
	"updated_at" timestamp DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "compliance"."erp_purchase_order_items" (
	"id" text PRIMARY KEY NOT NULL,
	"purchase_order_id" text NOT NULL,
	"item_id" text,
	"description" text NOT NULL,
	"quantity" numeric DEFAULT '1' NOT NULL,
	"rate" numeric DEFAULT '0' NOT NULL,
	"amount" numeric DEFAULT '0' NOT NULL,
	"received_quantity" numeric DEFAULT '0' NOT NULL
);
--> statement-breakpoint
CREATE TABLE "compliance"."erp_purchase_orders" (
	"id" text PRIMARY KEY NOT NULL,
	"org_id" text NOT NULL,
	"supplier_id" text NOT NULL,
	"po_number" integer NOT NULL,
	"order_date" date NOT NULL,
	"expected_delivery_date" date,
	"status" text DEFAULT 'draft' NOT NULL,
	"company_id" text,
	"currency_id" text,
	"exchange_rate" numeric DEFAULT '1' NOT NULL,
	"grand_total" numeric DEFAULT '0' NOT NULL,
	"created_by_id" text,
	"created_at" timestamp DEFAULT now() NOT NULL,
	"updated_at" timestamp DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "compliance"."erp_purchase_receipt_items" (
	"id" text PRIMARY KEY NOT NULL,
	"receipt_id" text NOT NULL,
	"purchase_order_item_id" text,
	"item_id" text,
	"quantity" numeric DEFAULT '1' NOT NULL,
	"warehouse_id" text,
	"rate" numeric
);
--> statement-breakpoint
CREATE TABLE "compliance"."erp_purchase_receipts" (
	"id" text PRIMARY KEY NOT NULL,
	"org_id" text NOT NULL,
	"supplier_id" text NOT NULL,
	"purchase_order_id" text,
	"receipt_number" integer NOT NULL,
	"posting_date" date NOT NULL,
	"status" text DEFAULT 'draft' NOT NULL,
	"putaway_status" text DEFAULT 'pending' NOT NULL,
	"created_by_id" text,
	"created_at" timestamp DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "compliance"."erp_purchase_requisition_items" (
	"id" text PRIMARY KEY NOT NULL,
	"requisition_id" text NOT NULL,
	"item_id" text,
	"description" text NOT NULL,
	"quantity" numeric DEFAULT '1' NOT NULL,
	"estimated_rate" numeric
);
--> statement-breakpoint
CREATE TABLE "compliance"."erp_purchase_requisitions" (
	"id" text PRIMARY KEY NOT NULL,
	"org_id" text NOT NULL,
	"requisition_number" integer NOT NULL,
	"requested_by_id" text,
	"department_id" text,
	"purpose" text,
	"posting_date" date NOT NULL,
	"status" "compliance"."erp_requisition_status" DEFAULT 'draft' NOT NULL,
	"created_at" timestamp DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "compliance"."erp_purchase_return_items" (
	"id" text PRIMARY KEY NOT NULL,
	"return_id" text NOT NULL,
	"item_id" text NOT NULL,
	"quantity" numeric NOT NULL,
	"rate" numeric DEFAULT '0' NOT NULL,
	"reason" text
);
--> statement-breakpoint
CREATE TABLE "compliance"."erp_purchase_returns" (
	"id" text PRIMARY KEY NOT NULL,
	"org_id" text NOT NULL,
	"supplier_id" text NOT NULL,
	"purchase_invoice_id" text,
	"warehouse_id" text NOT NULL,
	"reason" text,
	"status" "compliance"."erp_purchase_return_status" DEFAULT 'requested' NOT NULL,
	"credit_note_id" text,
	"requested_by_id" text NOT NULL,
	"approved_by_id" text,
	"created_at" timestamp DEFAULT now() NOT NULL,
	"updated_at" timestamp DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "compliance"."erp_quotation_items" (
	"id" text PRIMARY KEY NOT NULL,
	"quotation_id" text NOT NULL,
	"item_id" text,
	"description" text NOT NULL,
	"quantity" numeric DEFAULT '1' NOT NULL,
	"rate" numeric DEFAULT '0' NOT NULL,
	"amount" numeric DEFAULT '0' NOT NULL
);
--> statement-breakpoint
CREATE TABLE "compliance"."erp_quotations" (
	"id" text PRIMARY KEY NOT NULL,
	"org_id" text NOT NULL,
	"customer_id" text,
	"lead_id" text,
	"company_id" text,
	"quotation_number" integer NOT NULL,
	"quotation_date" date NOT NULL,
	"valid_till" date,
	"status" text DEFAULT 'draft' NOT NULL,
	"currency_id" text,
	"exchange_rate" numeric DEFAULT '1' NOT NULL,
	"grand_total" numeric DEFAULT '0' NOT NULL,
	"version" integer DEFAULT 1 NOT NULL,
	"revision_of" text,
	"project_id" text,
	"created_by_id" text,
	"created_at" timestamp DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "compliance"."erp_reorder_levels" (
	"id" text PRIMARY KEY NOT NULL,
	"org_id" text NOT NULL,
	"item_id" text NOT NULL,
	"warehouse_id" text,
	"reorder_point" numeric NOT NULL,
	"reorder_qty" numeric NOT NULL,
	"safety_stock" numeric,
	"min_level" numeric,
	"max_level" numeric,
	"created_at" timestamp DEFAULT now() NOT NULL,
	"updated_at" timestamp DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "compliance"."erp_rfq_auction_bids" (
	"id" text PRIMARY KEY NOT NULL,
	"org_id" text NOT NULL,
	"auction_id" text NOT NULL,
	"supplier_id" text NOT NULL,
	"bid_amount" numeric NOT NULL,
	"submitted_at" timestamp DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "compliance"."erp_rfq_items" (
	"id" text PRIMARY KEY NOT NULL,
	"rfq_id" text NOT NULL,
	"item_id" text,
	"description" text NOT NULL,
	"quantity" numeric DEFAULT '1' NOT NULL
);
--> statement-breakpoint
CREATE TABLE "compliance"."erp_rfq_negotiation_rounds" (
	"id" text PRIMARY KEY NOT NULL,
	"org_id" text NOT NULL,
	"quotation_id" text NOT NULL,
	"round_number" integer NOT NULL,
	"proposed_rate" numeric NOT NULL,
	"notes" text,
	"created_by_id" text,
	"created_at" timestamp DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "compliance"."erp_rfq_quotation_scores" (
	"id" text PRIMARY KEY NOT NULL,
	"org_id" text NOT NULL,
	"quotation_id" text NOT NULL,
	"criterion_id" text NOT NULL,
	"score" numeric NOT NULL,
	"scored_by_id" text,
	"notes" text,
	"created_at" timestamp DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "compliance"."erp_rfq_reverse_auctions" (
	"id" text PRIMARY KEY NOT NULL,
	"org_id" text NOT NULL,
	"rfq_id" text NOT NULL,
	"start_at" timestamp NOT NULL,
	"end_at" timestamp NOT NULL,
	"status" text DEFAULT 'scheduled' NOT NULL,
	"current_lowest_bid" numeric,
	"current_leader_supplier_id" text,
	"winning_supplier_id" text,
	"closed_at" timestamp,
	"created_by_id" text,
	"created_at" timestamp DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "compliance"."erp_rfq_scoring_criteria" (
	"id" text PRIMARY KEY NOT NULL,
	"org_id" text NOT NULL,
	"rfq_id" text NOT NULL,
	"name" text NOT NULL,
	"weight" numeric DEFAULT '1' NOT NULL,
	"created_at" timestamp DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "compliance"."erp_rfq_suppliers" (
	"id" text PRIMARY KEY NOT NULL,
	"rfq_id" text NOT NULL,
	"supplier_id" text NOT NULL
);
--> statement-breakpoint
CREATE TABLE "compliance"."erp_rfqs" (
	"id" text PRIMARY KEY NOT NULL,
	"org_id" text NOT NULL,
	"rfq_number" integer NOT NULL,
	"requisition_id" text,
	"posting_date" date NOT NULL,
	"status" "compliance"."erp_rfq_status" DEFAULT 'draft' NOT NULL,
	"created_by_id" text,
	"created_at" timestamp DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "compliance"."erp_salary_components" (
	"id" text PRIMARY KEY NOT NULL,
	"org_id" text NOT NULL,
	"name" text NOT NULL,
	"component_type" "compliance"."erp_salary_component_type" NOT NULL,
	"calculation_type" "compliance"."erp_component_calc_type" DEFAULT 'flat' NOT NULL,
	"default_percentage" numeric,
	"default_amount" numeric,
	"is_statutory" boolean DEFAULT false NOT NULL,
	"include_in_pf_wage" boolean DEFAULT false NOT NULL,
	"created_at" timestamp DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "compliance"."erp_salary_structure_components" (
	"id" text PRIMARY KEY NOT NULL,
	"structure_id" text NOT NULL,
	"component_id" text NOT NULL,
	"amount" numeric,
	"percentage" numeric
);
--> statement-breakpoint
CREATE TABLE "compliance"."erp_salary_structures" (
	"id" text PRIMARY KEY NOT NULL,
	"org_id" text NOT NULL,
	"employee_id" text NOT NULL,
	"effective_from" date NOT NULL,
	"ctc_annual" numeric NOT NULL,
	"state" text,
	"created_by_id" text,
	"created_at" timestamp DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "compliance"."erp_sales_credit_note_items" (
	"id" text PRIMARY KEY NOT NULL,
	"credit_note_id" text NOT NULL,
	"item_id" text,
	"description" text NOT NULL,
	"quantity" numeric DEFAULT '1' NOT NULL,
	"rate" numeric DEFAULT '0' NOT NULL,
	"amount" numeric DEFAULT '0' NOT NULL
);
--> statement-breakpoint
CREATE TABLE "compliance"."erp_sales_credit_notes" (
	"id" text PRIMARY KEY NOT NULL,
	"org_id" text NOT NULL,
	"customer_id" text NOT NULL,
	"sales_invoice_id" text,
	"credit_note_number" integer NOT NULL,
	"posting_date" date NOT NULL,
	"reason" text,
	"status" "compliance"."erp_credit_note_status" DEFAULT 'draft' NOT NULL,
	"total_amount" numeric DEFAULT '0' NOT NULL,
	"journal_entry_id" text,
	"created_by_id" text,
	"created_at" timestamp DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "compliance"."erp_sales_invoice_items" (
	"id" text PRIMARY KEY NOT NULL,
	"invoice_id" text NOT NULL,
	"item_id" text,
	"description" text NOT NULL,
	"quantity" numeric DEFAULT '1' NOT NULL,
	"rate" numeric DEFAULT '0' NOT NULL,
	"amount" numeric DEFAULT '0' NOT NULL,
	"tax_template_id" text,
	"hsn_sac_code" text
);
--> statement-breakpoint
CREATE TABLE "compliance"."erp_sales_invoices" (
	"id" text PRIMARY KEY NOT NULL,
	"org_id" text NOT NULL,
	"client_id" text,
	"customer_id" text NOT NULL,
	"invoice_number" integer NOT NULL,
	"posting_date" date NOT NULL,
	"due_date" date,
	"currency_id" text,
	"exchange_rate" numeric DEFAULT '1' NOT NULL,
	"subtotal" numeric DEFAULT '0' NOT NULL,
	"tax_amount" numeric DEFAULT '0' NOT NULL,
	"grand_total" numeric DEFAULT '0' NOT NULL,
	"outstanding_amount" numeric DEFAULT '0' NOT NULL,
	"status" "compliance"."erp_invoice_status" DEFAULT 'draft' NOT NULL,
	"journal_entry_id" text,
	"sales_order_id" text,
	"company_id" text,
	"irn" text,
	"e_invoice_status" text,
	"created_by_id" text,
	"created_at" timestamp DEFAULT now() NOT NULL,
	"updated_at" timestamp DEFAULT now() NOT NULL,
	"project_id" text
);
--> statement-breakpoint
CREATE TABLE "compliance"."erp_sales_order_items" (
	"id" text PRIMARY KEY NOT NULL,
	"sales_order_id" text NOT NULL,
	"item_id" text,
	"description" text NOT NULL,
	"quantity" numeric DEFAULT '1' NOT NULL,
	"rate" numeric DEFAULT '0' NOT NULL,
	"amount" numeric DEFAULT '0' NOT NULL,
	"delivered_quantity" numeric DEFAULT '0' NOT NULL
);
--> statement-breakpoint
CREATE TABLE "compliance"."erp_sales_orders" (
	"id" text PRIMARY KEY NOT NULL,
	"org_id" text NOT NULL,
	"customer_id" text NOT NULL,
	"opportunity_id" text,
	"quotation_id" text,
	"company_id" text,
	"so_number" integer NOT NULL,
	"order_date" date NOT NULL,
	"delivery_date" date,
	"status" text DEFAULT 'draft' NOT NULL,
	"currency_id" text,
	"exchange_rate" numeric DEFAULT '1' NOT NULL,
	"grand_total" numeric DEFAULT '0' NOT NULL,
	"project_id" text,
	"created_by_id" text,
	"created_at" timestamp DEFAULT now() NOT NULL,
	"updated_at" timestamp DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "compliance"."erp_sales_return_items" (
	"id" text PRIMARY KEY NOT NULL,
	"return_id" text NOT NULL,
	"item_id" text NOT NULL,
	"quantity" numeric NOT NULL,
	"rate" numeric DEFAULT '0' NOT NULL,
	"reason" text
);
--> statement-breakpoint
CREATE TABLE "compliance"."erp_sales_returns" (
	"id" text PRIMARY KEY NOT NULL,
	"org_id" text NOT NULL,
	"customer_id" text NOT NULL,
	"sales_invoice_id" text,
	"warehouse_id" text NOT NULL,
	"reason" text,
	"status" "compliance"."erp_sales_return_status" DEFAULT 'requested' NOT NULL,
	"credit_note_id" text,
	"requested_by_id" text NOT NULL,
	"approved_by_id" text,
	"created_at" timestamp DEFAULT now() NOT NULL,
	"updated_at" timestamp DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "compliance"."erp_statutory_rules" (
	"id" text PRIMARY KEY NOT NULL,
	"org_id" text NOT NULL,
	"rule_type" "compliance"."erp_statutory_rule_type" NOT NULL,
	"state" text,
	"effective_from" date NOT NULL,
	"effective_to" date,
	"employee_rate" numeric,
	"employer_rate" numeric,
	"wage_ceiling" numeric,
	"slabs" jsonb,
	"notes" text,
	"created_at" timestamp DEFAULT now() NOT NULL,
	"updated_at" timestamp DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "compliance"."erp_stock_ledger_entries" (
	"id" text PRIMARY KEY NOT NULL,
	"org_id" text NOT NULL,
	"item_id" text NOT NULL,
	"warehouse_id" text NOT NULL,
	"posting_date" date NOT NULL,
	"voucher_type" text NOT NULL,
	"voucher_id" text NOT NULL,
	"quantity_change" numeric NOT NULL,
	"valuation_rate" numeric DEFAULT '0' NOT NULL,
	"balance_qty" numeric NOT NULL,
	"balance_value" numeric NOT NULL,
	"transaction_uom" text,
	"transaction_qty" numeric,
	"batch_id" text,
	"serial_id" text,
	"created_at" timestamp DEFAULT now() NOT NULL,
	"project_id" text
);
--> statement-breakpoint
CREATE TABLE "compliance"."erp_stock_reconciliation_items" (
	"id" text PRIMARY KEY NOT NULL,
	"reconciliation_id" text NOT NULL,
	"item_id" text NOT NULL,
	"counted_qty" numeric NOT NULL,
	"valuation_rate" numeric DEFAULT '0' NOT NULL,
	"system_qty" numeric
);
--> statement-breakpoint
CREATE TABLE "compliance"."erp_stock_reconciliations" (
	"id" text PRIMARY KEY NOT NULL,
	"org_id" text NOT NULL,
	"warehouse_id" text NOT NULL,
	"posting_date" date NOT NULL,
	"status" text DEFAULT 'draft' NOT NULL,
	"created_by_id" text,
	"created_at" timestamp DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "compliance"."erp_stock_valuation_layers" (
	"id" text PRIMARY KEY NOT NULL,
	"org_id" text NOT NULL,
	"item_id" text NOT NULL,
	"warehouse_id" text NOT NULL,
	"stock_ledger_entry_id" text NOT NULL,
	"receipt_date" date NOT NULL,
	"original_qty" numeric NOT NULL,
	"remaining_qty" numeric NOT NULL,
	"rate" numeric NOT NULL,
	"created_at" timestamp DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "compliance"."erp_subscription_plans" (
	"id" text PRIMARY KEY NOT NULL,
	"org_id" text NOT NULL,
	"name" text NOT NULL,
	"billing_frequency" "compliance"."erp_contract_billing_frequency" NOT NULL,
	"price" numeric NOT NULL,
	"currency_id" text,
	"is_active" boolean DEFAULT true NOT NULL,
	"created_at" timestamp DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "compliance"."erp_subscriptions" (
	"id" text PRIMARY KEY NOT NULL,
	"org_id" text NOT NULL,
	"contract_id" text,
	"customer_id" text NOT NULL,
	"plan_id" text NOT NULL,
	"status" "compliance"."erp_subscription_status" DEFAULT 'active' NOT NULL,
	"start_date" date NOT NULL,
	"next_renewal_date" date,
	"cancelled_at" timestamp,
	"created_at" timestamp DEFAULT now() NOT NULL,
	"updated_at" timestamp DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "compliance"."erp_supplier_bank_accounts" (
	"id" text PRIMARY KEY NOT NULL,
	"org_id" text NOT NULL,
	"supplier_id" text NOT NULL,
	"account_holder_name" text NOT NULL,
	"bank_name" text NOT NULL,
	"account_number_encrypted" text NOT NULL,
	"account_number_last4" text NOT NULL,
	"ifsc_code" text,
	"account_type" text DEFAULT 'savings' NOT NULL,
	"is_primary" boolean DEFAULT false NOT NULL,
	"created_by_id" text,
	"created_at" timestamp DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "compliance"."erp_supplier_portal_links" (
	"id" text PRIMARY KEY NOT NULL,
	"org_id" text NOT NULL,
	"supplier_id" text NOT NULL,
	"token" text NOT NULL,
	"created_by_id" text,
	"expires_at" timestamp NOT NULL,
	"revoked_at" timestamp,
	"created_at" timestamp DEFAULT now() NOT NULL,
	CONSTRAINT "erp_supplier_portal_links_token_unique" UNIQUE("token")
);
--> statement-breakpoint
CREATE TABLE "compliance"."erp_supplier_qualifications" (
	"id" text PRIMARY KEY NOT NULL,
	"org_id" text NOT NULL,
	"supplier_id" text NOT NULL,
	"status" text NOT NULL,
	"criteria" jsonb DEFAULT '{}'::jsonb NOT NULL,
	"score" numeric,
	"notes" text,
	"reviewed_by_id" text,
	"created_at" timestamp DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "compliance"."erp_supplier_quotation_items" (
	"id" text PRIMARY KEY NOT NULL,
	"quotation_id" text NOT NULL,
	"item_id" text,
	"description" text NOT NULL,
	"quantity" numeric DEFAULT '1' NOT NULL,
	"rate" numeric DEFAULT '0' NOT NULL
);
--> statement-breakpoint
CREATE TABLE "compliance"."erp_supplier_quotations" (
	"id" text PRIMARY KEY NOT NULL,
	"org_id" text NOT NULL,
	"rfq_id" text,
	"supplier_id" text NOT NULL,
	"quotation_number" integer NOT NULL,
	"posting_date" date NOT NULL,
	"valid_till" date,
	"status" "compliance"."erp_supplier_quotation_status" DEFAULT 'draft' NOT NULL,
	"created_by_id" text,
	"created_at" timestamp DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "compliance"."erp_supplier_sanction_checks" (
	"id" text PRIMARY KEY NOT NULL,
	"org_id" text NOT NULL,
	"supplier_id" text NOT NULL,
	"checked_by_id" text,
	"lists_checked" jsonb DEFAULT '[]'::jsonb NOT NULL,
	"match_found" boolean DEFAULT false NOT NULL,
	"match_details" text,
	"result_status" text NOT NULL,
	"created_at" timestamp DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "compliance"."erp_suppliers" (
	"id" text PRIMARY KEY NOT NULL,
	"org_id" text NOT NULL,
	"supplier_name" text NOT NULL,
	"supplier_type" text,
	"gstin" text,
	"pan_number" text,
	"default_payment_terms_days" integer,
	"vendor_risk_profile_id" text,
	"tax_withholding_category_id" text,
	"is_active" boolean DEFAULT true NOT NULL,
	"created_at" timestamp DEFAULT now() NOT NULL,
	"qualification_status" text DEFAULT 'not_started' NOT NULL,
	"sanction_screening_status" text DEFAULT 'not_checked' NOT NULL,
	"sanction_screened_at" timestamp,
	"credit_limit" numeric,
	"trade" text,
	"project_id" text
);
--> statement-breakpoint
CREATE TABLE "compliance"."erp_tax_template_items" (
	"id" text PRIMARY KEY NOT NULL,
	"tax_template_id" text NOT NULL,
	"tax_account_id" text NOT NULL,
	"rate" numeric NOT NULL,
	"description" text
);
--> statement-breakpoint
CREATE TABLE "compliance"."erp_tax_templates" (
	"id" text PRIMARY KEY NOT NULL,
	"org_id" text NOT NULL,
	"name" text NOT NULL,
	"is_sales_tax" boolean DEFAULT false NOT NULL,
	"is_purchase_tax" boolean DEFAULT false NOT NULL,
	"created_at" timestamp DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "compliance"."erp_tax_withholding_categories" (
	"id" text PRIMARY KEY NOT NULL,
	"org_id" text NOT NULL,
	"category_name" text NOT NULL,
	"tax_deduction_basis" text DEFAULT 'net_total' NOT NULL,
	"created_at" timestamp DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "compliance"."erp_tax_withholding_rates" (
	"id" text PRIMARY KEY NOT NULL,
	"category_id" text NOT NULL,
	"from_date" date NOT NULL,
	"to_date" date,
	"rate" numeric NOT NULL,
	"single_threshold" numeric,
	"cumulative_threshold" numeric
);
--> statement-breakpoint
CREATE TABLE "compliance"."erp_warehouses" (
	"id" text PRIMARY KEY NOT NULL,
	"org_id" text NOT NULL,
	"warehouse_name" text NOT NULL,
	"parent_warehouse_id" text,
	"is_group" boolean DEFAULT false NOT NULL,
	"address" text,
	"created_at" timestamp DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "compliance"."esg_metrics" (
	"id" text PRIMARY KEY NOT NULL,
	"pillar" text NOT NULL,
	"label" text NOT NULL,
	"value_percent" integer DEFAULT 0 NOT NULL,
	"note" text,
	"org_id" text NOT NULL,
	"client_id" text,
	"created_at" timestamp DEFAULT now() NOT NULL,
	"updated_at" timestamp DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "compliance"."esignature_requests" (
	"id" text PRIMARY KEY NOT NULL,
	"org_id" text NOT NULL,
	"linked_entity_type" text NOT NULL,
	"linked_entity_id" text NOT NULL,
	"title" text NOT NULL,
	"document_hash" text NOT NULL,
	"status" text DEFAULT 'pending' NOT NULL,
	"created_by_id" text,
	"created_at" timestamp DEFAULT now() NOT NULL,
	"completed_at" timestamp
);
--> statement-breakpoint
CREATE TABLE "compliance"."esignature_signers" (
	"id" text PRIMARY KEY NOT NULL,
	"org_id" text NOT NULL,
	"request_id" text NOT NULL,
	"name" text NOT NULL,
	"email" text NOT NULL,
	"sign_order" integer,
	"status" text DEFAULT 'pending' NOT NULL,
	"user_id" text,
	"access_token" text NOT NULL,
	"token_expires_at" timestamp NOT NULL,
	"signature_image_data" text,
	"signature_method" text,
	"signed_at" timestamp,
	"ip_address" text,
	"user_agent" text,
	"document_hash_at_signing" text,
	"declined_at" timestamp,
	"decline_reason" text,
	"created_at" timestamp DEFAULT now() NOT NULL,
	CONSTRAINT "esignature_signers_access_token_unique" UNIQUE("access_token")
);
--> statement-breakpoint
CREATE TABLE "platform"."fde_requests" (
	"id" text PRIMARY KEY NOT NULL,
	"org_id" text NOT NULL,
	"user_id" text NOT NULL,
	"request_text" text NOT NULL,
	"status" text DEFAULT 'matched_existing' NOT NULL,
	"matched_worker_agent_id" text,
	"matched_label" text,
	"created_worker_agent_id" text,
	"created_dynamic_chain_id" text,
	"response_text" text NOT NULL,
	"top_candidates" jsonb,
	"reuse_level" text,
	"created_at" timestamp DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "compliance"."field_service_dispatches" (
	"id" text PRIMARY KEY NOT NULL,
	"org_id" text NOT NULL,
	"ticket_id" text NOT NULL,
	"technician_user_id" text,
	"scheduled_at" timestamp NOT NULL,
	"status" text DEFAULT 'scheduled' NOT NULL,
	"address_text" text,
	"completed_at" timestamp,
	"notes" text,
	"created_by_id" text,
	"created_at" timestamp DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "compliance"."firm_billable_rates" (
	"id" text PRIMARY KEY NOT NULL,
	"org_id" text NOT NULL,
	"user_id" text,
	"client_id" text,
	"hourly_rate" numeric NOT NULL,
	"valid_from" date NOT NULL,
	"created_at" timestamp DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "compliance"."firm_client_portal_links" (
	"id" text PRIMARY KEY NOT NULL,
	"org_id" text NOT NULL,
	"client_id" text NOT NULL,
	"token" text NOT NULL,
	"created_by_id" text,
	"expires_at" timestamp NOT NULL,
	"revoked_at" timestamp,
	"created_at" timestamp DEFAULT now() NOT NULL,
	CONSTRAINT "firm_client_portal_links_token_unique" UNIQUE("token")
);
--> statement-breakpoint
CREATE TABLE "compliance"."firm_client_service_lines" (
	"id" text PRIMARY KEY NOT NULL,
	"org_id" text NOT NULL,
	"client_id" text NOT NULL,
	"service_line" "compliance"."firm_service_line" NOT NULL,
	"is_enabled" boolean DEFAULT true NOT NULL,
	"lead_staff_user_id" text,
	"notes" text,
	"created_at" timestamp DEFAULT now() NOT NULL,
	"updated_at" timestamp DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "compliance"."firm_engagement_deliverables" (
	"id" text PRIMARY KEY NOT NULL,
	"org_id" text NOT NULL,
	"engagement_id" text NOT NULL,
	"title" text NOT NULL,
	"due_date" date,
	"status" text DEFAULT 'pending' NOT NULL,
	"linked_entity_type" text,
	"linked_entity_id" text,
	"assigned_to_id" text,
	"client_visible" boolean DEFAULT true NOT NULL,
	"submitted_at" timestamp,
	"completed_at" timestamp,
	"created_at" timestamp DEFAULT now() NOT NULL,
	"updated_at" timestamp DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "compliance"."firm_engagements" (
	"id" text PRIMARY KEY NOT NULL,
	"org_id" text NOT NULL,
	"client_id" text NOT NULL,
	"service_line" "compliance"."firm_service_line" NOT NULL,
	"title" text NOT NULL,
	"scope_of_work" text,
	"fee_type" "compliance"."firm_fee_type" DEFAULT 'fixed' NOT NULL,
	"fee_amount" numeric,
	"billing_frequency" text DEFAULT 'monthly',
	"start_date" date NOT NULL,
	"end_date" date,
	"status" text DEFAULT 'active' NOT NULL,
	"lead_partner_user_id" text,
	"recurrence_type" text DEFAULT 'none' NOT NULL,
	"next_occurrence_date" date,
	"budgeted_hours" numeric,
	"created_by_id" text,
	"created_at" timestamp DEFAULT now() NOT NULL,
	"updated_at" timestamp DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "compliance"."firm_invoice_line_items" (
	"id" text PRIMARY KEY NOT NULL,
	"org_id" text NOT NULL,
	"invoice_id" text NOT NULL,
	"description" text NOT NULL,
	"quantity_hours" numeric,
	"rate" numeric,
	"amount" numeric NOT NULL,
	"time_entry_id" text,
	"created_at" timestamp DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "compliance"."firm_invoices" (
	"id" text PRIMARY KEY NOT NULL,
	"org_id" text NOT NULL,
	"client_id" text NOT NULL,
	"engagement_id" text,
	"invoice_number" text NOT NULL,
	"issue_date" date NOT NULL,
	"due_date" date,
	"status" "compliance"."firm_invoice_status" DEFAULT 'draft' NOT NULL,
	"subtotal" numeric DEFAULT '0' NOT NULL,
	"tax_amount" numeric DEFAULT '0' NOT NULL,
	"total_amount" numeric DEFAULT '0' NOT NULL,
	"notes" text,
	"created_by_id" text,
	"created_at" timestamp DEFAULT now() NOT NULL,
	"updated_at" timestamp DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "compliance"."firm_staff_assignments" (
	"id" text PRIMARY KEY NOT NULL,
	"org_id" text NOT NULL,
	"client_id" text NOT NULL,
	"user_id" text NOT NULL,
	"role" "compliance"."firm_staff_role" DEFAULT 'staff' NOT NULL,
	"allocated_hours_per_week" numeric,
	"start_date" date NOT NULL,
	"end_date" date,
	"created_at" timestamp DEFAULT now() NOT NULL,
	"updated_at" timestamp DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "compliance"."firm_tax_cases" (
	"id" text PRIMARY KEY NOT NULL,
	"org_id" text NOT NULL,
	"client_id" text NOT NULL,
	"assessment_year" text NOT NULL,
	"case_type" text DEFAULT 'scrutiny' NOT NULL,
	"section_code" text,
	"authority" text,
	"forum" text DEFAULT 'ao' NOT NULL,
	"stage" text DEFAULT 'notice_received' NOT NULL,
	"due_date" date,
	"limitation_date" date,
	"demand_amount" numeric,
	"outcome" text,
	"linked_notice_id" text,
	"responsible_user_id" text,
	"created_by_id" text,
	"created_at" timestamp DEFAULT now() NOT NULL,
	"updated_at" timestamp DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "compliance"."firm_time_entries" (
	"id" text PRIMARY KEY NOT NULL,
	"org_id" text NOT NULL,
	"client_id" text NOT NULL,
	"engagement_id" text,
	"user_id" text NOT NULL,
	"task_description" text NOT NULL,
	"hours" numeric NOT NULL,
	"spent_on" date NOT NULL,
	"billable" boolean DEFAULT true NOT NULL,
	"is_running" boolean DEFAULT false NOT NULL,
	"started_at" timestamp,
	"hourly_rate_snapshot" numeric,
	"invoice_line_item_id" text,
	"created_at" timestamp DEFAULT now() NOT NULL,
	"updated_at" timestamp DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "compliance"."fm_amc_contracts" (
	"id" text PRIMARY KEY NOT NULL,
	"org_id" text NOT NULL,
	"asset_id" text NOT NULL,
	"vendor_id" text NOT NULL,
	"contract_start_date" date NOT NULL,
	"contract_end_date" date NOT NULL,
	"payment_frequency" "compliance"."fm_amc_payment_frequency" NOT NULL,
	"contracted_yearly_service_count" integer NOT NULL,
	"first_service_date" date,
	"contract_value" numeric,
	"status" text DEFAULT 'active' NOT NULL,
	"notes" text,
	"created_by_id" text,
	"created_at" timestamp DEFAULT now() NOT NULL,
	"updated_at" timestamp DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "compliance"."fm_asset_categories" (
	"id" text PRIMARY KEY NOT NULL,
	"category_key" text NOT NULL,
	"display_name" text NOT NULL,
	"typical_spec_unit" text,
	"is_active" boolean DEFAULT true NOT NULL,
	"created_at" timestamp DEFAULT now() NOT NULL,
	CONSTRAINT "fm_asset_categories_category_key_unique" UNIQUE("category_key")
);
--> statement-breakpoint
CREATE TABLE "compliance"."fm_asset_duplicate_candidates" (
	"id" text PRIMARY KEY NOT NULL,
	"org_id" text NOT NULL,
	"asset_id_a" text NOT NULL,
	"asset_id_b" text NOT NULL,
	"match_score" numeric NOT NULL,
	"match_reason" text NOT NULL,
	"status" text DEFAULT 'pending' NOT NULL,
	"reviewed_by_id" text,
	"reviewed_at" timestamp,
	"created_at" timestamp DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "compliance"."fm_assets" (
	"id" text PRIMARY KEY NOT NULL,
	"org_id" text NOT NULL,
	"location_label" text,
	"category_id" text NOT NULL,
	"asset_name" text NOT NULL,
	"normalized_name" text NOT NULL,
	"asset_code" text,
	"capacity_spec" text,
	"make" text,
	"model" text,
	"serial_number" text,
	"installed_date" date,
	"status" text DEFAULT 'active' NOT NULL,
	"qr_code_value" text,
	"amc_contract_id" text,
	"notes" text,
	"is_duplicate_of" text,
	"source_type" text DEFAULT 'manual' NOT NULL,
	"source_document_id" text,
	"created_by_id" text,
	"created_at" timestamp DEFAULT now() NOT NULL,
	"updated_at" timestamp DEFAULT now() NOT NULL,
	CONSTRAINT "fm_assets_qr_code_value_unique" UNIQUE("qr_code_value")
);
--> statement-breakpoint
CREATE TABLE "compliance"."fm_checklist_template_items" (
	"id" text PRIMARY KEY NOT NULL,
	"template_id" text NOT NULL,
	"sequence_order" integer DEFAULT 0 NOT NULL,
	"item_text" text NOT NULL,
	"item_type" text DEFAULT 'checkbox' NOT NULL,
	"is_mandatory" boolean DEFAULT true NOT NULL,
	"created_at" timestamp DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "compliance"."fm_checklist_templates" (
	"id" text PRIMARY KEY NOT NULL,
	"org_id" text,
	"category_id" text NOT NULL,
	"frequency" "compliance"."fm_ppm_frequency" NOT NULL,
	"name" text NOT NULL,
	"description" text,
	"is_active" boolean DEFAULT true NOT NULL,
	"created_by_id" text,
	"created_at" timestamp DEFAULT now() NOT NULL,
	"updated_at" timestamp DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "compliance"."fm_ppm_occurrence_item_results" (
	"id" text PRIMARY KEY NOT NULL,
	"occurrence_id" text NOT NULL,
	"template_item_id" text NOT NULL,
	"is_checked" boolean DEFAULT false NOT NULL,
	"numeric_value" numeric,
	"text_note" text,
	"org_id" text NOT NULL,
	"completed_at" timestamp,
	"created_at" timestamp DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "compliance"."fm_ppm_occurrences" (
	"id" text PRIMARY KEY NOT NULL,
	"org_id" text NOT NULL,
	"schedule_id" text NOT NULL,
	"asset_id" text NOT NULL,
	"due_date" date NOT NULL,
	"status" "compliance"."fm_ppm_occurrence_status" DEFAULT 'due' NOT NULL,
	"assignee_id" text,
	"started_at" timestamp,
	"completed_at" timestamp,
	"completed_by_id" text,
	"completion_notes" text,
	"overdue_notified_at" timestamp,
	"created_at" timestamp DEFAULT now() NOT NULL,
	"updated_at" timestamp DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "compliance"."fm_ppm_schedules" (
	"id" text PRIMARY KEY NOT NULL,
	"org_id" text NOT NULL,
	"asset_id" text NOT NULL,
	"checklist_template_id" text NOT NULL,
	"is_active" boolean DEFAULT true NOT NULL,
	"next_due_date" date NOT NULL,
	"last_generated_occurrence_id" text,
	"default_assignee_id" text,
	"created_by_id" text,
	"created_at" timestamp DEFAULT now() NOT NULL,
	"updated_at" timestamp DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "compliance"."fm_register_digitization_batches" (
	"id" text PRIMARY KEY NOT NULL,
	"org_id" text NOT NULL,
	"source_document_id" text NOT NULL,
	"source_type" text NOT NULL,
	"status" text DEFAULT 'extracted' NOT NULL,
	"total_rows_extracted" integer DEFAULT 0 NOT NULL,
	"total_rows_committed" integer DEFAULT 0 NOT NULL,
	"created_by_id" text NOT NULL,
	"created_at" timestamp DEFAULT now() NOT NULL,
	"reviewed_at" timestamp
);
--> statement-breakpoint
CREATE TABLE "compliance"."fm_register_digitization_rows" (
	"id" text PRIMARY KEY NOT NULL,
	"batch_id" text NOT NULL,
	"org_id" text NOT NULL,
	"source_row_number" integer,
	"extracted_data" jsonb NOT NULL,
	"confidence" numeric,
	"review_status" text DEFAULT 'pending' NOT NULL,
	"edited_data" jsonb,
	"committed_asset_id" text,
	"created_at" timestamp DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "compliance"."fm_visitor_logs" (
	"id" text PRIMARY KEY NOT NULL,
	"org_id" text NOT NULL,
	"visitor_id" text NOT NULL,
	"host_user_id" text NOT NULL,
	"purpose" text,
	"check_in_at" timestamp DEFAULT now() NOT NULL,
	"check_out_at" timestamp,
	"status" "compliance"."fm_visitor_log_status" DEFAULT 'checked_in' NOT NULL,
	"host_notified_at" timestamp,
	"logged_by_id" text,
	"created_at" timestamp DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "compliance"."fm_visitors" (
	"id" text PRIMARY KEY NOT NULL,
	"org_id" text NOT NULL,
	"full_name" text NOT NULL,
	"phone_number" text,
	"id_type" text,
	"id_number_last4" text,
	"company_or_org" text,
	"created_at" timestamp DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "compliance"."forge_project_requests" (
	"id" text PRIMARY KEY NOT NULL,
	"visitor_id" text NOT NULL,
	"selection_path" jsonb DEFAULT '[]'::jsonb NOT NULL,
	"selection_labels" jsonb DEFAULT '[]'::jsonb NOT NULL,
	"notes" text,
	"email" text,
	"status" text DEFAULT 'draft' NOT NULL,
	"confirm_token" text,
	"email_confirmed_at" timestamp,
	"submitted_at" timestamp,
	"created_at" timestamp DEFAULT now() NOT NULL,
	"updated_at" timestamp DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "compliance"."framework_controls" (
	"id" text PRIMARY KEY NOT NULL,
	"framework_id" text NOT NULL,
	"control_ref" text NOT NULL,
	"title" text NOT NULL,
	"status" text DEFAULT 'not_started' NOT NULL,
	"org_id" text NOT NULL,
	"client_id" text,
	"created_at" timestamp DEFAULT now() NOT NULL,
	"updated_at" timestamp DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "compliance"."fraud_cases" (
	"id" text PRIMARY KEY NOT NULL,
	"org_id" text NOT NULL,
	"case_number" integer NOT NULL,
	"title" text NOT NULL,
	"fraud_type" text DEFAULT 'other' NOT NULL,
	"detection_source" text DEFAULT 'other' NOT NULL,
	"description" text,
	"financial_exposure" numeric,
	"status" text DEFAULT 'reported' NOT NULL,
	"reported_date" date NOT NULL,
	"investigator_id" text,
	"resolution_summary" text,
	"resolved_date" date,
	"linked_risk_id" text,
	"client_id" text,
	"recorded_by_id" text NOT NULL,
	"created_at" timestamp DEFAULT now() NOT NULL,
	"updated_at" timestamp DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "compliance"."gst_ai_review_reports" (
	"id" text PRIMARY KEY NOT NULL,
	"org_id" text NOT NULL,
	"return_period_id" text NOT NULL,
	"report_text" text NOT NULL,
	"risk_flags" jsonb DEFAULT '[]'::jsonb NOT NULL,
	"provider" text,
	"model" text,
	"created_at" timestamp DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "compliance"."gst_canonical_invoice_items" (
	"id" text PRIMARY KEY NOT NULL,
	"invoice_id" text NOT NULL,
	"hsn_sac_code" text,
	"description" text,
	"quantity" numeric DEFAULT '1' NOT NULL,
	"rate" numeric DEFAULT '0' NOT NULL,
	"taxable_value" numeric DEFAULT '0' NOT NULL,
	"gst_rate_percent" numeric DEFAULT '0' NOT NULL,
	"cgst_amount" numeric DEFAULT '0' NOT NULL,
	"sgst_amount" numeric DEFAULT '0' NOT NULL,
	"igst_amount" numeric DEFAULT '0' NOT NULL
);
--> statement-breakpoint
CREATE TABLE "compliance"."gst_canonical_invoices" (
	"id" text PRIMARY KEY NOT NULL,
	"org_id" text NOT NULL,
	"client_id" text,
	"batch_id" text,
	"direction" "compliance"."gst_invoice_direction" NOT NULL,
	"period" text NOT NULL,
	"source_type" "compliance"."gst_source_type" NOT NULL,
	"counterparty_gstin" text,
	"counterparty_name" text,
	"invoice_number" text NOT NULL,
	"invoice_date" date NOT NULL,
	"place_of_supply" text,
	"invoice_type" text DEFAULT 'b2b' NOT NULL,
	"taxable_value" numeric DEFAULT '0' NOT NULL,
	"cgst_amount" numeric DEFAULT '0' NOT NULL,
	"sgst_amount" numeric DEFAULT '0' NOT NULL,
	"igst_amount" numeric DEFAULT '0' NOT NULL,
	"cess_amount" numeric DEFAULT '0' NOT NULL,
	"total_value" numeric DEFAULT '0' NOT NULL,
	"created_at" timestamp DEFAULT now() NOT NULL,
	"updated_at" timestamp DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "compliance"."gst_gstin_master" (
	"id" text PRIMARY KEY NOT NULL,
	"gstin" text NOT NULL,
	"checksum_valid" boolean NOT NULL,
	"legal_name" text,
	"trade_name" text,
	"state_code" text,
	"lookup_status" text,
	"last_checked_at" timestamp,
	"created_at" timestamp DEFAULT now() NOT NULL,
	CONSTRAINT "gst_gstin_master_gstin_unique" UNIQUE("gstin")
);
--> statement-breakpoint
CREATE TABLE "compliance"."gst_hsn_master" (
	"id" text PRIMARY KEY NOT NULL,
	"hsn_sac_code" text NOT NULL,
	"description" text,
	"default_gst_rate_percent" numeric,
	"is_service" boolean DEFAULT false NOT NULL,
	"created_at" timestamp DEFAULT now() NOT NULL,
	CONSTRAINT "gst_hsn_master_hsn_sac_code_unique" UNIQUE("hsn_sac_code")
);
--> statement-breakpoint
CREATE TABLE "compliance"."gst_import_batches" (
	"id" text PRIMARY KEY NOT NULL,
	"org_id" text NOT NULL,
	"client_id" text,
	"source_type" "compliance"."gst_source_type" NOT NULL,
	"direction" "compliance"."gst_invoice_direction" NOT NULL,
	"period" text NOT NULL,
	"file_name" text NOT NULL,
	"file_type" text NOT NULL,
	"file_size_bytes" integer,
	"status" "compliance"."gst_import_batch_status" DEFAULT 'processing' NOT NULL,
	"total_rows" integer,
	"staged_count" integer,
	"confirmed_count" integer,
	"error_message" text,
	"uploaded_by_id" text NOT NULL,
	"created_at" timestamp DEFAULT now() NOT NULL,
	"confirmed_at" timestamp,
	"cancelled_at" timestamp
);
--> statement-breakpoint
CREATE TABLE "compliance"."gst_import_staging_rows" (
	"id" text PRIMARY KEY NOT NULL,
	"batch_id" text NOT NULL,
	"source_row" integer,
	"raw_data" jsonb NOT NULL,
	"mapped_data" jsonb NOT NULL,
	"mapping_confidence" numeric,
	"created_at" timestamp DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "compliance"."gst_reconciliation_matches" (
	"id" text PRIMARY KEY NOT NULL,
	"run_id" text NOT NULL,
	"purchase_invoice_id" text,
	"gstr2b_invoice_id" text,
	"match_type" "compliance"."gst_match_type" NOT NULL,
	"confidence_score" numeric,
	"delta_amount" numeric,
	"notes" text,
	"created_at" timestamp DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "compliance"."gst_reconciliation_runs" (
	"id" text PRIMARY KEY NOT NULL,
	"org_id" text NOT NULL,
	"client_id" text,
	"period" text NOT NULL,
	"purchase_batch_id" text,
	"gstr2b_batch_id" text,
	"status" text DEFAULT 'running' NOT NULL,
	"total_purchase_rows" integer,
	"total_2b_rows" integer,
	"exact_matches" integer,
	"probable_matches" integer,
	"mismatches" integer,
	"missing_in_2b" integer,
	"missing_in_books" integer,
	"created_at" timestamp DEFAULT now() NOT NULL,
	"completed_at" timestamp
);
--> statement-breakpoint
CREATE TABLE "compliance"."gst_return_periods" (
	"id" text PRIMARY KEY NOT NULL,
	"org_id" text NOT NULL,
	"client_id" text,
	"period" text NOT NULL,
	"gstin" text NOT NULL,
	"return_type" "compliance"."gst_return_type" NOT NULL,
	"status" "compliance"."gst_return_status" DEFAULT 'draft' NOT NULL,
	"generated_json" jsonb,
	"summary" jsonb,
	"generated_by_id" text,
	"generated_at" timestamp,
	"filed_at" timestamp,
	"created_at" timestamp DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "compliance"."gst_source_profiles" (
	"id" text PRIMARY KEY NOT NULL,
	"org_id" text NOT NULL,
	"client_id" text,
	"source_type" "compliance"."gst_source_type" NOT NULL,
	"name" text DEFAULT 'Default' NOT NULL,
	"column_mapping" jsonb DEFAULT '{}'::jsonb NOT NULL,
	"created_at" timestamp DEFAULT now() NOT NULL,
	"updated_at" timestamp DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "compliance"."gst_validation_findings" (
	"id" text PRIMARY KEY NOT NULL,
	"org_id" text NOT NULL,
	"batch_id" text,
	"invoice_id" text,
	"rule_code" text NOT NULL,
	"severity" "compliance"."gst_finding_severity" NOT NULL,
	"message" text NOT NULL,
	"suggested_fix" text,
	"created_at" timestamp DEFAULT now() NOT NULL,
	"resolved_at" timestamp
);
--> statement-breakpoint
CREATE TABLE "compliance"."holiday_list_filings" (
	"id" text PRIMARY KEY NOT NULL,
	"state" text NOT NULL,
	"year" text NOT NULL,
	"status" text DEFAULT 'pending_filing' NOT NULL,
	"org_id" text NOT NULL,
	"client_id" text,
	"created_at" timestamp DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "compliance"."hr_attendance_records" (
	"id" text PRIMARY KEY NOT NULL,
	"org_id" text NOT NULL,
	"company_id" text,
	"user_id" text NOT NULL,
	"date" date NOT NULL,
	"status" "compliance"."hr_attendance_status" DEFAULT 'present' NOT NULL,
	"check_in_at" timestamp,
	"check_out_at" timestamp,
	"hours_worked" numeric,
	"leave_request_id" text,
	"marked_by_id" text NOT NULL,
	"source" text DEFAULT 'self' NOT NULL,
	"notes" text,
	"created_at" timestamp DEFAULT now() NOT NULL,
	"updated_at" timestamp DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "compliance"."hr_compliance_items" (
	"id" text PRIMARY KEY NOT NULL,
	"item" text NOT NULL,
	"governing_law" text,
	"state" text DEFAULT 'All India' NOT NULL,
	"due_date" timestamp,
	"status" text DEFAULT 'not_due_yet' NOT NULL,
	"org_id" text NOT NULL,
	"client_id" text,
	"created_at" timestamp DEFAULT now() NOT NULL,
	"updated_at" timestamp DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "compliance"."hr_holidays" (
	"id" text PRIMARY KEY NOT NULL,
	"org_id" text NOT NULL,
	"date" date NOT NULL,
	"name" text NOT NULL,
	"created_at" timestamp DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "compliance"."incidents" (
	"id" text PRIMARY KEY NOT NULL,
	"title" text NOT NULL,
	"category" text NOT NULL,
	"severity" text DEFAULT 'medium' NOT NULL,
	"classification" text DEFAULT 'department' NOT NULL,
	"stage" "compliance"."incident_stage" DEFAULT 'logged' NOT NULL,
	"linked_risk_id" text,
	"linked_control_id" text,
	"regulatory_notify_required" boolean DEFAULT false NOT NULL,
	"notify_deadline" text,
	"notified" boolean DEFAULT false NOT NULL,
	"capa_owner_id" text,
	"capa_due_date" timestamp,
	"closed_date" timestamp,
	"org_id" text NOT NULL,
	"client_id" text,
	"reported_by_id" text NOT NULL,
	"created_at" timestamp DEFAULT now() NOT NULL,
	"updated_at" timestamp DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "compliance"."ingestion_batches" (
	"id" text PRIMARY KEY NOT NULL,
	"file_name" text NOT NULL,
	"file_type" text NOT NULL,
	"file_size_bytes" integer,
	"file_url" text,
	"org_id" text NOT NULL,
	"uploaded_by_id" text NOT NULL,
	"status" "compliance"."ingestion_batch_status" DEFAULT 'processing' NOT NULL,
	"total_rows" integer,
	"extracted_count" integer,
	"approved_count" integer,
	"rejected_count" integer,
	"confirmed_count" integer,
	"ai_model" text,
	"extraction_summary" text,
	"error_message" text,
	"created_at" timestamp DEFAULT now() NOT NULL,
	"confirmed_at" timestamp,
	"cancelled_at" timestamp
);
--> statement-breakpoint
CREATE TABLE "compliance"."ingestion_items" (
	"id" text PRIMARY KEY NOT NULL,
	"batch_id" text NOT NULL,
	"source_row" integer,
	"title" text,
	"compliance_type" text,
	"due_date" text,
	"status" text DEFAULT 'pending',
	"priority" text DEFAULT 'medium',
	"department_name" text,
	"department_id" text,
	"assigned_to_name" text,
	"assigned_to_id" text,
	"description" text,
	"extra_data" text,
	"confidence" text DEFAULT '0',
	"review_status" "compliance"."ingestion_item_status" DEFAULT 'pending' NOT NULL,
	"warnings" text,
	"missing_fields" text,
	"is_duplicate" boolean DEFAULT false,
	"duplicate_of_id" text,
	"created_item_id" text,
	"created_at" timestamp DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "compliance"."installed_products" (
	"id" text PRIMARY KEY NOT NULL,
	"org_id" text NOT NULL,
	"client_id" text,
	"product_name" text NOT NULL,
	"serial_number" text,
	"installed_at" date,
	"warranty_expires_at" date,
	"notes" text,
	"created_by_id" text,
	"created_at" timestamp DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "compliance"."instruction_commitments" (
	"id" text PRIMARY KEY NOT NULL,
	"org_id" text NOT NULL,
	"client_id" text,
	"message_id" text NOT NULL,
	"assigner_id" text NOT NULL,
	"assignee_id" text NOT NULL,
	"described_action" text NOT NULL,
	"due_date" timestamp,
	"status" text DEFAULT 'pending' NOT NULL,
	"created_at" timestamp DEFAULT now() NOT NULL,
	"updated_at" timestamp DEFAULT now() NOT NULL,
	CONSTRAINT "instruction_commitments_message_id_unique" UNIQUE("message_id")
);
--> statement-breakpoint
CREATE TABLE "platform"."instruction_execution_cache" (
	"id" text PRIMARY KEY NOT NULL,
	"org_id" text,
	"instruction_text" text NOT NULL,
	"content_hash" text NOT NULL,
	"resolved_capability_type" text,
	"resolved_capability_id" text,
	"resolved_label" text,
	"resolved_params_shape" jsonb,
	"success_count" integer DEFAULT 1 NOT NULL,
	"last_used_at" timestamp DEFAULT now() NOT NULL,
	"created_at" timestamp DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "compliance"."instruction_mismatch_detections" (
	"id" text PRIMARY KEY NOT NULL,
	"commitment_id" text NOT NULL,
	"detected_at" timestamp DEFAULT now() NOT NULL,
	"comparison_summary" text NOT NULL,
	"related_task_id" text,
	"resolution" text DEFAULT 'unresolved' NOT NULL,
	"resolved_at" timestamp,
	"resolved_by_user_id" text,
	"created_at" timestamp DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "compliance"."instruction_packages" (
	"id" text PRIMARY KEY NOT NULL,
	"capability_id" text NOT NULL,
	"package_type" text NOT NULL,
	"version" integer DEFAULT 1 NOT NULL,
	"status" text DEFAULT 'draft' NOT NULL,
	"steps" jsonb NOT NULL,
	"required_variables" jsonb,
	"created_by_role" text,
	"approved_at" timestamp,
	"success_rate" integer,
	"usage_count" integer DEFAULT 0 NOT NULL,
	"last_used_at" timestamp,
	"created_at" timestamp DEFAULT now() NOT NULL,
	"updated_at" timestamp DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "compliance"."interior_ffe_items" (
	"id" text PRIMARY KEY NOT NULL,
	"org_id" text NOT NULL,
	"project_id" text NOT NULL,
	"room_or_area" text,
	"category" "compliance"."interior_ffe_category" DEFAULT 'furniture' NOT NULL,
	"item_name" text NOT NULL,
	"description" text,
	"vendor_id" text,
	"sku" text,
	"quantity" integer DEFAULT 1 NOT NULL,
	"unit_cost" numeric DEFAULT '0' NOT NULL,
	"unit_price" numeric DEFAULT '0' NOT NULL,
	"lead_time_days" integer,
	"status" "compliance"."interior_ffe_status" DEFAULT 'specified' NOT NULL,
	"document_id" text,
	"width_cm" numeric,
	"depth_cm" numeric,
	"height_cm" numeric,
	"created_by_id" text NOT NULL,
	"created_at" timestamp DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "compliance"."interior_floor_plan_rooms" (
	"id" text PRIMARY KEY NOT NULL,
	"floor_plan_id" text NOT NULL,
	"name" text NOT NULL,
	"polygon" jsonb NOT NULL,
	"ceiling_height_cm" numeric DEFAULT '270' NOT NULL,
	"floor_material_id" text,
	"wall_material_id" text,
	"ceiling_material_id" text,
	"sort_order" integer DEFAULT 0 NOT NULL,
	"created_at" timestamp DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "compliance"."interior_floor_plans" (
	"id" text PRIMARY KEY NOT NULL,
	"org_id" text NOT NULL,
	"project_id" text NOT NULL,
	"name" text NOT NULL,
	"floor_level" text,
	"status" text DEFAULT 'draft' NOT NULL,
	"created_by_id" text NOT NULL,
	"created_at" timestamp DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "compliance"."interior_furniture_placements" (
	"id" text PRIMARY KEY NOT NULL,
	"floor_plan_id" text NOT NULL,
	"room_id" text,
	"ffe_item_id" text NOT NULL,
	"x" numeric DEFAULT '0' NOT NULL,
	"y" numeric DEFAULT '0' NOT NULL,
	"rotation_deg" numeric DEFAULT '0' NOT NULL,
	"created_at" timestamp DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "compliance"."interior_materials" (
	"id" text PRIMARY KEY NOT NULL,
	"org_id" text NOT NULL,
	"name" text NOT NULL,
	"category" "compliance"."interior_material_category" NOT NULL,
	"color_hex" text DEFAULT '#cccccc' NOT NULL,
	"texture_document_id" text,
	"roughness" numeric DEFAULT '0.8' NOT NULL,
	"metalness" numeric DEFAULT '0' NOT NULL,
	"created_at" timestamp DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "compliance"."interior_mood_board_items" (
	"id" text PRIMARY KEY NOT NULL,
	"mood_board_id" text NOT NULL,
	"document_id" text,
	"label" text,
	"notes" text,
	"sort_order" integer DEFAULT 0 NOT NULL,
	"created_at" timestamp DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "compliance"."interior_mood_boards" (
	"id" text PRIMARY KEY NOT NULL,
	"org_id" text NOT NULL,
	"project_id" text NOT NULL,
	"room_or_area" text,
	"title" text NOT NULL,
	"description" text,
	"status" "compliance"."interior_mood_board_status" DEFAULT 'draft' NOT NULL,
	"created_by_id" text NOT NULL,
	"created_at" timestamp DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "compliance"."interview_feedback" (
	"id" text PRIMARY KEY NOT NULL,
	"org_id" text NOT NULL,
	"application_id" text NOT NULL,
	"interviewer_id" text NOT NULL,
	"round_name" text NOT NULL,
	"scheduled_at" timestamp NOT NULL,
	"rating" integer,
	"recommendation" "compliance"."interview_recommendation",
	"feedback" text,
	"completed_at" timestamp,
	"created_at" timestamp DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "compliance"."ip_portfolio" (
	"id" text PRIMARY KEY NOT NULL,
	"mark" text NOT NULL,
	"ip_type" text,
	"status" text DEFAULT 'application_filed' NOT NULL,
	"renewal_date" timestamp,
	"class_description" text,
	"matter_id" text,
	"org_id" text NOT NULL,
	"client_id" text,
	"created_at" timestamp DEFAULT now() NOT NULL,
	"updated_at" timestamp DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "compliance"."irdai_compliance_items" (
	"id" text PRIMARY KEY NOT NULL,
	"requirement" text NOT NULL,
	"category" text,
	"status" text DEFAULT 'not_started' NOT NULL,
	"org_id" text NOT NULL,
	"client_id" text,
	"created_at" timestamp DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "compliance"."it_dr_backup_verifications" (
	"id" text PRIMARY KEY NOT NULL,
	"dr_plan_id" text NOT NULL,
	"verification_date" date NOT NULL,
	"status" text DEFAULT 'success' NOT NULL,
	"notes" text,
	"verified_by_id" text,
	"created_at" timestamp DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "compliance"."it_dr_failover_tests" (
	"id" text PRIMARY KEY NOT NULL,
	"dr_plan_id" text NOT NULL,
	"test_date" date NOT NULL,
	"test_type" text DEFAULT 'tabletop' NOT NULL,
	"outcome" text DEFAULT 'passed' NOT NULL,
	"findings" text,
	"conducted_by_id" text,
	"created_at" timestamp DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "compliance"."it_dr_plans" (
	"id" text PRIMARY KEY NOT NULL,
	"org_id" text NOT NULL,
	"system_name" text NOT NULL,
	"system_description" text,
	"criticality_level" text DEFAULT 'medium' NOT NULL,
	"rto_hours" numeric NOT NULL,
	"rpo_hours" numeric NOT NULL,
	"backup_frequency" text DEFAULT 'daily' NOT NULL,
	"status" text DEFAULT 'active' NOT NULL,
	"owner_id" text,
	"client_id" text,
	"created_at" timestamp DEFAULT now() NOT NULL,
	"updated_at" timestamp DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "compliance"."job_applications" (
	"id" text PRIMARY KEY NOT NULL,
	"org_id" text NOT NULL,
	"job_opening_id" text NOT NULL,
	"candidate_id" text NOT NULL,
	"stage" "compliance"."application_stage" DEFAULT 'applied' NOT NULL,
	"rejected_reason" text,
	"offer_amount" numeric,
	"offer_accepted_at" timestamp,
	"hired_employee_profile_id" text,
	"created_at" timestamp DEFAULT now() NOT NULL,
	"updated_at" timestamp DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "compliance"."job_openings" (
	"id" text PRIMARY KEY NOT NULL,
	"org_id" text NOT NULL,
	"title" text NOT NULL,
	"department_id" text,
	"job_description" text,
	"employment_type" text DEFAULT 'full_time' NOT NULL,
	"num_positions" integer DEFAULT 1 NOT NULL,
	"status" "compliance"."job_opening_status" DEFAULT 'open' NOT NULL,
	"posted_by_id" text NOT NULL,
	"created_at" timestamp DEFAULT now() NOT NULL,
	"closed_at" timestamp
);
--> statement-breakpoint
CREATE TABLE "compliance"."knowledge_base_pages" (
	"id" text PRIMARY KEY NOT NULL,
	"org_id" text NOT NULL,
	"parent_page_id" text,
	"slug" text NOT NULL,
	"title" text NOT NULL,
	"content" text,
	"version" integer DEFAULT 1 NOT NULL,
	"updated_by_id" text,
	"is_archived" boolean DEFAULT false NOT NULL,
	"created_at" timestamp DEFAULT now() NOT NULL,
	"updated_at" timestamp DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "compliance"."knowledge_flow_log" (
	"id" text PRIMARY KEY NOT NULL,
	"direction" text NOT NULL,
	"from_tier" text NOT NULL,
	"to_tier" text NOT NULL,
	"source_agent_id" text,
	"target_agent_id" text,
	"knowledge_type" text NOT NULL,
	"content_summary" text,
	"is_anonymized" boolean DEFAULT false NOT NULL,
	"anonymization_method" text,
	"org_id" text,
	"created_at" timestamp DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "compliance"."leave_balances" (
	"id" text PRIMARY KEY NOT NULL,
	"org_id" text NOT NULL,
	"user_id" text NOT NULL,
	"leave_type" text NOT NULL,
	"year" integer NOT NULL,
	"total_days" numeric DEFAULT '0' NOT NULL,
	"used_days" numeric DEFAULT '0' NOT NULL,
	"created_at" timestamp DEFAULT now() NOT NULL,
	"updated_at" timestamp DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "compliance"."leave_policy_entries" (
	"id" text PRIMARY KEY NOT NULL,
	"leave_type" text NOT NULL,
	"governing_law" text,
	"entitlement" text,
	"org_id" text NOT NULL,
	"client_id" text,
	"created_at" timestamp DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "compliance"."leave_requests" (
	"id" text PRIMARY KEY NOT NULL,
	"org_id" text NOT NULL,
	"user_id" text NOT NULL,
	"company_id" text,
	"leave_type" text NOT NULL,
	"start_date" date NOT NULL,
	"end_date" date NOT NULL,
	"num_days" numeric NOT NULL,
	"reason" text,
	"status" text DEFAULT 'pending' NOT NULL,
	"approver_id" text,
	"approved_at" timestamp,
	"created_at" timestamp DEFAULT now() NOT NULL,
	"updated_at" timestamp DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "compliance"."legal_arbitration_cases" (
	"id" text PRIMARY KEY NOT NULL,
	"matter_id" text NOT NULL,
	"case_title" text NOT NULL,
	"arbitration_institution" text,
	"arbitrator" text,
	"status" text DEFAULT 'filed' NOT NULL,
	"filing_date" date,
	"award_date" date,
	"claim_amount" numeric,
	"created_at" timestamp DEFAULT now() NOT NULL,
	"updated_at" timestamp DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "compliance"."legal_matters" (
	"id" text PRIMARY KEY NOT NULL,
	"org_id" text NOT NULL,
	"matter_number" integer NOT NULL,
	"title" text NOT NULL,
	"matter_type" text DEFAULT 'general' NOT NULL,
	"status" text DEFAULT 'open' NOT NULL,
	"description" text,
	"responsible_user_id" text,
	"opened_date" date NOT NULL,
	"closed_date" date,
	"client_id" text,
	"created_by_id" text,
	"created_at" timestamp DEFAULT now() NOT NULL,
	"updated_at" timestamp DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "compliance"."legal_opinions" (
	"id" text PRIMARY KEY NOT NULL,
	"topic" text NOT NULL,
	"opinion_date" timestamp,
	"advisor" text,
	"linked_risk_id" text,
	"matter_id" text,
	"template_id" text,
	"body_text" text,
	"generated_at" timestamp,
	"org_id" text NOT NULL,
	"client_id" text,
	"created_at" timestamp DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "compliance"."legal_spend_entries" (
	"id" text PRIMARY KEY NOT NULL,
	"matter_id" text NOT NULL,
	"description" text NOT NULL,
	"category" text DEFAULT 'legal_fees' NOT NULL,
	"amount" numeric NOT NULL,
	"spend_date" date NOT NULL,
	"vendor_id" text,
	"created_by_id" text,
	"created_at" timestamp DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "compliance"."legal_vendors" (
	"id" text PRIMARY KEY NOT NULL,
	"name" text NOT NULL,
	"vendor_type" text,
	"engagement_type" text,
	"current_matter" text,
	"status" text DEFAULT 'active' NOT NULL,
	"fee" numeric(14, 2),
	"org_id" text NOT NULL,
	"client_id" text,
	"created_at" timestamp DEFAULT now() NOT NULL,
	"updated_at" timestamp DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "compliance"."litigation_matters" (
	"id" text PRIMARY KEY NOT NULL,
	"matter" text NOT NULL,
	"matter_type" text,
	"forum" text,
	"stage" "compliance"."litigation_stage" DEFAULT 'filed' NOT NULL,
	"next_hearing_date" timestamp,
	"counsel" text,
	"amount" numeric(14, 2),
	"linked_notice_id" text,
	"matter_id" text,
	"org_id" text NOT NULL,
	"client_id" text,
	"created_at" timestamp DEFAULT now() NOT NULL,
	"updated_at" timestamp DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "compliance"."llm_response_cache" (
	"id" text PRIMARY KEY NOT NULL,
	"cache_key" text NOT NULL,
	"content" text NOT NULL,
	"prompt_tokens" integer DEFAULT 0 NOT NULL,
	"completion_tokens" integer DEFAULT 0 NOT NULL,
	"created_at" timestamp DEFAULT now() NOT NULL,
	"expires_at" timestamp NOT NULL,
	CONSTRAINT "llm_response_cache_cache_key_unique" UNIQUE("cache_key")
);
--> statement-breakpoint
CREATE TABLE "compliance"."loop_definitions" (
	"id" text PRIMARY KEY NOT NULL,
	"loop_number" integer NOT NULL,
	"loop_name" text NOT NULL,
	"description" text,
	"observe_what" text,
	"analyze_how" text,
	"act_what" text,
	"measure_what" text,
	"target_orchestra_layers" text[] DEFAULT '{}' NOT NULL,
	"execution_frequency" text,
	"is_active" boolean DEFAULT false NOT NULL,
	"created_at" timestamp DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "compliance"."loop_executions" (
	"id" text PRIMARY KEY NOT NULL,
	"loop_id" text NOT NULL,
	"triggered_by" text NOT NULL,
	"observation_data" jsonb DEFAULT '{}'::jsonb NOT NULL,
	"analysis_result" jsonb DEFAULT '{}'::jsonb NOT NULL,
	"action_taken" jsonb DEFAULT '{}'::jsonb NOT NULL,
	"measurement_result" jsonb DEFAULT '{}'::jsonb NOT NULL,
	"improvement_delta" numeric,
	"execution_time_ms" integer,
	"created_at" timestamp DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "compliance"."loop_health_metrics" (
	"id" text PRIMARY KEY NOT NULL,
	"loop_id" text NOT NULL,
	"date" date NOT NULL,
	"executions_count" integer DEFAULT 0 NOT NULL,
	"improvements_generated" integer DEFAULT 0 NOT NULL,
	"improvements_deployed" integer DEFAULT 0 NOT NULL,
	"improvements_rolled_back" integer DEFAULT 0 NOT NULL,
	"avg_improvement_delta" numeric,
	"system_health_score" numeric
);
--> statement-breakpoint
CREATE TABLE "compliance"."loop_improvements" (
	"id" text PRIMARY KEY NOT NULL,
	"loop_id" text NOT NULL,
	"improvement_type" text NOT NULL,
	"target_type" text NOT NULL,
	"target_id" text,
	"before_state" jsonb,
	"after_state" jsonb,
	"improvement_delta" numeric,
	"is_deployed" boolean DEFAULT false NOT NULL,
	"deployed_at" timestamp,
	"rollback_triggered" boolean DEFAULT false NOT NULL,
	"created_at" timestamp DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "compliance"."mca_filings" (
	"id" text PRIMARY KEY NOT NULL,
	"form_type" text NOT NULL,
	"description" text,
	"due_date" timestamp,
	"status" text DEFAULT 'preparing' NOT NULL,
	"srn" text,
	"filed_date" timestamp,
	"form_data" jsonb,
	"generated_at" timestamp,
	"org_id" text NOT NULL,
	"client_id" text,
	"created_at" timestamp DEFAULT now() NOT NULL,
	"updated_at" timestamp DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "compliance"."mcp_access_codes" (
	"id" text PRIMARY KEY NOT NULL,
	"token" text NOT NULL,
	"org_id" text NOT NULL,
	"name" text DEFAULT 'Default' NOT NULL,
	"is_active" boolean DEFAULT true NOT NULL,
	"last_used_at" timestamp,
	"created_at" timestamp DEFAULT now() NOT NULL,
	CONSTRAINT "mcp_access_codes_token_unique" UNIQUE("token")
);
--> statement-breakpoint
CREATE TABLE "compliance"."mdm_duplicate_candidates" (
	"id" text PRIMARY KEY NOT NULL,
	"org_id" text NOT NULL,
	"entity_type" text NOT NULL,
	"entity_id_a" text NOT NULL,
	"entity_id_b" text NOT NULL,
	"match_score" numeric NOT NULL,
	"match_reason" text NOT NULL,
	"status" text DEFAULT 'pending' NOT NULL,
	"reviewed_by_id" text,
	"reviewed_at" timestamp,
	"created_at" timestamp DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "compliance"."mdm_merge_log" (
	"id" text PRIMARY KEY NOT NULL,
	"org_id" text NOT NULL,
	"entity_type" text NOT NULL,
	"surviving_entity_id" text NOT NULL,
	"merged_entity_id" text NOT NULL,
	"merged_by_id" text NOT NULL,
	"merged_at" timestamp DEFAULT now() NOT NULL,
	"created_at" timestamp DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "compliance"."message_attachments" (
	"id" text PRIMARY KEY NOT NULL,
	"message_id" text NOT NULL,
	"document_id" text NOT NULL,
	"created_at" timestamp DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "compliance"."messages" (
	"id" text PRIMARY KEY NOT NULL,
	"conversation_id" text NOT NULL,
	"sender_id" text,
	"content" text NOT NULL,
	"is_instruction" boolean DEFAULT false NOT NULL,
	"assistant_id" text,
	"source_platform" text,
	"source_ref" text,
	"guest_access_id" text,
	"confidence_label" text,
	"created_at" timestamp DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "compliance"."metric_alert_rules" (
	"id" text PRIMARY KEY NOT NULL,
	"org_id" text NOT NULL,
	"name" text NOT NULL,
	"source_entity" text NOT NULL,
	"filter_field" text,
	"filter_value" text,
	"operator" text DEFAULT 'gt' NOT NULL,
	"threshold" integer NOT NULL,
	"notify_user_ids" jsonb DEFAULT '[]'::jsonb NOT NULL,
	"is_active" boolean DEFAULT true NOT NULL,
	"last_triggered_at" timestamp,
	"created_by_id" text NOT NULL,
	"created_at" timestamp DEFAULT now() NOT NULL,
	"updated_at" timestamp DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "platform"."module_registry" (
	"id" text PRIMARY KEY NOT NULL,
	"module_key" text NOT NULL,
	"display_name" text NOT NULL,
	"table_name" text NOT NULL,
	"domain" text NOT NULL,
	"category" text,
	"description" text,
	"is_core" boolean DEFAULT false NOT NULL,
	"is_active" boolean DEFAULT true NOT NULL,
	"tool_type" text,
	"created_at" timestamp DEFAULT now() NOT NULL,
	"updated_at" timestamp DEFAULT now() NOT NULL,
	CONSTRAINT "module_registry_module_key_unique" UNIQUE("module_key")
);
--> statement-breakpoint
CREATE TABLE "platform"."module_rule_configs" (
	"id" text PRIMARY KEY NOT NULL,
	"module_key" text NOT NULL,
	"rule_key" text NOT NULL,
	"rule_value" jsonb DEFAULT '{}'::jsonb NOT NULL,
	"scope_type" text NOT NULL,
	"scope_id" text,
	"is_active" boolean DEFAULT true NOT NULL,
	"created_by_id" text,
	"created_at" timestamp DEFAULT now() NOT NULL,
	"updated_at" timestamp DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "compliance"."monitor_agents" (
	"id" text PRIMARY KEY NOT NULL,
	"name" text NOT NULL,
	"description" text,
	"event_types" text NOT NULL,
	"execution_tier" text DEFAULT 'rule_engine' NOT NULL,
	"owner" text NOT NULL,
	"report_to" text NOT NULL,
	"escalate_to" text NOT NULL,
	"escalation_level" integer DEFAULT 1 NOT NULL,
	"max_retry" integer DEFAULT 3 NOT NULL,
	"max_execution_time_ms" integer NOT NULL,
	"timeout_ms" integer NOT NULL,
	"failure_action" text DEFAULT 'escalate' NOT NULL,
	"success_action" text DEFAULT 'log_only' NOT NULL,
	"next_agent" text,
	"is_active" boolean DEFAULT true NOT NULL,
	"created_at" timestamp DEFAULT now() NOT NULL,
	"updated_at" timestamp DEFAULT now() NOT NULL,
	CONSTRAINT "monitor_agents_name_unique" UNIQUE("name")
);
--> statement-breakpoint
CREATE TABLE "compliance"."monitor_execution_log" (
	"id" text PRIMARY KEY NOT NULL,
	"monitor_name" text NOT NULL,
	"ran_at" timestamp DEFAULT now() NOT NULL,
	"checked" integer NOT NULL,
	"ok" integer NOT NULL,
	"escalated" integer NOT NULL,
	"invalid_reports" integer NOT NULL,
	"summary_text" text
);
--> statement-breakpoint
CREATE TABLE "compliance"."monitor_task_state" (
	"id" text PRIMARY KEY NOT NULL,
	"org_id" text NOT NULL,
	"task_id" text NOT NULL,
	"monitor_name" text NOT NULL,
	"owner_role_key" text NOT NULL,
	"rung_index" integer NOT NULL,
	"retry_count" integer DEFAULT 1 NOT NULL,
	"max_retry" integer NOT NULL,
	"timeout_ms" integer NOT NULL,
	"status" text DEFAULT 'active' NOT NULL,
	"last_escalated_at" timestamp DEFAULT now() NOT NULL,
	"created_at" timestamp DEFAULT now() NOT NULL,
	"updated_at" timestamp DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "compliance"."notice_dispatches" (
	"id" text PRIMARY KEY NOT NULL,
	"notice_id" text NOT NULL,
	"dispatch_method" text,
	"tracking_number" text,
	"courier_name" text,
	"dispatch_date" timestamp,
	"delivery_confirmed_date" timestamp,
	"proof_document_id" text,
	"org_id" text NOT NULL,
	"client_id" text,
	"recorded_by_id" text NOT NULL,
	"created_at" timestamp DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "compliance"."notices" (
	"id" text PRIMARY KEY NOT NULL,
	"notice_number" text,
	"authority" text,
	"date_received" timestamp NOT NULL,
	"demand_amount" numeric(14, 2),
	"reply_deadline" timestamp,
	"status" "compliance"."notice_status" DEFAULT 'received' NOT NULL,
	"description" text,
	"compliance_item_id" text,
	"department_id" text NOT NULL,
	"assigned_to_id" text,
	"org_id" text NOT NULL,
	"client_id" text,
	"created_at" timestamp DEFAULT now() NOT NULL,
	"updated_at" timestamp DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "compliance"."onboarding_steps" (
	"id" text PRIMARY KEY NOT NULL,
	"user_id" text NOT NULL,
	"step" text NOT NULL,
	"completed" boolean DEFAULT false NOT NULL,
	"completed_at" timestamp,
	"created_at" timestamp DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "compliance"."orchestra_executions" (
	"id" text PRIMARY KEY NOT NULL,
	"orchestra_layer_id" text NOT NULL,
	"org_id" text NOT NULL,
	"client_id" text,
	"user_id" text,
	"task_id" text,
	"event_type" text NOT NULL,
	"input" jsonb DEFAULT '{}'::jsonb NOT NULL,
	"output" jsonb,
	"status" text DEFAULT 'pending' NOT NULL,
	"duration_ms" integer,
	"model" text,
	"provider" text,
	"prompt_tokens" integer,
	"completion_tokens" integer,
	"cost_usd" numeric,
	"routing_rationale" text,
	"created_at" timestamp DEFAULT now() NOT NULL,
	"payload_purged_at" timestamp
);
--> statement-breakpoint
CREATE TABLE "compliance"."orchestra_layers" (
	"id" text PRIMARY KEY NOT NULL,
	"layer_key" text NOT NULL,
	"name" text NOT NULL,
	"description" text,
	"layer_order" integer NOT NULL,
	"default_model_config" jsonb DEFAULT '{}'::jsonb NOT NULL,
	"created_at" timestamp DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "compliance"."org_invite_links" (
	"id" text PRIMARY KEY NOT NULL,
	"org_id" text NOT NULL,
	"role" text NOT NULL,
	"token_hash" text NOT NULL,
	"token_prefix" text NOT NULL,
	"label" text,
	"created_by_user_id" text NOT NULL,
	"max_uses" integer,
	"use_count" integer DEFAULT 0 NOT NULL,
	"expires_at" timestamp NOT NULL,
	"revoked_at" timestamp,
	"revoked_by_user_id" text,
	"created_at" timestamp DEFAULT now() NOT NULL,
	"updated_at" timestamp DEFAULT now() NOT NULL,
	CONSTRAINT "org_invite_links_token_hash_unique" UNIQUE("token_hash")
);
--> statement-breakpoint
CREATE TABLE "compliance"."org_join_code_attempts" (
	"id" text PRIMARY KEY NOT NULL,
	"ip_address" text NOT NULL,
	"org_id" text,
	"was_successful" boolean DEFAULT false NOT NULL,
	"created_at" timestamp DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "compliance"."org_join_codes" (
	"id" text PRIMARY KEY NOT NULL,
	"org_id" text NOT NULL,
	"role" text NOT NULL,
	"code_hash" text NOT NULL,
	"code_prefix" text NOT NULL,
	"label" text,
	"created_by_user_id" text NOT NULL,
	"created_by_role" text DEFAULT 'admin' NOT NULL,
	"expires_at" timestamp,
	"redeem_count" integer DEFAULT 0 NOT NULL,
	"revoked_at" timestamp,
	"revoked_by_user_id" text,
	"created_at" timestamp DEFAULT now() NOT NULL,
	"updated_at" timestamp DEFAULT now() NOT NULL,
	CONSTRAINT "org_join_codes_code_hash_unique" UNIQUE("code_hash")
);
--> statement-breakpoint
CREATE TABLE "compliance"."org_product_branch_enablements" (
	"id" text PRIMARY KEY NOT NULL,
	"org_id" text NOT NULL,
	"product_branch_id" text NOT NULL,
	"is_enabled" boolean DEFAULT false NOT NULL,
	"enabled_at" timestamp,
	"enabled_by_id" text,
	"disabled_at" timestamp,
	"created_at" timestamp DEFAULT now() NOT NULL,
	"updated_at" timestamp DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "compliance"."passcode_login_attempts" (
	"id" text PRIMARY KEY NOT NULL,
	"email" text NOT NULL,
	"ip_address" text NOT NULL,
	"was_successful" boolean DEFAULT false NOT NULL,
	"created_at" timestamp DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "compliance"."performance_review_cycles" (
	"id" text PRIMARY KEY NOT NULL,
	"org_id" text NOT NULL,
	"name" text NOT NULL,
	"start_date" date NOT NULL,
	"end_date" date NOT NULL,
	"status" "compliance"."performance_review_cycle_status" DEFAULT 'draft' NOT NULL,
	"created_by_id" text NOT NULL,
	"created_at" timestamp DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "compliance"."performance_reviews" (
	"id" text PRIMARY KEY NOT NULL,
	"org_id" text NOT NULL,
	"cycle_id" text NOT NULL,
	"employee_profile_id" text NOT NULL,
	"reviewer_id" text NOT NULL,
	"self_rating" integer,
	"manager_rating" integer,
	"strengths" text,
	"improvements" text,
	"goals_for_next_period" text,
	"status" "compliance"."performance_review_status" DEFAULT 'pending' NOT NULL,
	"submitted_at" timestamp,
	"acknowledged_at" timestamp,
	"created_at" timestamp DEFAULT now() NOT NULL,
	"updated_at" timestamp DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "compliance"."platform_applications" (
	"id" text PRIMARY KEY NOT NULL,
	"application_key" text NOT NULL,
	"display_name" text NOT NULL,
	"key_hash" text NOT NULL,
	"key_prefix" text NOT NULL,
	"is_active" boolean DEFAULT true NOT NULL,
	"created_at" timestamp DEFAULT now() NOT NULL,
	"updated_at" timestamp DEFAULT now() NOT NULL,
	CONSTRAINT "platform_applications_application_key_unique" UNIQUE("application_key"),
	CONSTRAINT "platform_applications_key_hash_unique" UNIQUE("key_hash")
);
--> statement-breakpoint
CREATE TABLE "compliance"."platform_assets" (
	"id" text PRIMARY KEY NOT NULL,
	"asset_id" text DEFAULT compliance.generate_asset_id() NOT NULL,
	"name" text NOT NULL,
	"asset_type" "compliance"."asset_type" NOT NULL,
	"module" text,
	"department" text,
	"owner_id" text,
	"status" "compliance"."asset_status" DEFAULT 'active' NOT NULL,
	"created_by" text,
	"version" text DEFAULT '1.0' NOT NULL,
	"tags" jsonb DEFAULT '[]'::jsonb NOT NULL,
	"ai_enabled" boolean DEFAULT false NOT NULL,
	"ai_capabilities" jsonb,
	"permissions" jsonb,
	"parent_asset_id" text,
	"search_keywords" text,
	"purpose" text,
	"dependencies" jsonb,
	"source_table" text NOT NULL,
	"source_id" text NOT NULL,
	"org_id" text,
	"created_at" timestamp DEFAULT now() NOT NULL,
	"updated_at" timestamp DEFAULT now() NOT NULL,
	CONSTRAINT "platform_assets_asset_id_unique" UNIQUE("asset_id")
);
--> statement-breakpoint
CREATE TABLE "compliance"."pms_baseline_issue_snapshots" (
	"id" text PRIMARY KEY NOT NULL,
	"baseline_id" text NOT NULL,
	"issue_id" text NOT NULL,
	"baseline_start_date" date,
	"baseline_due_date" date,
	"created_at" timestamp DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "compliance"."pms_billable_rates" (
	"id" text PRIMARY KEY NOT NULL,
	"org_id" text NOT NULL,
	"user_id" text,
	"hourly_rate" numeric NOT NULL,
	"valid_from" date NOT NULL,
	"created_at" timestamp DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "compliance"."pms_budget_line_items" (
	"id" text PRIMARY KEY NOT NULL,
	"budget_id" text NOT NULL,
	"kind" "compliance"."pms_budget_line_kind" NOT NULL,
	"user_id" text,
	"description" text,
	"amount" numeric NOT NULL,
	"hours" numeric,
	"created_at" timestamp DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "compliance"."pms_budgets" (
	"id" text PRIMARY KEY NOT NULL,
	"org_id" text NOT NULL,
	"project_id" text NOT NULL,
	"name" text NOT NULL,
	"fixed_date" date,
	"author_id" text,
	"created_at" timestamp DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "compliance"."pms_estimate_points" (
	"id" text PRIMARY KEY NOT NULL,
	"scheme_id" text NOT NULL,
	"value" text NOT NULL,
	"position" integer DEFAULT 0 NOT NULL
);
--> statement-breakpoint
CREATE TABLE "compliance"."pms_estimate_schemes" (
	"id" text PRIMARY KEY NOT NULL,
	"org_id" text NOT NULL,
	"project_id" text NOT NULL,
	"name" text NOT NULL,
	"created_at" timestamp DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "compliance"."pms_issue_assignees" (
	"id" text PRIMARY KEY NOT NULL,
	"issue_id" text NOT NULL,
	"user_id" text NOT NULL,
	"created_at" timestamp DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "compliance"."pms_issue_labels" (
	"id" text PRIMARY KEY NOT NULL,
	"issue_id" text NOT NULL,
	"label_id" text NOT NULL
);
--> statement-breakpoint
CREATE TABLE "compliance"."pms_issue_relations" (
	"id" text PRIMARY KEY NOT NULL,
	"org_id" text NOT NULL,
	"issue_id" text NOT NULL,
	"related_issue_id" text NOT NULL,
	"relation_type" "compliance"."pms_issue_relation_type" NOT NULL,
	"lag_days" integer,
	"created_at" timestamp DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "compliance"."pms_issue_statuses" (
	"id" text PRIMARY KEY NOT NULL,
	"org_id" text NOT NULL,
	"project_id" text NOT NULL,
	"name" text NOT NULL,
	"group" "compliance"."pms_status_group" NOT NULL,
	"color" text,
	"position" integer DEFAULT 0 NOT NULL,
	"is_default" boolean DEFAULT false NOT NULL,
	"created_at" timestamp DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "compliance"."pms_issue_types" (
	"id" text PRIMARY KEY NOT NULL,
	"org_id" text NOT NULL,
	"name" text NOT NULL,
	"icon" text,
	"color" text,
	"is_epic" boolean DEFAULT false NOT NULL,
	"is_default" boolean DEFAULT false NOT NULL,
	"created_at" timestamp DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "compliance"."pms_issues" (
	"id" text PRIMARY KEY NOT NULL,
	"org_id" text NOT NULL,
	"client_id" text,
	"project_id" text NOT NULL,
	"type_id" text NOT NULL,
	"status_id" text NOT NULL,
	"priority" "compliance"."pms_issue_priority" DEFAULT 'no_priority' NOT NULL,
	"number" integer NOT NULL,
	"title" text NOT NULL,
	"description" text,
	"assignee_id" text,
	"parent_issue_id" text,
	"milestone_id" text,
	"estimate_point_id" text,
	"start_date" date,
	"due_date" date,
	"position" numeric DEFAULT '0' NOT NULL,
	"is_archived" boolean DEFAULT false NOT NULL,
	"created_by_id" text,
	"assigned_by_id" text,
	"completion_percentage" integer DEFAULT 0 NOT NULL,
	"created_at" timestamp DEFAULT now() NOT NULL,
	"updated_at" timestamp DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "compliance"."pms_labels" (
	"id" text PRIMARY KEY NOT NULL,
	"org_id" text NOT NULL,
	"project_id" text NOT NULL,
	"name" text NOT NULL,
	"color" text,
	"created_at" timestamp DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "compliance"."pms_meeting_agenda_items" (
	"id" text PRIMARY KEY NOT NULL,
	"meeting_id" text NOT NULL,
	"position" integer DEFAULT 0 NOT NULL,
	"title" text NOT NULL,
	"issue_id" text,
	"duration_minutes" integer
);
--> statement-breakpoint
CREATE TABLE "compliance"."pms_meeting_outcomes" (
	"id" text PRIMARY KEY NOT NULL,
	"meeting_id" text NOT NULL,
	"notes" text,
	"created_at" timestamp DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "compliance"."pms_meeting_participants" (
	"id" text PRIMARY KEY NOT NULL,
	"meeting_id" text NOT NULL,
	"user_id" text NOT NULL,
	"response_status" text
);
--> statement-breakpoint
CREATE TABLE "compliance"."pms_meetings" (
	"id" text PRIMARY KEY NOT NULL,
	"org_id" text NOT NULL,
	"project_id" text NOT NULL,
	"title" text NOT NULL,
	"scheduled_at" timestamp NOT NULL,
	"duration_minutes" integer,
	"recurrence_rule" text,
	"created_at" timestamp DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "compliance"."pms_milestones" (
	"id" text PRIMARY KEY NOT NULL,
	"org_id" text NOT NULL,
	"project_id" text NOT NULL,
	"name" text NOT NULL,
	"description" text,
	"status" "compliance"."pms_milestone_status" DEFAULT 'planned' NOT NULL,
	"target_date" date,
	"created_at" timestamp DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "compliance"."pms_resource_allocations" (
	"id" text PRIMARY KEY NOT NULL,
	"org_id" text NOT NULL,
	"project_id" text NOT NULL,
	"user_id" text NOT NULL,
	"issue_id" text,
	"allocated_hours_per_day" numeric NOT NULL,
	"start_date" date NOT NULL,
	"end_date" date NOT NULL,
	"created_at" timestamp DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "compliance"."pms_saved_views" (
	"id" text PRIMARY KEY NOT NULL,
	"org_id" text NOT NULL,
	"project_id" text,
	"owned_by_id" text NOT NULL,
	"name" text NOT NULL,
	"filters" jsonb DEFAULT '{}'::jsonb NOT NULL,
	"display_filters" jsonb DEFAULT '{}'::jsonb NOT NULL,
	"access" "compliance"."pms_view_access" DEFAULT 'private' NOT NULL,
	"sort_order" integer DEFAULT 0 NOT NULL,
	"created_at" timestamp DEFAULT now() NOT NULL,
	"updated_at" timestamp DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "compliance"."pms_schedule_baselines" (
	"id" text PRIMARY KEY NOT NULL,
	"org_id" text NOT NULL,
	"project_id" text NOT NULL,
	"name" text NOT NULL,
	"captured_by_id" text,
	"created_at" timestamp DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "compliance"."pms_sprint_issues" (
	"id" text PRIMARY KEY NOT NULL,
	"sprint_id" text NOT NULL,
	"issue_id" text NOT NULL,
	"created_at" timestamp DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "compliance"."pms_sprints" (
	"id" text PRIMARY KEY NOT NULL,
	"org_id" text NOT NULL,
	"project_id" text NOT NULL,
	"name" text NOT NULL,
	"goal" text,
	"start_date" date,
	"end_date" date,
	"status" "compliance"."pms_sprint_status" DEFAULT 'planned' NOT NULL,
	"progress_snapshot" jsonb,
	"created_at" timestamp DEFAULT now() NOT NULL,
	"updated_at" timestamp DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "compliance"."pms_time_entries" (
	"id" text PRIMARY KEY NOT NULL,
	"org_id" text NOT NULL,
	"issue_id" text NOT NULL,
	"user_id" text NOT NULL,
	"hours" numeric NOT NULL,
	"spent_on" date NOT NULL,
	"activity_type" text,
	"comments" text,
	"is_running" boolean DEFAULT false NOT NULL,
	"started_at" timestamp,
	"created_at" timestamp DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "compliance"."pms_wiki_pages" (
	"id" text PRIMARY KEY NOT NULL,
	"org_id" text NOT NULL,
	"project_id" text NOT NULL,
	"parent_page_id" text,
	"slug" text NOT NULL,
	"title" text NOT NULL,
	"content" text,
	"version" integer DEFAULT 1 NOT NULL,
	"updated_by_id" text,
	"is_archived" boolean DEFAULT false NOT NULL,
	"created_at" timestamp DEFAULT now() NOT NULL,
	"updated_at" timestamp DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "compliance"."pms_workflow_transitions" (
	"id" text PRIMARY KEY NOT NULL,
	"org_id" text NOT NULL,
	"issue_type_id" text NOT NULL,
	"role" "compliance"."user_role",
	"from_status_id" text NOT NULL,
	"to_status_id" text NOT NULL,
	"created_at" timestamp DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "compliance"."policies" (
	"id" text PRIMARY KEY NOT NULL,
	"title" text NOT NULL,
	"category" text DEFAULT 'governance' NOT NULL,
	"version" text DEFAULT 'v1.0' NOT NULL,
	"status" "compliance"."policy_status" DEFAULT 'draft' NOT NULL,
	"attestation_rate" integer DEFAULT 0 NOT NULL,
	"history" jsonb DEFAULT '[]'::jsonb NOT NULL,
	"org_id" text NOT NULL,
	"client_id" text,
	"created_by_id" text NOT NULL,
	"created_at" timestamp DEFAULT now() NOT NULL,
	"updated_at" timestamp DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "compliance"."posh_annual_reports" (
	"id" text PRIMARY KEY NOT NULL,
	"year" text NOT NULL,
	"filed_with" text,
	"status" text DEFAULT 'pending' NOT NULL,
	"filed_date" timestamp,
	"org_id" text NOT NULL,
	"client_id" text,
	"created_at" timestamp DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "compliance"."posh_committee" (
	"id" text PRIMARY KEY NOT NULL,
	"member_name" text NOT NULL,
	"role" text,
	"org_id" text NOT NULL,
	"client_id" text,
	"created_at" timestamp DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "compliance"."posh_complaints" (
	"id" text PRIMARY KEY NOT NULL,
	"case_ref" text NOT NULL,
	"received_date" timestamp NOT NULL,
	"status" text DEFAULT 'under_inquiry' NOT NULL,
	"classification" text DEFAULT 'confidential' NOT NULL,
	"org_id" text NOT NULL,
	"client_id" text,
	"recorded_by_id" text NOT NULL,
	"created_at" timestamp DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "compliance"."problem_records" (
	"id" text PRIMARY KEY NOT NULL,
	"org_id" text NOT NULL,
	"title" text NOT NULL,
	"root_cause" text,
	"status" text DEFAULT 'open' NOT NULL,
	"created_by_id" text,
	"resolved_at" timestamp,
	"created_at" timestamp DEFAULT now() NOT NULL,
	"updated_at" timestamp DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "compliance"."problem_tickets" (
	"id" text PRIMARY KEY NOT NULL,
	"problem_id" text NOT NULL,
	"ticket_id" text NOT NULL,
	"linked_at" timestamp DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "platform"."product_branch_modules" (
	"id" text PRIMARY KEY NOT NULL,
	"product_branch_id" text NOT NULL,
	"module_key" text NOT NULL,
	"is_enabled" boolean DEFAULT true NOT NULL,
	"created_at" timestamp DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "platform"."product_branches" (
	"id" text PRIMARY KEY NOT NULL,
	"branch_key" text NOT NULL,
	"display_name" text NOT NULL,
	"domain" text NOT NULL,
	"description" text,
	"is_active" boolean DEFAULT true NOT NULL,
	"tagline" text,
	"icon" text,
	"status" text DEFAULT 'planned' NOT NULL,
	"launch_order" integer DEFAULT 999 NOT NULL,
	"parent_domain" text,
	"build_tier" text,
	"created_at" timestamp DEFAULT now() NOT NULL,
	CONSTRAINT "product_branches_branch_key_unique" UNIQUE("branch_key")
);
--> statement-breakpoint
CREATE TABLE "compliance"."products" (
	"id" text PRIMARY KEY NOT NULL,
	"org_id" text NOT NULL,
	"name" text NOT NULL,
	"slug" text NOT NULL,
	"description" text,
	"is_active" boolean DEFAULT true NOT NULL,
	"created_at" timestamp DEFAULT now() NOT NULL,
	"updated_at" timestamp DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "compliance"."projects" (
	"id" text PRIMARY KEY NOT NULL,
	"product_id" text NOT NULL,
	"org_id" text NOT NULL,
	"client_id" text,
	"name" text NOT NULL,
	"description" text,
	"is_active" boolean DEFAULT true NOT NULL,
	"issue_prefix" text,
	"issue_sequence" integer DEFAULT 0 NOT NULL,
	"lead_user_id" text,
	"start_date" date,
	"target_date" date,
	"health_status" text,
	"parent_project_id" text,
	"created_at" timestamp DEFAULT now() NOT NULL,
	"updated_at" timestamp DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "compliance"."prompt_cache_metrics" (
	"id" text PRIMARY KEY NOT NULL,
	"org_id" text NOT NULL,
	"layer_key" text NOT NULL,
	"fingerprint" text NOT NULL,
	"provider" text NOT NULL,
	"model" text NOT NULL,
	"cache_attempted" boolean NOT NULL,
	"prompt_tokens" integer,
	"cache_read_tokens" integer,
	"cache_creation_tokens" integer,
	"created_at" timestamp DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "compliance"."prompt_eval_cases" (
	"id" text PRIMARY KEY NOT NULL,
	"prompt_template_id" text NOT NULL,
	"name" text NOT NULL,
	"input_variables" jsonb DEFAULT '{}'::jsonb NOT NULL,
	"user_message" text NOT NULL,
	"expected_keywords" jsonb DEFAULT '[]'::jsonb NOT NULL,
	"created_by_id" text,
	"created_at" timestamp DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "compliance"."prompt_eval_runs" (
	"id" text PRIMARY KEY NOT NULL,
	"eval_case_id" text NOT NULL,
	"prompt_version_id" text NOT NULL,
	"provider" text NOT NULL,
	"model" text NOT NULL,
	"rendered_prompt" text NOT NULL,
	"output" text,
	"status" text DEFAULT 'completed' NOT NULL,
	"error_message" text,
	"passed" boolean,
	"missing_keywords" jsonb DEFAULT '[]'::jsonb NOT NULL,
	"latency_ms" integer,
	"prompt_tokens" integer,
	"completion_tokens" integer,
	"estimated_cost_usd" numeric,
	"run_by_id" text NOT NULL,
	"created_at" timestamp DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "compliance"."prompt_templates" (
	"id" text PRIMARY KEY NOT NULL,
	"template_key" text NOT NULL,
	"display_name" text NOT NULL,
	"description" text,
	"created_at" timestamp DEFAULT now() NOT NULL,
	"updated_at" timestamp DEFAULT now() NOT NULL,
	CONSTRAINT "prompt_templates_template_key_unique" UNIQUE("template_key")
);
--> statement-breakpoint
CREATE TABLE "compliance"."prompt_versions" (
	"id" text PRIMARY KEY NOT NULL,
	"prompt_template_id" text NOT NULL,
	"version" integer NOT NULL,
	"content" text NOT NULL,
	"label" text,
	"is_active" boolean DEFAULT true NOT NULL,
	"created_by_id" text,
	"created_at" timestamp DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "compliance"."rbi_compliance_items" (
	"id" text PRIMARY KEY NOT NULL,
	"circular" text NOT NULL,
	"category" text,
	"status" text DEFAULT 'not_started' NOT NULL,
	"org_id" text NOT NULL,
	"client_id" text,
	"created_at" timestamp DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "compliance"."related_party_transactions" (
	"id" text PRIMARY KEY NOT NULL,
	"party_name" text NOT NULL,
	"nature_of_transaction" text,
	"amount" numeric(14, 2),
	"approval_status" "compliance"."rpt_approval_status" DEFAULT 'pending' NOT NULL,
	"approved_by_id" text,
	"transaction_date" timestamp,
	"classification" text DEFAULT 'board_only' NOT NULL,
	"org_id" text NOT NULL,
	"client_id" text,
	"created_by_id" text NOT NULL,
	"created_at" timestamp DEFAULT now() NOT NULL,
	"updated_at" timestamp DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "compliance"."report_definitions" (
	"id" text PRIMARY KEY NOT NULL,
	"org_id" text,
	"name" text NOT NULL,
	"description" text NOT NULL,
	"category" text NOT NULL,
	"classifications" jsonb DEFAULT '[]'::jsonb NOT NULL,
	"periodicity" text,
	"periodicity_config" jsonb,
	"execution_type" text NOT NULL,
	"execution_config" jsonb NOT NULL,
	"output_formats" jsonb DEFAULT '["table"]'::jsonb NOT NULL,
	"status" text DEFAULT 'built' NOT NULL,
	"data_gap_note" text,
	"created_by" text DEFAULT 'system' NOT NULL,
	"promoted_from_context" text,
	"is_active" boolean DEFAULT true NOT NULL,
	"created_at" timestamp DEFAULT now() NOT NULL,
	"updated_at" timestamp DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "compliance"."report_item_actions" (
	"id" text PRIMARY KEY NOT NULL,
	"org_id" text NOT NULL,
	"report_id" text NOT NULL,
	"row_id" text NOT NULL,
	"user_id" text NOT NULL,
	"action" text NOT NULL,
	"target_id" text,
	"created_at" timestamp DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "compliance"."report_schedules" (
	"id" text PRIMARY KEY NOT NULL,
	"org_id" text NOT NULL,
	"report_id" text NOT NULL,
	"cadence" text NOT NULL,
	"day_of_week" integer,
	"day_of_month" integer,
	"times_of_day" jsonb,
	"start_date" date,
	"end_date" date,
	"recipient_user_ids" jsonb DEFAULT '[]'::jsonb NOT NULL,
	"created_by" text NOT NULL,
	"is_active" boolean DEFAULT true NOT NULL,
	"created_at" timestamp DEFAULT now() NOT NULL,
	"updated_at" timestamp DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "compliance"."risk_anomaly_events" (
	"id" text PRIMARY KEY NOT NULL,
	"org_id" text NOT NULL,
	"event_type" text NOT NULL,
	"severity" text DEFAULT 'medium' NOT NULL,
	"source_entity_type" text NOT NULL,
	"source_entity_id" text,
	"actor_user_id" text,
	"reason" text NOT NULL,
	"detail" jsonb DEFAULT '{}'::jsonb NOT NULL,
	"status" text DEFAULT 'open' NOT NULL,
	"escalated_to_user_id" text,
	"escalated_at" timestamp,
	"created_at" timestamp DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "compliance"."risks" (
	"id" text PRIMARY KEY NOT NULL,
	"title" text NOT NULL,
	"category" "compliance"."risk_category" DEFAULT 'operational' NOT NULL,
	"likelihood" integer DEFAULT 3 NOT NULL,
	"impact" integer DEFAULT 3 NOT NULL,
	"owner_id" text,
	"owner_dept" text,
	"status" "compliance"."risk_status" DEFAULT 'open' NOT NULL,
	"linked_control_ids" jsonb DEFAULT '[]'::jsonb NOT NULL,
	"org_id" text NOT NULL,
	"client_id" text,
	"created_at" timestamp DEFAULT now() NOT NULL,
	"updated_at" timestamp DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "compliance"."sales_commission_accruals" (
	"id" text PRIMARY KEY NOT NULL,
	"sales_referral_id" text NOT NULL,
	"sales_partner_id" text NOT NULL,
	"product_key" text NOT NULL,
	"sales_commission_plan_id" text,
	"deal_value" numeric(12, 2),
	"amount" numeric(12, 2) NOT NULL,
	"currency" text DEFAULT 'INR' NOT NULL,
	"status" "compliance"."sales_commission_accrual_status" DEFAULT 'accrued' NOT NULL,
	"note" text,
	"recorded_by_id" text,
	"created_at" timestamp DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "compliance"."sales_commission_plans" (
	"id" text PRIMARY KEY NOT NULL,
	"product_key" text NOT NULL,
	"partner_type" "compliance"."sales_partner_type",
	"commission_type" "compliance"."sales_commission_type" NOT NULL,
	"rate" numeric(6, 3),
	"flat_amount" numeric(12, 2),
	"currency" text DEFAULT 'INR' NOT NULL,
	"valid_from" timestamp DEFAULT now() NOT NULL,
	"valid_to" timestamp,
	"is_active" boolean DEFAULT true NOT NULL,
	"created_by_id" text,
	"created_at" timestamp DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "compliance"."sales_partners" (
	"id" text PRIMARY KEY NOT NULL,
	"name" text NOT NULL,
	"email" text NOT NULL,
	"phone" text,
	"partner_type" "compliance"."sales_partner_type" NOT NULL,
	"status" "compliance"."sales_partner_status" DEFAULT 'active' NOT NULL,
	"company_name" text,
	"notes" text,
	"dashboard_token" text NOT NULL,
	"dashboard_token_expires_at" timestamp NOT NULL,
	"dashboard_token_revoked_at" timestamp,
	"created_by_id" text,
	"created_at" timestamp DEFAULT now() NOT NULL,
	"updated_at" timestamp DEFAULT now() NOT NULL,
	CONSTRAINT "sales_partners_email_unique" UNIQUE("email"),
	CONSTRAINT "sales_partners_dashboard_token_unique" UNIQUE("dashboard_token")
);
--> statement-breakpoint
CREATE TABLE "compliance"."sales_referral_links" (
	"id" text PRIMARY KEY NOT NULL,
	"sales_partner_id" text NOT NULL,
	"product_key" text,
	"token" text NOT NULL,
	"label" text,
	"is_active" boolean DEFAULT true NOT NULL,
	"click_count" integer DEFAULT 0 NOT NULL,
	"created_at" timestamp DEFAULT now() NOT NULL,
	CONSTRAINT "sales_referral_links_token_unique" UNIQUE("token")
);
--> statement-breakpoint
CREATE TABLE "compliance"."sales_referrals" (
	"id" text PRIMARY KEY NOT NULL,
	"sales_partner_id" text NOT NULL,
	"sales_referral_link_id" text NOT NULL,
	"product_key" text,
	"status" "compliance"."sales_referral_status" DEFAULT 'clicked' NOT NULL,
	"ip_address" text,
	"user_agent" text,
	"auth_user_id" text,
	"org_id" text,
	"clicked_at" timestamp DEFAULT now() NOT NULL,
	"signup_completed_at" timestamp,
	"org_provisioned_at" timestamp,
	"paid_at" timestamp,
	"lost_at" timestamp,
	"lost_reason" text,
	"created_at" timestamp DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "compliance"."saved_reports" (
	"id" text PRIMARY KEY NOT NULL,
	"org_id" text NOT NULL,
	"name" text NOT NULL,
	"description" text,
	"owned_by_id" text NOT NULL,
	"source_entity" text NOT NULL,
	"filters" jsonb DEFAULT '{}'::jsonb NOT NULL,
	"group_by_field" text,
	"chart_type" text DEFAULT 'table' NOT NULL,
	"visibility" text DEFAULT 'private' NOT NULL,
	"ai_generated_data" jsonb,
	"source_file_name" text,
	"created_at" timestamp DEFAULT now() NOT NULL,
	"updated_at" timestamp DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "compliance"."scoped_delegations" (
	"id" text PRIMARY KEY NOT NULL,
	"org_id" text NOT NULL,
	"delegator_user_id" text NOT NULL,
	"delegate_user_id" text,
	"delegate_role_key" text,
	"scope_type" "compliance"."delegation_scope_type" NOT NULL,
	"scope_id" text,
	"expires_at" timestamp,
	"revoked_at" timestamp,
	"created_at" timestamp DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "compliance"."sebi_compliance_items" (
	"id" text PRIMARY KEY NOT NULL,
	"requirement" text NOT NULL,
	"due_date" timestamp,
	"status" text DEFAULT 'not_due_yet' NOT NULL,
	"linked_module" text,
	"org_id" text NOT NULL,
	"client_id" text,
	"created_at" timestamp DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "compliance"."secretarial_audits" (
	"id" text PRIMARY KEY NOT NULL,
	"period" text NOT NULL,
	"auditor_name" text,
	"status" text DEFAULT 'in_progress' NOT NULL,
	"due_date" timestamp,
	"org_id" text NOT NULL,
	"client_id" text,
	"created_at" timestamp DEFAULT now() NOT NULL,
	"updated_at" timestamp DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "compliance"."shared_pool_allocations" (
	"id" text PRIMARY KEY NOT NULL,
	"lender_org_id" text NOT NULL,
	"purpose" text NOT NULL,
	"customer_model_config_id" text NOT NULL,
	"orchestra_layer_key" text NOT NULL,
	"allocated_at" timestamp DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "compliance"."sso_configurations" (
	"id" text PRIMARY KEY NOT NULL,
	"org_id" text NOT NULL,
	"idp_entry_point" text NOT NULL,
	"idp_issuer" text NOT NULL,
	"idp_cert" text NOT NULL,
	"sp_entity_id" text NOT NULL,
	"is_enabled" boolean DEFAULT false NOT NULL,
	"created_by_id" text,
	"created_at" timestamp DEFAULT now() NOT NULL,
	"updated_at" timestamp DEFAULT now() NOT NULL,
	CONSTRAINT "sso_configurations_org_id_unique" UNIQUE("org_id")
);
--> statement-breakpoint
CREATE TABLE "compliance"."stage0_sources" (
	"id" text PRIMARY KEY NOT NULL,
	"user_id" text NOT NULL,
	"org_id" text NOT NULL,
	"source_type" text NOT NULL,
	"source_token_id" text NOT NULL,
	"source_conversation_id" text NOT NULL,
	"joined_at" timestamp DEFAULT now() NOT NULL,
	"revoked_at" timestamp
);
--> statement-breakpoint
CREATE TABLE "compliance"."subscription_plans" (
	"id" text PRIMARY KEY NOT NULL,
	"name" text NOT NULL,
	"user_pack_size" integer NOT NULL,
	"assistants_per_user" integer DEFAULT 5 NOT NULL,
	"price_monthly" numeric(10, 2),
	"features" jsonb DEFAULT '{}'::jsonb NOT NULL,
	"is_active" boolean DEFAULT true NOT NULL,
	"created_at" timestamp DEFAULT now() NOT NULL,
	CONSTRAINT "subscription_plans_name_unique" UNIQUE("name")
);
--> statement-breakpoint
CREATE TABLE "compliance"."support_sessions" (
	"id" text PRIMARY KEY NOT NULL,
	"initiated_by_user_id" text NOT NULL,
	"initiated_by_name" text NOT NULL,
	"target_org_id" text NOT NULL,
	"target_user_id" text NOT NULL,
	"target_user_name" text NOT NULL,
	"reason" text NOT NULL,
	"token_hash" text NOT NULL,
	"expires_at" timestamp NOT NULL,
	"ended_at" timestamp,
	"ended_reason" text,
	"created_at" timestamp DEFAULT now() NOT NULL,
	CONSTRAINT "support_sessions_token_hash_unique" UNIQUE("token_hash")
);
--> statement-breakpoint
CREATE TABLE "compliance"."task_agent_executions" (
	"id" text PRIMARY KEY NOT NULL,
	"task_execution_plan_id" text NOT NULL,
	"worker_agent_id" text,
	"started_at" timestamp DEFAULT now() NOT NULL,
	"completed_at" timestamp,
	"status" text DEFAULT 'pending' NOT NULL,
	"input" jsonb DEFAULT '{}'::jsonb NOT NULL,
	"output" jsonb,
	"error_message" text,
	"handover_task_status" text,
	"handover_output_produced" text,
	"handover_validation_passed" text,
	"handover_known_risks" text,
	"handover_pending_items" text,
	"handover_confidence" text,
	"handover_next_responsible_ai" text,
	"handover_required_action" text,
	"handover_escalation_required" text,
	"handover_accepted_by" text,
	"handover_accepted_at" timestamp
);
--> statement-breakpoint
CREATE TABLE "platform"."task_capabilities" (
	"id" text PRIMARY KEY NOT NULL,
	"capability_key" text NOT NULL,
	"mode_pill" text,
	"path_keys" jsonb,
	"status" text DEFAULT 'ai_only' NOT NULL,
	"needs_improvement" text DEFAULT 'no' NOT NULL,
	"version" integer DEFAULT 1 NOT NULL,
	"last_audited_at" timestamp,
	"last_audited_version" integer,
	"occurrence_count" integer DEFAULT 0 NOT NULL,
	"prompt_word_index" jsonb,
	"full_software_count" integer DEFAULT 0 NOT NULL,
	"package_available_count" integer DEFAULT 0 NOT NULL,
	"novel_count" integer DEFAULT 0 NOT NULL,
	"org_id" text,
	"created_at" timestamp DEFAULT now() NOT NULL,
	"updated_at" timestamp DEFAULT now() NOT NULL,
	CONSTRAINT "task_capabilities_capability_key_unique" UNIQUE("capability_key")
);
--> statement-breakpoint
CREATE TABLE "compliance"."task_chat_messages" (
	"id" text PRIMARY KEY NOT NULL,
	"task_id" text NOT NULL,
	"role" text NOT NULL,
	"content" text NOT NULL,
	"created_at" timestamp DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "compliance"."task_execution_plan" (
	"id" text PRIMARY KEY NOT NULL,
	"task_id" text NOT NULL,
	"step_number" integer NOT NULL,
	"worker_agent_id" text,
	"description" text,
	"status" text DEFAULT 'pending' NOT NULL,
	"created_at" timestamp DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "compliance"."task_reflections" (
	"id" text PRIMARY KEY NOT NULL,
	"org_id" text NOT NULL,
	"source_type" text NOT NULL,
	"source_id" text NOT NULL,
	"role_key" text,
	"outcome" text NOT NULL,
	"summary" text,
	"failure_reason" text,
	"elapsed_ms" integer,
	"comparison_avg_elapsed_ms" numeric,
	"speed_verdict" text,
	"cost_usd" numeric,
	"comparison_avg_cost_usd" numeric,
	"cost_verdict" text,
	"different_ai_tier_flag" jsonb,
	"reusable_pattern_flag" jsonb,
	"created_at" timestamp DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "compliance"."tasks" (
	"id" text PRIMARY KEY NOT NULL,
	"org_id" text NOT NULL,
	"client_id" text,
	"user_id" text,
	"assistant_id" text,
	"title" text NOT NULL,
	"description" text,
	"status" text DEFAULT 'pending' NOT NULL,
	"assigned_by_id" text,
	"project_id" text,
	"due_date" timestamp,
	"resolved_worker_agent_id" text,
	"priority" integer DEFAULT 0 NOT NULL,
	"dynamic_chain_id" text,
	"last_reprioritized_at" timestamp,
	"last_reprioritization_reason" text,
	"created_at" timestamp DEFAULT now() NOT NULL,
	"updated_at" timestamp DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "compliance"."ticket_intelligence_action_items" (
	"id" text PRIMARY KEY NOT NULL,
	"ticket_intelligence_item_id" text NOT NULL,
	"suggested_index" integer NOT NULL,
	"task_id" text NOT NULL,
	"created_at" timestamp DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "compliance"."ticket_intelligence_items" (
	"id" text PRIMARY KEY NOT NULL,
	"org_id" text NOT NULL,
	"ticket_id" text NOT NULL,
	"requested_by_id" text NOT NULL,
	"status" text DEFAULT 'analyzing' NOT NULL,
	"ai_summary" text,
	"ai_suggested_work_items" jsonb DEFAULT '[]'::jsonb NOT NULL,
	"ai_generated_at" timestamp,
	"created_at" timestamp DEFAULT now() NOT NULL,
	"updated_at" timestamp DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "compliance"."ticket_satisfaction_surveys" (
	"id" text PRIMARY KEY NOT NULL,
	"org_id" text NOT NULL,
	"ticket_id" text NOT NULL,
	"csat_score" integer,
	"nps_score" integer,
	"comment" text,
	"created_at" timestamp DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "compliance"."tickets" (
	"id" text PRIMARY KEY NOT NULL,
	"org_id" text NOT NULL,
	"client_id" text,
	"conversation_id" text NOT NULL,
	"subject" text NOT NULL,
	"category" text,
	"priority" "compliance"."priority" DEFAULT 'medium' NOT NULL,
	"status" text DEFAULT 'open' NOT NULL,
	"assignee_id" text,
	"requester_user_id" text,
	"sla_deadline" timestamp,
	"resolved_at" timestamp,
	"created_by_id" text NOT NULL,
	"created_at" timestamp DEFAULT now() NOT NULL,
	"updated_at" timestamp DEFAULT now() NOT NULL,
	"installed_product_id" text
);
--> statement-breakpoint
CREATE TABLE "compliance"."token_usage_ledger" (
	"id" text PRIMARY KEY NOT NULL,
	"scope" text NOT NULL,
	"org_id" text,
	"user_id" text,
	"role_key" text,
	"layer_key" text,
	"task_summary" text,
	"provider" text NOT NULL,
	"model" text NOT NULL,
	"prompt_tokens" integer DEFAULT 0 NOT NULL,
	"completion_tokens" integer DEFAULT 0 NOT NULL,
	"estimated_cost_usd" numeric,
	"cache_savings_usd" numeric,
	"created_at" timestamp DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "compliance"."tool_health_events" (
	"id" text PRIMARY KEY NOT NULL,
	"org_id" text NOT NULL,
	"execution_id" text,
	"tool_name" text NOT NULL,
	"succeeded" boolean NOT NULL,
	"error_message" text,
	"duration_ms" integer,
	"created_at" timestamp DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "compliance"."training_assessment_attempts" (
	"id" text PRIMARY KEY NOT NULL,
	"org_id" text NOT NULL,
	"assessment_id" text NOT NULL,
	"enrollment_id" text NOT NULL,
	"employee_id" text NOT NULL,
	"attempt_number" integer DEFAULT 1 NOT NULL,
	"submitted_answers" jsonb DEFAULT '{}'::jsonb NOT NULL,
	"score" numeric NOT NULL,
	"max_score" numeric NOT NULL,
	"score_percent" numeric NOT NULL,
	"passed" boolean NOT NULL,
	"passing_threshold_applied" integer NOT NULL,
	"started_at" timestamp DEFAULT now() NOT NULL,
	"submitted_at" timestamp DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "compliance"."training_assessments" (
	"id" text PRIMARY KEY NOT NULL,
	"org_id" text NOT NULL,
	"course_id" text NOT NULL,
	"module_id" text,
	"title" text NOT NULL,
	"description" text,
	"passing_score_percent" integer,
	"max_attempts" integer,
	"time_limit_minutes" integer,
	"created_at" timestamp DEFAULT now() NOT NULL,
	"updated_at" timestamp DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "compliance"."training_completions" (
	"id" text PRIMARY KEY NOT NULL,
	"org_id" text NOT NULL,
	"enrollment_id" text NOT NULL,
	"completed_at" timestamp DEFAULT now() NOT NULL,
	"score" numeric,
	"passed" boolean DEFAULT true NOT NULL,
	"best_attempt_id" text,
	"created_at" timestamp DEFAULT now() NOT NULL,
	CONSTRAINT "training_completions_enrollment_id_unique" UNIQUE("enrollment_id")
);
--> statement-breakpoint
CREATE TABLE "compliance"."training_courses" (
	"id" text PRIMARY KEY NOT NULL,
	"org_id" text NOT NULL,
	"title" text NOT NULL,
	"description" text,
	"category" text,
	"created_by" text NOT NULL,
	"status" "compliance"."training_course_status" DEFAULT 'draft' NOT NULL,
	"passing_score_percent" integer DEFAULT 70 NOT NULL,
	"estimated_duration_minutes" integer,
	"is_mandatory" boolean DEFAULT false NOT NULL,
	"target_roles" jsonb,
	"created_at" timestamp DEFAULT now() NOT NULL,
	"updated_at" timestamp DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "compliance"."training_enrollments" (
	"id" text PRIMARY KEY NOT NULL,
	"org_id" text NOT NULL,
	"employee_id" text NOT NULL,
	"course_id" text NOT NULL,
	"training_path_id" text,
	"status" "compliance"."training_enrollment_status" DEFAULT 'not_started' NOT NULL,
	"enrolled_at" timestamp DEFAULT now() NOT NULL,
	"started_at" timestamp,
	"due_date" date,
	"assigned_by" text,
	"created_at" timestamp DEFAULT now() NOT NULL,
	"updated_at" timestamp DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "compliance"."training_lessons" (
	"id" text PRIMARY KEY NOT NULL,
	"org_id" text NOT NULL,
	"module_id" text NOT NULL,
	"course_id" text NOT NULL,
	"title" text NOT NULL,
	"content_type" "compliance"."training_lesson_content_type" DEFAULT 'rich_text' NOT NULL,
	"content" text,
	"video_url" text,
	"sort_order" integer DEFAULT 0 NOT NULL,
	"estimated_duration_minutes" integer,
	"created_at" timestamp DEFAULT now() NOT NULL,
	"updated_at" timestamp DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "compliance"."training_modules" (
	"id" text PRIMARY KEY NOT NULL,
	"org_id" text NOT NULL,
	"course_id" text NOT NULL,
	"title" text NOT NULL,
	"description" text,
	"sort_order" integer DEFAULT 0 NOT NULL,
	"created_at" timestamp DEFAULT now() NOT NULL,
	"updated_at" timestamp DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "compliance"."training_path_assignments" (
	"id" text PRIMARY KEY NOT NULL,
	"org_id" text NOT NULL,
	"training_path_id" text NOT NULL,
	"employee_id" text NOT NULL,
	"assigned_via" text DEFAULT 'individual' NOT NULL,
	"assigned_via_department_id" text,
	"assigned_via_role" text,
	"assigned_by" text NOT NULL,
	"assigned_at" timestamp DEFAULT now() NOT NULL,
	"due_date" date
);
--> statement-breakpoint
CREATE TABLE "compliance"."training_path_courses" (
	"id" text PRIMARY KEY NOT NULL,
	"org_id" text NOT NULL,
	"training_path_id" text NOT NULL,
	"course_id" text NOT NULL,
	"sort_order" integer DEFAULT 0 NOT NULL,
	"is_required" boolean DEFAULT true NOT NULL,
	"created_at" timestamp DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "compliance"."training_paths" (
	"id" text PRIMARY KEY NOT NULL,
	"org_id" text NOT NULL,
	"name" text NOT NULL,
	"description" text,
	"target_department_id" text,
	"target_role" text,
	"is_active" boolean DEFAULT true NOT NULL,
	"created_by" text NOT NULL,
	"created_at" timestamp DEFAULT now() NOT NULL,
	"updated_at" timestamp DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "compliance"."training_questions" (
	"id" text PRIMARY KEY NOT NULL,
	"org_id" text NOT NULL,
	"assessment_id" text NOT NULL,
	"question_text" text NOT NULL,
	"question_type" "compliance"."training_question_type" DEFAULT 'multiple_choice' NOT NULL,
	"options" jsonb DEFAULT '[]'::jsonb NOT NULL,
	"correct_answer" jsonb NOT NULL,
	"points" integer DEFAULT 1 NOT NULL,
	"sort_order" integer DEFAULT 0 NOT NULL,
	"created_at" timestamp DEFAULT now() NOT NULL,
	"updated_at" timestamp DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "compliance"."user_active_sessions" (
	"id" text PRIMARY KEY NOT NULL,
	"user_id" text NOT NULL,
	"org_id" text NOT NULL,
	"session_token_hash" text NOT NULL,
	"device_label" text DEFAULT 'unknown' NOT NULL,
	"user_agent" text,
	"created_at" timestamp DEFAULT now() NOT NULL,
	"last_seen_at" timestamp DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "compliance"."user_client_access" (
	"id" text PRIMARY KEY NOT NULL,
	"user_id" text NOT NULL,
	"client_id" text NOT NULL,
	"access_level" text DEFAULT 'full' NOT NULL,
	"created_at" timestamp DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "compliance"."vendor_risk_profiles" (
	"id" text PRIMARY KEY NOT NULL,
	"name" text NOT NULL,
	"risk_tier" text DEFAULT 'medium' NOT NULL,
	"risk_score" integer,
	"risk_factors" jsonb,
	"certifications" jsonb DEFAULT '[]'::jsonb NOT NULL,
	"last_assessed_date" timestamp,
	"org_id" text NOT NULL,
	"client_id" text,
	"created_at" timestamp DEFAULT now() NOT NULL,
	"updated_at" timestamp DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "compliance"."veri_meeting_action_items" (
	"id" text PRIMARY KEY NOT NULL,
	"meeting_id" text NOT NULL,
	"task_id" text NOT NULL,
	"created_at" timestamp DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "compliance"."veri_meeting_share_links" (
	"id" text PRIMARY KEY NOT NULL,
	"meeting_id" text NOT NULL,
	"token" text NOT NULL,
	"created_by_id" text NOT NULL,
	"expires_at" timestamp NOT NULL,
	"revoked_at" timestamp,
	"created_at" timestamp DEFAULT now() NOT NULL,
	CONSTRAINT "veri_meeting_share_links_token_unique" UNIQUE("token")
);
--> statement-breakpoint
CREATE TABLE "compliance"."veri_meetings" (
	"id" text PRIMARY KEY NOT NULL,
	"org_id" text NOT NULL,
	"context_entity_type" text,
	"context_entity_id" text,
	"title" text NOT NULL,
	"meeting_type" text DEFAULT 'team' NOT NULL,
	"scheduled_at" timestamp NOT NULL,
	"attendees" jsonb DEFAULT '[]'::jsonb NOT NULL,
	"agenda" jsonb DEFAULT '[]'::jsonb NOT NULL,
	"minutes" text,
	"minutes_history" jsonb DEFAULT '[]'::jsonb NOT NULL,
	"system_id" text,
	"status" text DEFAULT 'draft' NOT NULL,
	"published_at" timestamp,
	"published_by_id" text,
	"ai_summary" text,
	"ai_key_decisions" jsonb DEFAULT '[]'::jsonb NOT NULL,
	"ai_suggested_action_items" jsonb DEFAULT '[]'::jsonb NOT NULL,
	"ai_generated_at" timestamp,
	"created_by_id" text NOT NULL,
	"created_at" timestamp DEFAULT now() NOT NULL,
	"updated_at" timestamp DEFAULT now() NOT NULL,
	CONSTRAINT "veri_meetings_system_id_unique" UNIQUE("system_id")
);
--> statement-breakpoint
CREATE TABLE "compliance"."veri_reward_achievement_definitions" (
	"id" text PRIMARY KEY NOT NULL,
	"org_id" text,
	"achievement_key" text NOT NULL,
	"context" text NOT NULL,
	"display_name" text NOT NULL,
	"description" text,
	"icon" text,
	"target_value" integer NOT NULL,
	"points_reward" integer NOT NULL,
	"is_active" boolean DEFAULT true NOT NULL,
	"created_at" timestamp DEFAULT now() NOT NULL,
	"updated_at" timestamp DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "compliance"."veri_reward_achievement_unlocks" (
	"id" text PRIMARY KEY NOT NULL,
	"org_id" text NOT NULL,
	"user_id" text NOT NULL,
	"achievement_definition_id" text NOT NULL,
	"progress_value" integer DEFAULT 0 NOT NULL,
	"unlocked_at" timestamp,
	"created_at" timestamp DEFAULT now() NOT NULL,
	"updated_at" timestamp DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "compliance"."veri_reward_points_ledger" (
	"id" text PRIMARY KEY NOT NULL,
	"org_id" text NOT NULL,
	"user_id" text NOT NULL,
	"delta" integer NOT NULL,
	"source_type" text NOT NULL,
	"source_id" text,
	"reason" text,
	"created_by_id" text,
	"created_at" timestamp DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "compliance"."veri_reward_referrals" (
	"id" text PRIMARY KEY NOT NULL,
	"org_id" text NOT NULL,
	"referrer_user_id" text NOT NULL,
	"referral_token" text NOT NULL,
	"target_type" text NOT NULL,
	"status" text DEFAULT 'clicked' NOT NULL,
	"referred_org_id" text,
	"referred_user_id" text,
	"click_count" integer DEFAULT 0 NOT NULL,
	"reward_points" integer,
	"clicked_at" timestamp,
	"signup_completed_at" timestamp,
	"org_provisioned_at" timestamp,
	"paid_at" timestamp,
	"created_at" timestamp DEFAULT now() NOT NULL,
	CONSTRAINT "veri_reward_referrals_referral_token_unique" UNIQUE("referral_token")
);
--> statement-breakpoint
CREATE TABLE "compliance"."veri_reward_streaks" (
	"id" text PRIMARY KEY NOT NULL,
	"org_id" text NOT NULL,
	"user_id" text NOT NULL,
	"streak_key" text NOT NULL,
	"current_count" integer DEFAULT 0 NOT NULL,
	"longest_count" integer DEFAULT 0 NOT NULL,
	"last_incremented_at" timestamp,
	"grace_used_at" timestamp,
	"created_at" timestamp DEFAULT now() NOT NULL,
	"updated_at" timestamp DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "compliance"."visitor_events" (
	"id" text PRIMARY KEY NOT NULL,
	"visitor_id" text NOT NULL,
	"event_type" text NOT NULL,
	"page" text NOT NULL,
	"product_key" text,
	"section" text,
	"metadata" jsonb,
	"created_at" timestamp DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "compliance"."visitor_sessions" (
	"id" text PRIMARY KEY NOT NULL,
	"visitor_id" text NOT NULL,
	"first_seen_at" timestamp DEFAULT now() NOT NULL,
	"last_seen_at" timestamp DEFAULT now() NOT NULL,
	"visit_count" integer DEFAULT 1 NOT NULL,
	"first_page" text,
	"last_page" text,
	"referrer" text,
	"user_agent" text,
	"converted_org_id" text,
	"converted_at" timestamp,
	CONSTRAINT "visitor_sessions_visitor_id_unique" UNIQUE("visitor_id")
);
--> statement-breakpoint
CREATE TABLE "compliance"."voice_memo_action_items" (
	"id" text PRIMARY KEY NOT NULL,
	"voice_memo_id" text NOT NULL,
	"task_id" text NOT NULL,
	"created_at" timestamp DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "compliance"."voice_memos" (
	"id" text PRIMARY KEY NOT NULL,
	"org_id" text NOT NULL,
	"user_id" text NOT NULL,
	"meeting_id" text,
	"audio_storage_path" text NOT NULL,
	"audio_mime_type" text,
	"duration_seconds" integer,
	"status" text DEFAULT 'uploaded' NOT NULL,
	"error_message" text,
	"transcript" text,
	"ai_summary" text,
	"ai_suggested_action_items" jsonb DEFAULT '[]'::jsonb NOT NULL,
	"ai_generated_at" timestamp,
	"transcribed_at" timestamp,
	"created_at" timestamp DEFAULT now() NOT NULL,
	"updated_at" timestamp DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "compliance"."webhook_deliveries" (
	"id" text PRIMARY KEY NOT NULL,
	"webhook_id" text NOT NULL,
	"event_type" text NOT NULL,
	"payload" jsonb NOT NULL,
	"status_code" integer,
	"response" text,
	"attempt" integer DEFAULT 1 NOT NULL,
	"success" boolean DEFAULT false NOT NULL,
	"created_at" timestamp DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "compliance"."webhooks" (
	"id" text PRIMARY KEY NOT NULL,
	"name" text NOT NULL,
	"url" text NOT NULL,
	"secret" text NOT NULL,
	"events" text NOT NULL,
	"is_active" boolean DEFAULT true NOT NULL,
	"org_id" text NOT NULL,
	"last_delivery_at" timestamp,
	"last_status_code" integer,
	"created_at" timestamp DEFAULT now() NOT NULL,
	"updated_at" timestamp DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "compliance"."whistleblower_cases" (
	"id" text PRIMARY KEY NOT NULL,
	"case_ref" text NOT NULL,
	"category" text,
	"received_date" timestamp NOT NULL,
	"status" text DEFAULT 'open' NOT NULL,
	"classification" text DEFAULT 'confidential' NOT NULL,
	"org_id" text NOT NULL,
	"client_id" text,
	"recorded_by_id" text NOT NULL,
	"created_at" timestamp DEFAULT now() NOT NULL,
	"updated_at" timestamp DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "platform"."worker_agent_domain_groups" (
	"id" text PRIMARY KEY NOT NULL,
	"key" text NOT NULL,
	"name" text NOT NULL,
	"description" text,
	"created_at" timestamp DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "platform"."worker_agent_domain_index" (
	"id" text PRIMARY KEY NOT NULL,
	"worker_agent_id" text NOT NULL,
	"domain_path" text NOT NULL,
	"created_at" timestamp DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "platform"."worker_agent_learnings" (
	"id" text PRIMARY KEY NOT NULL,
	"worker_agent_id" text NOT NULL,
	"content" text NOT NULL,
	"metadata" jsonb DEFAULT '{}'::jsonb NOT NULL,
	"created_at" timestamp DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "platform"."worker_agent_usage_log" (
	"id" text PRIMARY KEY NOT NULL,
	"worker_agent_id" text NOT NULL,
	"org_id" text,
	"client_id" text,
	"user_id" text,
	"executed_at" timestamp DEFAULT now() NOT NULL,
	"duration_ms" integer,
	"success" boolean DEFAULT true NOT NULL,
	"error_message" text
);
--> statement-breakpoint
CREATE TABLE "platform"."worker_agent_versions" (
	"id" text PRIMARY KEY NOT NULL,
	"worker_agent_id" text NOT NULL,
	"version" integer NOT NULL,
	"prompt_template" text,
	"input_schema" jsonb DEFAULT '{}'::jsonb NOT NULL,
	"output_schema" jsonb DEFAULT '{}'::jsonb NOT NULL,
	"changelog" text,
	"created_at" timestamp DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "platform"."worker_agents" (
	"id" text PRIMARY KEY NOT NULL,
	"tier" text NOT NULL,
	"name" text NOT NULL,
	"domain" text,
	"description" text,
	"code_reference" text,
	"prompt_template" text,
	"input_schema" jsonb DEFAULT '{}'::jsonb NOT NULL,
	"output_schema" jsonb DEFAULT '{}'::jsonb NOT NULL,
	"is_immutable" boolean DEFAULT false NOT NULL,
	"version" integer DEFAULT 1 NOT NULL,
	"usage_count" integer DEFAULT 0 NOT NULL,
	"accuracy_score" numeric,
	"org_id" text,
	"client_id" text,
	"user_id" text,
	"lifecycle_status" text DEFAULT 'published' NOT NULL,
	"supervisor_worker_agent_id" text,
	"domain_group_id" text,
	"proposed_by_id" text,
	"project_id" text,
	"created_at" timestamp DEFAULT now() NOT NULL,
	"updated_at" timestamp DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "compliance"."workspace_memory_capsule_events" (
	"id" text PRIMARY KEY NOT NULL,
	"org_id" text NOT NULL,
	"user_id" text NOT NULL,
	"direction" text NOT NULL,
	"storage_object_path" text NOT NULL,
	"file_size_bytes" integer NOT NULL,
	"item_counts" jsonb DEFAULT '{}'::jsonb NOT NULL,
	"status" text DEFAULT 'completed' NOT NULL,
	"error_message" text,
	"sync_method" text,
	"created_at" timestamp DEFAULT now() NOT NULL
);
--> statement-breakpoint
ALTER TABLE "compliance"."audit_logs" ALTER COLUMN "action" SET DATA TYPE text;--> statement-breakpoint
ALTER TABLE "compliance"."audit_logs" ALTER COLUMN "user_id" DROP NOT NULL;--> statement-breakpoint
ALTER TABLE "compliance"."documents" ALTER COLUMN "compliance_item_id" DROP NOT NULL;--> statement-breakpoint
ALTER TABLE "compliance"."audit_logs" ADD COLUMN "actor_name" text NOT NULL;--> statement-breakpoint
ALTER TABLE "compliance"."audit_logs" ADD COLUMN "actor_role" text NOT NULL;--> statement-breakpoint
ALTER TABLE "compliance"."audit_logs" ADD COLUMN "org_id" text NOT NULL;--> statement-breakpoint
ALTER TABLE "compliance"."audit_logs" ADD COLUMN "client_id" text;--> statement-breakpoint
ALTER TABLE "compliance"."audit_logs" ADD COLUMN "api_key_id" text;--> statement-breakpoint
ALTER TABLE "compliance"."audit_logs" ADD COLUMN "user_agent" text;--> statement-breakpoint
ALTER TABLE "compliance"."audit_logs" ADD COLUMN "support_session_id" text;--> statement-breakpoint
ALTER TABLE "compliance"."audit_logs" ADD COLUMN "acting_on_behalf_of_user_id" text;--> statement-breakpoint
ALTER TABLE "compliance"."audit_points" ADD COLUMN "client_id" text;--> statement-breakpoint
ALTER TABLE "compliance"."compliance_items" ADD COLUMN "filed_date" timestamp;--> statement-breakpoint
ALTER TABLE "compliance"."compliance_items" ADD COLUMN "paid_date" timestamp;--> statement-breakpoint
ALTER TABLE "compliance"."compliance_items" ADD COLUMN "client_id" text;--> statement-breakpoint
ALTER TABLE "compliance"."compliance_items" ADD COLUMN "period" text;--> statement-breakpoint
ALTER TABLE "compliance"."compliance_items" ADD COLUMN "financial_year" text;--> statement-breakpoint
ALTER TABLE "compliance"."compliance_items" ADD COLUMN "acknowledgement_number" text;--> statement-breakpoint
ALTER TABLE "compliance"."compliance_items" ADD COLUMN "registration_number" text;--> statement-breakpoint
ALTER TABLE "compliance"."compliance_items" ADD COLUMN "recurrence_type" "compliance"."recurrence_type" DEFAULT 'none' NOT NULL;--> statement-breakpoint
ALTER TABLE "compliance"."compliance_items" ADD COLUMN "recurrence_parent_id" text;--> statement-breakpoint
ALTER TABLE "compliance"."compliance_items" ADD COLUMN "is_template_suggested" boolean DEFAULT false NOT NULL;--> statement-breakpoint
ALTER TABLE "compliance"."compliance_items" ADD COLUMN "amount" numeric(14, 2);--> statement-breakpoint
ALTER TABLE "compliance"."documents" ADD COLUMN "notice_id" text;--> statement-breakpoint
ALTER TABLE "compliance"."documents" ADD COLUMN "extracted_data" jsonb;--> statement-breakpoint
ALTER TABLE "compliance"."documents" ADD COLUMN "org_id" text NOT NULL;--> statement-breakpoint
ALTER TABLE "compliance"."documents" ADD COLUMN "client_id" text;--> statement-breakpoint
ALTER TABLE "compliance"."documents" ADD COLUMN "category" text;--> statement-breakpoint
ALTER TABLE "compliance"."documents" ADD COLUMN "expiry_date" timestamp;--> statement-breakpoint
ALTER TABLE "compliance"."documents" ADD COLUMN "linked_entity_type" text;--> statement-breakpoint
ALTER TABLE "compliance"."documents" ADD COLUMN "linked_entity_id" text;--> statement-breakpoint
ALTER TABLE "compliance"."documents" ADD COLUMN "parent_document_id" text;--> statement-breakpoint
ALTER TABLE "compliance"."documents" ADD COLUMN "version_number" integer DEFAULT 1 NOT NULL;--> statement-breakpoint
ALTER TABLE "compliance"."documents" ADD COLUMN "is_latest_version" boolean DEFAULT true NOT NULL;--> statement-breakpoint
ALTER TABLE "compliance"."documents" ADD COLUMN "retention_period_days" integer;--> statement-breakpoint
ALTER TABLE "compliance"."documents" ADD COLUMN "disposal_date" date;--> statement-breakpoint
ALTER TABLE "compliance"."documents" ADD COLUMN "legal_hold" boolean DEFAULT false NOT NULL;--> statement-breakpoint
ALTER TABLE "compliance"."documents" ADD COLUMN "is_disposed" boolean DEFAULT false NOT NULL;--> statement-breakpoint
ALTER TABLE "compliance"."documents" ADD COLUMN "disposed_at" timestamp;--> statement-breakpoint
ALTER TABLE "compliance"."documents" ADD COLUMN "disposed_by_id" text;--> statement-breakpoint
ALTER TABLE "compliance"."documents" ADD COLUMN "metadata" jsonb;--> statement-breakpoint
ALTER TABLE "compliance"."documents" ADD COLUMN "correspondent_id" text;--> statement-breakpoint
ALTER TABLE "compliance"."documents" ADD COLUMN "tags" jsonb DEFAULT '[]'::jsonb NOT NULL;--> statement-breakpoint
ALTER TABLE "compliance"."documents" ADD COLUMN "auto_classified" boolean DEFAULT false NOT NULL;--> statement-breakpoint
ALTER TABLE "compliance"."notifications" ADD COLUMN "metadata" jsonb DEFAULT '{}'::jsonb NOT NULL;--> statement-breakpoint
ALTER TABLE "compliance"."organisations" ADD COLUMN "entity_type" text;--> statement-breakpoint
ALTER TABLE "compliance"."organisations" ADD COLUMN "account_type" text DEFAULT 'company' NOT NULL;--> statement-breakpoint
ALTER TABLE "compliance"."organisations" ADD COLUMN "address" text;--> statement-breakpoint
ALTER TABLE "compliance"."organisations" ADD COLUMN "cin_number" text;--> statement-breakpoint
ALTER TABLE "compliance"."organisations" ADD COLUMN "gstin" text;--> statement-breakpoint
ALTER TABLE "compliance"."organisations" ADD COLUMN "pan_number" text;--> statement-breakpoint
ALTER TABLE "compliance"."organisations" ADD COLUMN "regulatory_entity_type" text DEFAULT 'general' NOT NULL;--> statement-breakpoint
ALTER TABLE "compliance"."organisations" ADD COLUMN "trial_starts_at" timestamp;--> statement-breakpoint
ALTER TABLE "compliance"."organisations" ADD COLUMN "trial_ends_at" timestamp;--> statement-breakpoint
ALTER TABLE "compliance"."organisations" ADD COLUMN "is_read_only" boolean DEFAULT false NOT NULL;--> statement-breakpoint
ALTER TABLE "compliance"."organisations" ADD COLUMN "subscription_plan_id" text;--> statement-breakpoint
ALTER TABLE "compliance"."organisations" ADD COLUMN "licensed_seats" integer;--> statement-breakpoint
ALTER TABLE "compliance"."organisations" ADD COLUMN "seat_enforcement_enabled" boolean DEFAULT false NOT NULL;--> statement-breakpoint
ALTER TABLE "compliance"."organisations" ADD COLUMN "monthly_cost_cap_usd" numeric(10, 2);--> statement-breakpoint
ALTER TABLE "compliance"."organisations" ADD COLUMN "cost_cap_enforcement_enabled" boolean DEFAULT true NOT NULL;--> statement-breakpoint
ALTER TABLE "compliance"."organisations" ADD COLUMN "session_limit_enforcement_enabled" boolean DEFAULT false NOT NULL;--> statement-breakpoint
ALTER TABLE "compliance"."organisations" ADD COLUMN "max_concurrent_sessions" integer DEFAULT 2 NOT NULL;--> statement-breakpoint
ALTER TABLE "compliance"."organisations" ADD COLUMN "internal_use_exempt" boolean DEFAULT false NOT NULL;--> statement-breakpoint
ALTER TABLE "compliance"."organisations" ADD COLUMN "primary_product_branch_id" text;--> statement-breakpoint
ALTER TABLE "compliance"."organisations" ADD COLUMN "country" text DEFAULT 'IN';--> statement-breakpoint
ALTER TABLE "compliance"."organisations" ADD COLUMN "brand_primary_color" text;--> statement-breakpoint
ALTER TABLE "compliance"."organisations" ADD COLUMN "brand_accent_color" text;--> statement-breakpoint
ALTER TABLE "compliance"."organisations" ADD COLUMN "favicon_url" text;--> statement-breakpoint
ALTER TABLE "compliance"."organisations" ADD COLUMN "custom_domain" text;--> statement-breakpoint
ALTER TABLE "compliance"."organisations" ADD COLUMN "email_sender_name" text;--> statement-breakpoint
ALTER TABLE "compliance"."users" ADD COLUMN "onboarding_completed" boolean DEFAULT false NOT NULL;--> statement-breakpoint
ALTER TABLE "compliance"."users" ADD COLUMN "onboarding_stage" text DEFAULT 'profile' NOT NULL;--> statement-breakpoint
ALTER TABLE "compliance"."users" ADD COLUMN "auth_user_id" text;--> statement-breakpoint
ALTER TABLE "compliance"."users" ADD COLUMN "reporting_to_id" text;--> statement-breakpoint
ALTER TABLE "compliance"."users" ADD COLUMN "account_stage" text;--> statement-breakpoint
ALTER TABLE "compliance"."users" ADD COLUMN "passcode_hash" text;--> statement-breakpoint
ALTER TABLE "compliance"."users" ADD COLUMN "passcode_set_at" timestamp;--> statement-breakpoint
ALTER TABLE "compliance"."erp_item_batches" ADD CONSTRAINT "erp_item_batches_item_id_erp_items_id_fk" FOREIGN KEY ("item_id") REFERENCES "compliance"."erp_items"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "compliance"."erp_item_serials" ADD CONSTRAINT "erp_item_serials_item_id_erp_items_id_fk" FOREIGN KEY ("item_id") REFERENCES "compliance"."erp_items"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "compliance"."erp_item_serials" ADD CONSTRAINT "erp_item_serials_warehouse_id_erp_warehouses_id_fk" FOREIGN KEY ("warehouse_id") REFERENCES "compliance"."erp_warehouses"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "compliance"."erp_item_uom_conversions" ADD CONSTRAINT "erp_item_uom_conversions_item_id_erp_items_id_fk" FOREIGN KEY ("item_id") REFERENCES "compliance"."erp_items"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "compliance"."erp_payslip_lines" ADD CONSTRAINT "erp_payslip_lines_payslip_id_erp_payslips_id_fk" FOREIGN KEY ("payslip_id") REFERENCES "compliance"."erp_payslips"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "compliance"."erp_payslip_lines" ADD CONSTRAINT "erp_payslip_lines_component_id_erp_salary_components_id_fk" FOREIGN KEY ("component_id") REFERENCES "compliance"."erp_salary_components"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "compliance"."erp_payslips" ADD CONSTRAINT "erp_payslips_payroll_run_id_erp_payroll_runs_id_fk" FOREIGN KEY ("payroll_run_id") REFERENCES "compliance"."erp_payroll_runs"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "compliance"."erp_payslips" ADD CONSTRAINT "erp_payslips_employee_id_employee_profiles_id_fk" FOREIGN KEY ("employee_id") REFERENCES "compliance"."employee_profiles"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "compliance"."erp_salary_structure_components" ADD CONSTRAINT "erp_salary_structure_components_structure_id_erp_salary_structures_id_fk" FOREIGN KEY ("structure_id") REFERENCES "compliance"."erp_salary_structures"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "compliance"."erp_salary_structure_components" ADD CONSTRAINT "erp_salary_structure_components_component_id_erp_salary_components_id_fk" FOREIGN KEY ("component_id") REFERENCES "compliance"."erp_salary_components"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "compliance"."erp_salary_structures" ADD CONSTRAINT "erp_salary_structures_employee_id_employee_profiles_id_fk" FOREIGN KEY ("employee_id") REFERENCES "compliance"."employee_profiles"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "compliance"."organisations" ADD CONSTRAINT "organisations_custom_domain_unique" UNIQUE("custom_domain");