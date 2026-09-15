-- WO-DPDP-001 Phase 1 follow-up: Supabase's security advisor flagged the 3
-- plpgsql trigger functions added in 0415 (auto_fiduciary_capability,
-- membership_no_sign_at_join, relationship_no_self_declare) for a mutable
-- search_path -- dpdp.current_org_id() already set one, these three didn't.
-- Pinning search_path on a SECURITY DEFINER/trigger function is standard
-- practice against search_path injection (a caller-controlled search_path
-- could shadow an unqualified identifier with an attacker's own object).
ALTER FUNCTION dpdp.auto_fiduciary_capability() SET search_path = 'dpdp', 'pg_temp';
ALTER FUNCTION dpdp.membership_no_sign_at_join() SET search_path = 'dpdp', 'pg_temp';
ALTER FUNCTION dpdp.relationship_no_self_declare() SET search_path = 'dpdp', 'pg_temp';
