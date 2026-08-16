-- Gap closure, AUDIT_2026-07-09.md (Overall Architecture Review section).
-- Applied live via Supabase MCP apply_migration on 2026-07-09.
--
-- construction's status='planned' was stale -- 15 real tables, 10 real
-- services, ~55 real API routes exist (PROJEXA), actively built through the
-- 120s-130s wave range. Corrected to 'building', matching
-- facilities_management's already-accurate 'building' status (verified: FM
-- is in the same state -- real backend, no internal (app)/ management UI
-- yet either, only a public marketing page -- so 'building', not 'live', is
-- the honest status for both; 'live' would overclaim end-user readiness).
UPDATE compliance.product_branches
SET status = 'building'
WHERE branch_key = 'construction';
