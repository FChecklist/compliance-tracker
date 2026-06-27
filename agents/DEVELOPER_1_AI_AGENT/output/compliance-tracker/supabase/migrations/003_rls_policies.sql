-- Migration 003: Row Level Security Policies
-- All tables enforce org-level isolation

ALTER TABLE organisations ENABLE ROW LEVEL SECURITY;
ALTER TABLE users ENABLE ROW LEVEL SECURITY;
ALTER TABLE departments ENABLE ROW LEVEL SECURITY;
ALTER TABLE compliance ENABLE ROW LEVEL SECURITY;
ALTER TABLE compliance_history ENABLE ROW LEVEL SECURITY;
ALTER TABLE audit_points ENABLE ROW LEVEL SECURITY;
ALTER TABLE comments ENABLE ROW LEVEL SECURITY;
ALTER TABLE audit_log ENABLE ROW LEVEL SECURITY;
ALTER TABLE documents ENABLE ROW LEVEL SECURITY;
ALTER TABLE notifications ENABLE ROW LEVEL SECURITY;
ALTER TABLE permission_scopes ENABLE ROW LEVEL SECURITY;
ALTER TABLE api_tokens ENABLE ROW LEVEL SECURITY;
ALTER TABLE webhooks ENABLE ROW LEVEL SECURITY;
ALTER TABLE sales_agents ENABLE ROW LEVEL SECURITY;
ALTER TABLE discount_codes ENABLE ROW LEVEL SECURITY;
ALTER TABLE commissions ENABLE ROW LEVEL SECURITY;
ALTER TABLE incentives ENABLE ROW LEVEL SECURITY;
ALTER TABLE sales_channels ENABLE ROW LEVEL SECURITY;
ALTER TABLE access_requests ENABLE ROW LEVEL SECURITY;
ALTER TABLE email_logs ENABLE ROW LEVEL SECURITY;

-- Helper: service role bypasses RLS (for backend API)
CREATE OR REPLACE FUNCTION auth.jwt() RETURNS JSONB AS $$
  SELECT coalesce(nullif(current_setting('request.jwt.claims', true), ''), '{}')::jsonb;
$$ LANGUAGE sql STABLE;

CREATE OR REPLACE FUNCTION auth.org_id() RETURNS UUID AS $$
  SELECT (auth.jwt()->>'org_id')::uuid;
$$ LANGUAGE sql STABLE;

CREATE OR REPLACE FUNCTION auth.user_id() RETURNS UUID AS $$
  SELECT (auth.jwt()->>'sub')::uuid;
$$ LANGUAGE sql STABLE;

CREATE OR REPLACE FUNCTION auth.user_role() RETURNS TEXT AS $$
  SELECT auth.jwt()->>'role';
$$ LANGUAGE sql STABLE;

-- ORGANISATIONS: service role can do anything, users see their own org
CREATE POLICY "service_all_organisations" ON organisations
  FOR ALL USING (auth.role() = 'service_role');

CREATE POLICY "users_own_org" ON organisations
  FOR SELECT USING (id = auth.org_id());

CREATE POLICY "users_own_org_insert" ON organisations
  FOR INSERT WITH CHECK (auth.org_id() IS NOT NULL);

-- USERS: users see users in their own org
CREATE POLICY "service_all_users" ON users FOR ALL USING (auth.role() = 'service_role');

CREATE POLICY "users_same_org" ON users
  FOR SELECT USING (org_id = auth.org_id());

CREATE POLICY "users_same_org_update" ON users
  FOR UPDATE USING (org_id = auth.org_id());

-- DEPARTMENTS
CREATE POLICY "service_all_departments" ON departments FOR ALL USING (auth.role() = 'service_role');
CREATE POLICY "departments_same_org" ON departments
  FOR ALL USING (org_id = auth.org_id());

-- COMPLIANCE
CREATE POLICY "service_all_compliance" ON compliance FOR ALL USING (auth.role() = 'service_role');
CREATE POLICY "compliance_same_org" ON compliance
  FOR ALL USING (org_id = auth.org_id());

-- COMPLIANCE HISTORY
CREATE POLICY "service_all_compliance_history" ON compliance_history FOR ALL USING (auth.role() = 'service_role');
CREATE POLICY "compliance_history_same_org" ON compliance_history
  FOR ALL USING (
    EXISTS (SELECT 1 FROM compliance c WHERE c.id = compliance_history.compliance_id AND c.org_id = auth.org_id())
  );

