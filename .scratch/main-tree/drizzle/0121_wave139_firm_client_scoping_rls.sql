-- Gap closure, CRITICAL_GAPS.md #2 / AUDIT_2026-07-09.md (2026-07-09).
-- Applied live via Supabase MCP apply_migration.
--
-- The Firm practice module's 9 tables were RLS-scoped by org_id only --
-- confirmed live (pg_policy query) that none referenced
-- compliance.current_client_ids() at all, meaning any authenticated user in
-- an org could read/write every client's Firm data regardless of the
-- existing (but until now, unenforced) compliance.user_client_access grant
-- table. This adds the same client_id = ANY(current_client_ids()) pattern
-- Wave 3's worker_agents tier='client' policies already established, to
-- every firm_* table -- app code now sets clientIds via
-- withFirmTenantContext (firm-enablement-service.ts) before every query, so
-- this is the DB-level backstop for a forgotten application-level check,
-- exactly the same "RLS is the real gate" posture as org_id everywhere else
-- in this schema.
--
-- FOR ALL policies with only USING set (no explicit WITH CHECK) already use
-- the USING expression for INSERT/UPDATE validation too (Postgres default),
-- so this single DROP+CREATE per table covers both reads and writes.

DROP POLICY IF EXISTS app_runtime_org_scoped ON compliance.firm_client_service_lines;
CREATE POLICY app_runtime_org_scoped ON compliance.firm_client_service_lines FOR ALL TO app_runtime
USING (org_id = compliance.current_org_id() AND client_id = ANY (compliance.current_client_ids()));

DROP POLICY IF EXISTS app_runtime_org_scoped ON compliance.firm_engagements;
CREATE POLICY app_runtime_org_scoped ON compliance.firm_engagements FOR ALL TO app_runtime
USING (org_id = compliance.current_org_id() AND client_id = ANY (compliance.current_client_ids()));

DROP POLICY IF EXISTS app_runtime_org_scoped ON compliance.firm_tax_cases;
CREATE POLICY app_runtime_org_scoped ON compliance.firm_tax_cases FOR ALL TO app_runtime
USING (org_id = compliance.current_org_id() AND client_id = ANY (compliance.current_client_ids()));

DROP POLICY IF EXISTS app_runtime_org_scoped ON compliance.firm_staff_assignments;
CREATE POLICY app_runtime_org_scoped ON compliance.firm_staff_assignments FOR ALL TO app_runtime
USING (org_id = compliance.current_org_id() AND client_id = ANY (compliance.current_client_ids()));

DROP POLICY IF EXISTS app_runtime_org_scoped ON compliance.firm_time_entries;
CREATE POLICY app_runtime_org_scoped ON compliance.firm_time_entries FOR ALL TO app_runtime
USING (org_id = compliance.current_org_id() AND client_id = ANY (compliance.current_client_ids()));

DROP POLICY IF EXISTS app_runtime_org_scoped ON compliance.firm_invoices;
CREATE POLICY app_runtime_org_scoped ON compliance.firm_invoices FOR ALL TO app_runtime
USING (org_id = compliance.current_org_id() AND client_id = ANY (compliance.current_client_ids()));

-- client_id is nullable here -- NULL means a firm-wide default rate
-- (see firm-billing-service.ts's resolveBillableRate 4-tier precedence),
-- not a specific client, so it must stay visible regardless of access.
DROP POLICY IF EXISTS app_runtime_org_scoped ON compliance.firm_billable_rates;
CREATE POLICY app_runtime_org_scoped ON compliance.firm_billable_rates FOR ALL TO app_runtime
USING (org_id = compliance.current_org_id() AND (client_id IS NULL OR client_id = ANY (compliance.current_client_ids())));

-- No direct client_id column -- scoped via its parent engagement.
DROP POLICY IF EXISTS app_runtime_org_scoped ON compliance.firm_engagement_deliverables;
CREATE POLICY app_runtime_org_scoped ON compliance.firm_engagement_deliverables FOR ALL TO app_runtime
USING (org_id = compliance.current_org_id() AND EXISTS (
  SELECT 1 FROM compliance.firm_engagements fe
  WHERE fe.id = firm_engagement_deliverables.engagement_id AND fe.client_id = ANY (compliance.current_client_ids())
));

-- No direct client_id column -- scoped via its parent invoice.
DROP POLICY IF EXISTS app_runtime_org_scoped ON compliance.firm_invoice_line_items;
CREATE POLICY app_runtime_org_scoped ON compliance.firm_invoice_line_items FOR ALL TO app_runtime
USING (org_id = compliance.current_org_id() AND EXISTS (
  SELECT 1 FROM compliance.firm_invoices fi
  WHERE fi.id = firm_invoice_line_items.invoice_id AND fi.client_id = ANY (compliance.current_client_ids())
));
