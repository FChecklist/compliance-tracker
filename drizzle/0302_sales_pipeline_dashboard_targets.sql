CREATE TABLE "compliance"."crm_sales_targets" (
	"id" text PRIMARY KEY NOT NULL,
	"org_id" text NOT NULL,
	"month" date NOT NULL,
	"target_value" numeric NOT NULL,
	"created_by_id" text,
	"created_at" timestamp DEFAULT now() NOT NULL,
	"updated_at" timestamp DEFAULT now() NOT NULL
);

-- Row Level Security (app_runtime_tenant_isolation + service_role_bypass,
-- matching the standard pattern established in
-- 0101_wave115_construction_boq_progress_diary.sql / 0100_gst_reconciliation_engine.sql).
-- app_runtime has no RLS bypass (src/lib/db/tenant-scoped.ts) -- without this,
-- crm_sales_targets had zero DB-level tenant isolation and relied entirely on
-- crm-service.ts's application-level eq(crmSalesTargets.orgId, ctx.orgId) filter.
ALTER TABLE compliance.crm_sales_targets ENABLE ROW LEVEL SECURITY;
DO $$ BEGIN
  CREATE POLICY app_runtime_tenant_isolation ON compliance.crm_sales_targets FOR ALL TO app_runtime
    USING (org_id = compliance.current_org_id());
EXCEPTION WHEN duplicate_object THEN NULL; END $$;
DO $$ BEGIN
  CREATE POLICY service_role_bypass_crm_sales_targets ON compliance.crm_sales_targets FOR ALL TO service_role USING (true);
EXCEPTION WHEN duplicate_object THEN NULL; END $$;

-- Indexes matching sales-pipeline-dashboard-service.ts's query patterns
-- (crm-service.ts's getSalesPipelineDashboardData filters by org_id alone;
-- setSalesTarget's find-or-create filters by org_id + month together).
CREATE INDEX IF NOT EXISTS idx_crm_sales_targets_org_id ON compliance.crm_sales_targets(org_id);
CREATE INDEX IF NOT EXISTS idx_crm_sales_targets_org_id_month ON compliance.crm_sales_targets(org_id, month);
