-- Seed Data for Development
-- Run with: psql $DATABASE_URL < supabase/seed.sql

-- Organisation
INSERT INTO organisations (id, name, slug, plan_type, owner_id, is_active, settings)
VALUES (
  'a0000000-0000-0000-0000-000000000001',
  'Demo Company Pvt Ltd',
  'demo-company',
  'single_entity',
  'a0000000-0000-0000-0000-000000000010',
  true,
  '{"timezone": "Asia/Kolkata", "currency": "INR"}'::jsonb
);

-- Users
INSERT INTO users (id, email, phone, full_name, org_id, role, is_active) VALUES
('a0000000-0000-0000-0000-000000000010', 'admin@demo.com', '+919876543210', 'Admin User', 'a0000000-0000-0000-0000-000000000001', 'account_admin', true),
('a0000000-0000-0000-0000-000000000011', 'deptadmin@demo.com', '+919876543211', 'Dept Admin', 'a0000000-0000-0000-0000-000000000001', 'client_department_admin', true),
('a0000000-0000-0000-0000-000000000012', 'editor@demo.com', '+919876543212', 'Editor User', 'a0000000-0000-0000-0000-000000000001', 'editor', true);

-- Departments
INSERT INTO departments (id, org_id, name, description, head_user_id, is_active) VALUES
('b0000000-0000-0000-0000-000000000001', 'a0000000-0000-0000-0000-000000000001', 'Finance', 'Financial compliance and reporting', 'a0000000-0000-0000-0000-000000000011', true),
('b0000000-0000-0000-0000-000000000002', 'a0000000-0000-0000-0000-000000000001', 'IT', 'IT and cybersecurity compliance', 'a0000000-0000-0000-0000-000000000011', true),
('b0000000-0000-0000-0000-000000000003', 'a0000000-0000-0000-0000-000000000001', 'HR', 'Human resources and labour law compliance', 'a0000000-0000-0000-0000-000000000011', true);

-- Compliance Items
INSERT INTO compliance (id, org_id, department_id, title, description, compliance_type, status, priority, assignee_id, due_date, unique_url_slug) VALUES
('c0000000-0000-0000-0000-000000000001', 'a0000000-0000-0000-0000-000000000001', 'b0000000-0000-0000-0000-000000000001', 'GST Monthly Return - June 2026', 'File GSTR-3B for June 2026 billing period', 'tax', 'in_progress', 'high', 'a0000000-0000-0000-0000-000000000012', '2026-07-20T23:59:59Z', 'gst-monthly-return-june-2026'),
('c0000000-0000-0000-0000-000000000002', 'a0000000-0000-0000-0000-000000000001', 'b0000000-0000-0000-0000-000000000002', 'ISO 27001 Annual Audit', 'Annual information security management system audit', 'regulatory', 'pending', 'critical', 'a0000000-0000-0000-0000-000000000012', '2026-09-30T23:59:59Z', 'iso-27001-annual-audit'),
('c0000000-0000-0000-0000-000000000003', 'a0000000-0000-0000-0000-000000000001', 'b0000000-0000-0000-0000-000000000003', 'PF Monthly Return - June 2026', 'File provident fund monthly return for June', 'hr', 'pending', 'high', 'a0000000-0000-0000-0000-000000000012', '2026-07-15T23:59:59Z', 'pf-monthly-return-june-2026'),
('c0000000-0000-0000-0000-000000000004', 'a0000000-0000-0000-0000-000000000001', 'b0000000-0000-0000-0000-000000000001', 'TDS Quarterly Return Q1', 'File TDS return for April-June quarter', 'tax', 'draft', 'medium', NULL, '2026-07-31T23:59:59Z', 'tds-quarterly-return-q1'),
('c0000000-0000-0000-0000-000000000005', 'a0000000-0000-0000-0000-000000000001', 'b0000000-0000-0000-0000-000000000002', 'Cybersecurity Risk Assessment', 'Conduct annual cybersecurity risk assessment', 'it', 'pending', 'critical', 'a0000000-0000-0000-0000-000000000012', '2026-08-31T23:59:59Z', 'cybersecurity-risk-assessment');
