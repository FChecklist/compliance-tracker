-- Migration 004: Updated At Trigger

CREATE OR REPLACE FUNCTION update_updated_at_column()
RETURNS TRIGGER AS $$
BEGIN
  NEW.updated_at = now();
  RETURN NEW;
END;
$$ LANGUAGE plpgsql;

-- Apply updated_at trigger to all tables that have it
CREATE TRIGGER organisations_updated_at BEFORE UPDATE ON organisations
  FOR EACH ROW EXECUTE FUNCTION update_updated_at_column();
CREATE TRIGGER users_updated_at BEFORE UPDATE ON users
  FOR EACH ROW EXECUTE FUNCTION update_updated_at_column();
CREATE TRIGGER departments_updated_at BEFORE UPDATE ON departments
  FOR EACH ROW EXECUTE FUNCTION update_updated_at_column();
CREATE TRIGGER compliance_updated_at BEFORE UPDATE ON compliance
  FOR EACH ROW EXECUTE FUNCTION update_updated_at_column();
CREATE TRIGGER audit_points_updated_at BEFORE UPDATE ON audit_points
  FOR EACH ROW EXECUTE FUNCTION update_updated_at_column();
CREATE TRIGGER comments_updated_at BEFORE UPDATE ON comments
  FOR EACH ROW EXECUTE FUNCTION update_updated_at_column();
CREATE TRIGGER webhooks_updated_at BEFORE UPDATE ON webhooks
  FOR EACH ROW EXECUTE FUNCTION update_updated_at_column();
CREATE TRIGGER sales_agents_updated_at BEFORE UPDATE ON sales_agents
  FOR EACH ROW EXECUTE FUNCTION update_updated_at_column();

-- Permission scopes seed data
INSERT INTO permission_scopes (role, resource, action) VALUES
  ('account_admin', 'organisations', 'manage'),
  ('account_admin', 'users', 'manage'),
  ('account_admin', 'departments', 'manage'),
  ('account_admin', 'compliance', 'manage'),
  ('account_admin', 'documents', 'manage'),
  ('account_admin', 'audit_log', 'read'),
  ('account_admin', 'reports', 'read'),
  ('account_admin', 'settings', 'manage'),
  ('account_admin', 'api_tokens', 'manage'),
  ('account_admin', 'webhooks', 'manage'),
  ('account_admin', 'sales', 'manage'),
  ('client_department_admin', 'users', 'manage_within_scope'),
  ('client_department_admin', 'departments', 'manage_within_scope'),
  ('client_department_admin', 'compliance', 'manage_within_scope'),
  ('client_department_admin', 'documents', 'manage_within_scope'),
  ('client_department_admin', 'audit_log', 'read_within_scope'),
  ('editor', 'compliance', 'edit_within_scope'),
  ('editor', 'documents', 'manage_within_scope'),
  ('editor', 'comments', 'manage'),
  ('viewer', 'compliance', 'read_within_scope'),
  ('viewer', 'documents', 'read_within_scope'),
  ('viewer', 'audit_log', 'read_within_scope'),
  ('viewer', 'comments', 'read');
