-- VERIDIAN Review Framework gap-closure (2026-07-18), "ABAC / Fine-Grained
-- Policies" (Critical): "No attribute-based access control exists; RBAC
-- only." Two additive pieces:
--
-- 1. approval_workflow_step_definitions.conditions -- a nullable jsonb
--    array of AttributeCondition (src/lib/abac.ts), AND-combined with each
--    other and with the pre-existing single condition_field/
--    condition_operator/condition_value columns when both are present.
--    Generalizes Wave 51's original single-numeric-field predicate into a
--    real multi-attribute gate. Existing rows (null) are fully unaffected.
--
-- 2. abac_policies -- a new org-scoped table backing abac-policy-service.ts's
--    supplementary DENY-only policy overlay (evaluated after RBAC has
--    already allowed an action; never itself grants access). Standard
--    org-scoped RLS+FORCE per ARCH-03 (MASTER_AI_OS_ARCHITECTURE.md #4),
--    in this same migration.

ALTER TABLE compliance.approval_workflow_step_definitions ADD COLUMN IF NOT EXISTS conditions jsonb;

CREATE TYPE compliance.abac_policy_effect AS ENUM ('deny');

CREATE TABLE IF NOT EXISTS compliance.abac_policies (
  id text PRIMARY KEY DEFAULT gen_random_uuid()::text,
  org_id text NOT NULL REFERENCES compliance.organisations(id),
  resource_type text NOT NULL,
  action text NOT NULL,
  effect compliance.abac_policy_effect NOT NULL DEFAULT 'deny',
  conditions jsonb NOT NULL DEFAULT '[]',
  description text,
  priority integer NOT NULL DEFAULT 100,
  is_active boolean NOT NULL DEFAULT true,
  created_by_id text REFERENCES compliance.users(id),
  created_at timestamp NOT NULL DEFAULT now(),
  updated_at timestamp NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS abac_policies_org_resource_action_idx
  ON compliance.abac_policies (org_id, resource_type, action) WHERE is_active;

ALTER TABLE compliance.abac_policies ENABLE ROW LEVEL SECURITY;
ALTER TABLE compliance.abac_policies FORCE ROW LEVEL SECURITY;
DO $$ BEGIN
  CREATE POLICY app_runtime_org_scoped ON compliance.abac_policies FOR ALL TO app_runtime
    USING (org_id = compliance.current_org_id());
EXCEPTION WHEN duplicate_object THEN NULL; END $$;
DO $$ BEGIN
  CREATE POLICY service_role_bypass_abac_policies ON compliance.abac_policies FOR ALL TO service_role USING (true);
EXCEPTION WHEN duplicate_object THEN NULL; END $$;
