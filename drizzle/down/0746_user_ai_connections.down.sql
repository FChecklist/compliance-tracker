-- Rollback of 0746: drops the shares first (they reference the connections). Loses every person's own AI connection and share; the organisation's connection is untouched.
BEGIN;
DROP TABLE IF EXISTS compliance.user_ai_connection_shares;
DROP TABLE IF EXISTS compliance.user_ai_connections;
COMMIT;
