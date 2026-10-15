-- PRE-APPROVED-LIVE-DDL: Owner instruction in chat on 2026-10-11 ("integration of user / user organization AI is very very important for PROJEXA"; "do on local, than deploy on supabase"); this rollback drops only the two tables 0746 created, and is run only if 0746 must be undone.
-- Rollback of 0746: drops the shares first (they reference the connections). Loses every person's own AI connection and share; the organisation's connection is untouched.
BEGIN;
DROP TABLE IF EXISTS compliance.user_ai_connection_shares;
DROP TABLE IF EXISTS compliance.user_ai_connections;
COMMIT;
