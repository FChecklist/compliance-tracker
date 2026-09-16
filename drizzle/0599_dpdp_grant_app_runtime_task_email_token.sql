-- Real, confirmed-live bug found while proving WO-DPDP-005/007's vertical
-- slice end to end (Owner directive: "build one thing, end to end, before
-- more schema"). dpdp.task and dpdp.email_token were created with RLS
-- policies (correctly assuming app_runtime as the caller) but NO base
-- GRANT to app_runtime at all -- every query from the real app against
-- these two tables failed with "permission denied for table X" (Postgres
-- error 42501), regardless of RLS, since a GRANT is checked before RLS is
-- ever evaluated. Reproduced directly: answerTaskViaEmailToken() threw
-- this exact error against the live database before this fix.
-- Same GRANT shape every other correctly-configured dpdp table already
-- has (see dpdp.obligation as the reference). Applied live via Supabase
-- MCP first (name: grant_app_runtime_task_email_token), then recorded
-- here per this repo's own migration-file convention.
GRANT SELECT, INSERT, UPDATE, DELETE ON dpdp.task TO app_runtime;
GRANT SELECT, INSERT, UPDATE, DELETE ON dpdp.email_token TO app_runtime;
