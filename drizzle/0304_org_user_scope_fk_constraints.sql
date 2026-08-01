-- VERIDIAN Review Framework gap-closure (2026-08-01): Low Coupling / High
-- Cohesion -- "Data-layer coupling is implicit, not enforced. Add FK
-- constraints incrementally for the highest-traffic relationships, starting
-- with org/user scoping."
--
-- Real state confirmed before writing this (not assumed): 322 orgId columns
-- and 46 userId columns across schema.ts, 0 of either with a Drizzle
-- `.references()` -- org/client scoping today is enforced entirely in
-- application code (`WHERE org_id = ...`), documented at
-- drizzle/0003_enable_rls_exposed_compliance_tables.sql as a deliberate
-- choice (the app connects as the `postgres` superuser, so RLS is not the
-- enforcement layer either). Two real precedents already exist for FK'd
-- org_id, just not applied to these specific tables:
--   - drizzle/0005_wave7_hierarchy_and_audit_foundation.sql declares brand
--     new tables (clients, user_client_access) with
--     `org_id text NOT NULL REFERENCES compliance.organisations(id)` at
--     CREATE TABLE time.
--   - drizzle/0265_pms_timesheet_invoice_link.sql retrofits a FK onto an
--     existing column via a plain `ALTER TABLE ... ADD CONSTRAINT` -- and,
--     matching that precedent exactly, schema.ts's own invoiceItemId field
--     was deliberately NOT given a `.references()` call to mirror it (see
--     schema.ts:4273) -- this migration follows the same convention:
--     raw-SQL-only constraint, schema.ts stays as-is, so drizzle-kit's own
--     generate/push diffing never tries to manage these 322/46 columns.
--
-- Picked the 5 tables research confirmed are both highest-traffic AND
-- currently unenforced: compliance_items, documents, notifications,
-- audit_logs, tasks (org_id and/or user_id per table, whichever exists).
-- Deliberately NOT doing all 322/46 columns in one pass -- that's a much
-- larger, separate, lower-value undertaking (many are already low-traffic
-- or module-specific); this is the "starting with" slice the finding asks
-- for, not the whole backlog.
--
-- All four ADD CONSTRAINT statements use NOT VALID: this is the standard
-- safe pattern for adding a FK to a large, live, already-populated table --
-- it enforces the constraint for all NEW/UPDATED rows immediately (closing
-- the actual coupling gap) without taking the full-table ACCESS EXCLUSIVE
-- scan-and-lock that immediate validation requires, and without risking the
-- whole migration failing outright if a pre-existing orphan row exists
-- (which VALIDATE CONSTRAINT would report explicitly instead of aborting
-- an ALTER TABLE mid-flight). Deliberately NOT running VALIDATE CONSTRAINT
-- in this same migration -- validating the full existing dataset is a
-- separate, explicitly-flagged follow-up (see PROGRESS.md) so any orphan
-- rows this surfaces get investigated on their own, not discovered as a
-- failed migration.

ALTER TABLE compliance.compliance_items
  ADD CONSTRAINT compliance_items_org_id_fkey FOREIGN KEY (org_id) REFERENCES compliance.organisations(id) NOT VALID;

ALTER TABLE compliance.documents
  ADD CONSTRAINT documents_org_id_fkey FOREIGN KEY (org_id) REFERENCES compliance.organisations(id) NOT VALID;

ALTER TABLE compliance.notifications
  ADD CONSTRAINT notifications_user_id_fkey FOREIGN KEY (user_id) REFERENCES compliance.users(id) NOT VALID;
CREATE INDEX IF NOT EXISTS idx_notifications_user_id ON compliance.notifications(user_id);

ALTER TABLE compliance.audit_logs
  ADD CONSTRAINT audit_logs_org_id_fkey FOREIGN KEY (org_id) REFERENCES compliance.organisations(id) NOT VALID;
ALTER TABLE compliance.audit_logs
  ADD CONSTRAINT audit_logs_user_id_fkey FOREIGN KEY (user_id) REFERENCES compliance.users(id) NOT VALID;
CREATE INDEX IF NOT EXISTS idx_audit_logs_user_id ON compliance.audit_logs(user_id);

ALTER TABLE compliance.tasks
  ADD CONSTRAINT tasks_org_id_fkey FOREIGN KEY (org_id) REFERENCES compliance.organisations(id) NOT VALID;
ALTER TABLE compliance.tasks
  ADD CONSTRAINT tasks_user_id_fkey FOREIGN KEY (user_id) REFERENCES compliance.users(id) NOT VALID;
CREATE INDEX IF NOT EXISTS idx_tasks_org_id ON compliance.tasks(org_id);
CREATE INDEX IF NOT EXISTS idx_tasks_user_id ON compliance.tasks(user_id);
