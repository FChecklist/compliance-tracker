-- Priority 15 Wave 2 (HR & Payroll follow-up, deferred from Wave 1 / PR
-- #330): employmentStatus + emergency contact on employee_profiles.
-- employment_status is a new enum (matching this schema's established
-- `complianceSchemaDB.enum(...)` convention for status fields, e.g.
-- erp_payroll_run_status, sales_partner_status), NOT NULL with a
-- default of 'active' -- safe for every existing employee_profiles row,
-- since nothing in this codebase soft-deletes that table (an employee
-- profile that already exists is, by definition, currently active).
-- Emergency contact is 2 nullable free-text columns on the same row, not
-- a separate table -- one contact per employee, no 1:many need.

DO $$ BEGIN
  CREATE TYPE compliance.employment_status AS ENUM ('active', 'on_leave', 'terminated', 'resigned');
EXCEPTION
  WHEN duplicate_object THEN NULL;
END $$;

ALTER TABLE compliance.employee_profiles ADD COLUMN IF NOT EXISTS employment_status compliance.employment_status NOT NULL DEFAULT 'active';
ALTER TABLE compliance.employee_profiles ADD COLUMN IF NOT EXISTS emergency_contact_name text;
ALTER TABLE compliance.employee_profiles ADD COLUMN IF NOT EXISTS emergency_contact_phone text;
