-- R81 -- close the last two platform tables without RLS.
--
-- WHAT WAS FOUND. A sweep of the platform schema found exactly two tables with
-- RLS disabled and zero policies, while the other 89 all carry RLS plus a single
-- service_role_bypass_<table> policy:
--
--   platform.session_audit_r60_r67   -- 156 rows
--   platform.r74_agent_register      -- 0 rows
--
-- Both hold app_runtime grants, and RLS-with-no-app_runtime-policy is what
-- reduces those grants to zero rows. So both were readable and silently
-- REWRITABLE by the running application.
--
-- session_audit_r60_r67 is the one that matters. Its columns are claim_id,
-- claim_text, source_ref, evidence_class, evidence_ref, merged, deployed,
-- live_proven, verdict, notes, checked_at -- it is a record of claims and
-- whether they were verified. That is the same argument as R81_F39: an audit
-- trail that the audited process can edit is not an audit trail, and this one
-- specifically records whether earlier claims turned out to be true. A process
-- able to rewrite the verdict on its own past claims is the exact failure this
-- programme keeps finding in other forms.
--
-- r74_agent_register is empty today, which makes it cheap to fix and easy to
-- forget. Fixing it now is the point: it is the next table someone starts
-- writing to.
--
-- WHY THIS IS SAFE, established before the change rather than hoped for after.
-- Neither table has a single reader anywhere: searched ct/src/**/*.ts(x),
-- projexa/src/**/*.ts(x) and ct/scripts/** for r74_agent_register,
-- r74AgentRegister, session_audit_r60_r67 and sessionAuditR60 -- zero hits --
-- and neither is declared in src/lib/db/schema.ts. They are reached only by
-- maintenance work using the service_role credential, which the bypass policy
-- below covers. Enabling RLS removes access from exactly one role: the one that
-- should never have had it.
--
-- Idempotent: ENABLE ROW LEVEL SECURITY is a no-op when already on, and
-- CREATE POLICY has no IF NOT EXISTS in PostgreSQL, so the DROP ... IF EXISTS
-- first is what makes it re-runnable rather than an accident.
ALTER TABLE platform.session_audit_r60_r67 ENABLE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS service_role_bypass_session_audit_r60_r67 ON platform.session_audit_r60_r67;
CREATE POLICY service_role_bypass_session_audit_r60_r67 ON platform.session_audit_r60_r67
  FOR ALL TO service_role USING (true) WITH CHECK (true);

ALTER TABLE platform.r74_agent_register ENABLE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS service_role_bypass_r74_agent_register ON platform.r74_agent_register;
CREATE POLICY service_role_bypass_r74_agent_register ON platform.r74_agent_register
  FOR ALL TO service_role USING (true) WITH CHECK (true);
