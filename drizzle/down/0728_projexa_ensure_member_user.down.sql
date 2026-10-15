-- PRE-APPROVED-LIVE-DDL: rollback of the 2026-10-06 member-link functions (drizzle/0728_projexa_ensure_member_user.sql), same owner order as the forward file.
-- Down-migration for drizzle/0728. Run deliberately by the PM, not by any script. DATA LOSS: none (a user row it created or linked stays; only the functions go).
BEGIN;
DROP FUNCTION IF EXISTS public.projexa_ensure_member_user(text, uuid, text, text, text);
DROP FUNCTION IF EXISTS public.projexa_member_veridian_role(text);
COMMIT;