-- AUDIT POINTS
CREATE POLICY "service_all_audit_points" ON audit_points FOR ALL USING (auth.role() = 'service_role');
CREATE POLICY "audit_points_same_org" ON audit_points
  FOR ALL USING (
    EXISTS (SELECT 1 FROM compliance c WHERE c.id = audit_points.compliance_id AND c.org_id = auth.org_id())
  );

-- COMMENTS
CREATE POLICY "service_all_comments" ON comments FOR ALL USING (auth.role() = 'service_role');
CREATE POLICY "comments_same_org" ON comments
  FOR ALL USING (
    EXISTS (SELECT 1 FROM compliance c WHERE c.id = comments.compliance_id AND c.org_id = auth.org_id())
  );

-- AUDIT LOG
CREATE POLICY "service_all_audit_log" ON audit_log FOR ALL USING (auth.role() = 'service_role');
CREATE POLICY "audit_log_same_org" ON audit_log
  FOR SELECT USING (org_id = auth.org_id());

-- DOCUMENTS
CREATE POLICY "service_all_documents" ON documents FOR ALL USING (auth.role() = 'service_role');
CREATE POLICY "documents_same_org" ON documents FOR ALL USING (org_id = auth.org_id());

-- NOTIFICATIONS
CREATE POLICY "service_all_notifications" ON notifications FOR ALL USING (auth.role() = 'service_role');
CREATE POLICY "notifications_own" ON notifications
  FOR ALL USING (user_id = auth.user_id());

-- PERMISSION SCOPES: readable by all
CREATE POLICY "service_all_permissions" ON permission_scopes FOR ALL USING (auth.role() = 'service_role');
CREATE POLICY "permissions_readable" ON permission_scopes FOR SELECT USING (true);

-- API TOKENS, WEBHOOKS, SALES TABLES
CREATE POLICY "service_all_api_tokens" ON api_tokens FOR ALL USING (auth.role() = 'service_role');
CREATE POLICY "api_tokens_same_org" ON api_tokens FOR ALL USING (org_id = auth.org_id());

CREATE POLICY "service_all_webhooks" ON webhooks FOR ALL USING (auth.role() = 'service_role');
CREATE POLICY "webhooks_same_org" ON webhooks FOR ALL USING (org_id = auth.org_id());

CREATE POLICY "service_all_sales_agents" ON sales_agents FOR ALL USING (auth.role() = 'service_role');
CREATE POLICY "sales_agents_same_org" ON sales_agents FOR ALL USING (org_id = auth.org_id());

CREATE POLICY "service_all_discount_codes" ON discount_codes FOR ALL USING (auth.role() = 'service_role');
CREATE POLICY "discount_codes_readable" ON discount_codes FOR SELECT USING (true);

CREATE POLICY "service_all_commissions" ON commissions FOR ALL USING (auth.role() = 'service_role');
CREATE POLICY "commissions_same_org" ON commissions FOR ALL USING (
  EXISTS (SELECT 1 FROM sales_agents sa WHERE sa.id = commissions.agent_id AND sa.org_id = auth.org_id())
);

CREATE POLICY "service_all_incentives" ON incentives FOR ALL USING (auth.role() = 'service_role');
CREATE POLICY "incentives_same_org" ON incentives FOR ALL USING (
  EXISTS (SELECT 1 FROM sales_agents sa WHERE sa.id = incentives.agent_id AND sa.org_id = auth.org_id())
);

CREATE POLICY "service_all_sales_channels" ON sales_channels FOR ALL USING (auth.role() = 'service_role');
CREATE POLICY "sales_channels_readable" ON sales_channels FOR SELECT USING (true);

CREATE POLICY "service_all_access_requests" ON access_requests FOR ALL USING (auth.role() = 'service_role');
CREATE POLICY "access_requests_same_org" ON access_requests FOR ALL USING (org_id = auth.org_id());

CREATE POLICY "service_all_email_logs" ON email_logs FOR ALL USING (auth.role() = 'service_role');
CREATE POLICY "email_logs_same_org" ON email_logs FOR SELECT USING (org_id = auth.org_id());
