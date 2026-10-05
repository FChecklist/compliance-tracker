-- PRE-APPROVED-LIVE-DDL: Owner delegated full PM authority and ordered the 100-point audit gaps closed (project manager order, "100% proper fix ... no asking"), in chat on 2026-10-06; adds the SECURITY DEFINER public.projexa_ensure_member_user and its role-mapping helper (AUDIT-100 B55 follow-up, audit100/link-invited-members).
-- EVERY PROJEXA MEMBER GETS THEIR OWN VERIDIAN USER (AUDIT-100, measured by the B55 agent in projexa #397).
--
-- THE GAP. Only an organisation's FIRST person is ever linked to a VERIDIAN user: POST /api/v1/platform/provision-org creates the organisation and its key
-- and no user, and the two first-user self-heals (src/lib/services/platform-first-user-service.ts, drizzle/0675) fire only for an organisation with ZERO users.
-- Everybody who joins later through an invitation (PROJEXA /api/org/invites/accept -> accept_org_invite) has no compliance.users row whose auth_user_id is their
-- PROJEXA session's sub, so public.projexa_read_resolve_user (drizzle/0618) answers not_linked: the AI work link mint is refused (403 USER_NOT_LINKED), the
-- in-app "Copy AI prompt" fails and the welcome e-mail is skipped. Measured live: of 10 members in pm / site_engineer / client_viewer roles only 3 were linked.
--
-- WHAT
--   public.projexa_member_veridian_role(p_projexa_role text) returns text
--     THE ROLE MAPPING, the one place it lives. A PROJEXA membership role becomes the VERIDIAN user_role that gives NO MORE power than it had in PROJEXA
--     (ranks are public.ai_work_link__role_rank, drizzle/0624: they decide the AI link level, writes and project creation):
--       owner, admin   -> admin          (rank 5)   the only roles that may become admin
--       pm             -> manager        (rank 3)
--       site_engineer  -> member         (rank 2)
--       member         -> member         (rank 2)
--       client_viewer  -> client_viewer  (rank 1)   read-only: a link of rank 1 is level 0 (read and draft), it can never write
--       anything else  -> NULL                      refused ('role_not_mapped'); never a guess
--   public.projexa_ensure_member_user(p_org_id, p_auth_user_id, p_email, p_name, p_projexa_role) returns table(outcome, user_id, role)
--     makes sure the PROJEXA person (p_auth_user_id = their verified session sub) has exactly one active VERIDIAN user in p_org_id. The CALLER establishes
--     p_org_id and p_projexa_role from a TRUSTED source (the projexa-api Edge Function reads the person's PROJEXA membership with their own token and the
--     organisation's veridian_credentials row server-side: supabase/functions/projexa-api/member-link.ts); nothing the browser sends decides either.
--     Outcomes (it never raises for a guard, so an error text cannot be used as an oracle):
--       created          a new user: the mapped role, auth_user_id = the sub, the org's General department, password_hash 'supabase-auth-managed'
--       linked_existing  an unlinked, active user of THIS org with this email already existed and its role is no more powerful than the mapped one:
--                        its auth_user_id is set (its role is NOT changed). A more powerful existing row is never linked ('email_taken')
--       already_linked   the person already resolves to an active user of this org: nothing is written and that user's role is NOT changed
--                        (neither upgraded nor downgraded; a role change in PROJEXA is an admin decision on the VERIDIAN side, not this function's)
--       deactivated      the person's user in this org is deactivated: never revived
--       linked_elsewhere the person is already linked to a user of ANOTHER organisation: never a second link (projexa_read_resolve_user would call it ambiguous)
--       email_taken      the email belongs to another org's user, an already-linked user, an inactive user or a more powerful user: nothing written
--       not_eligible     the organisation is missing, inactive or has no active API key (PROJEXA reaches an org only through its key)
--       role_not_mapped  the PROJEXA role is not one of the six above
--       bad_input        a missing org id or auth user id, or an email that is not an email
--     Idempotent: one per-person advisory lock makes the check and the write one decision; a second call answers already_linked and writes nothing.
--
-- GRANTS: SECURITY DEFINER, search_path = pg_catalog, pg_temp, revoked from public, anon, authenticated and app_runtime; granted to service_role alone (the
--   same pattern as public.projexa_ensure_first_user, drizzle/0675). The mapping helper is IMMUTABLE and granted the same way.
-- DATA LOSS: none. Two new functions; nothing existing is altered. Applying it twice changes nothing.
-- ROLLBACK: drizzle/down/0728_projexa_ensure_member_user.down.sql

BEGIN;

SET LOCAL lock_timeout = '5s';

CREATE OR REPLACE FUNCTION public.projexa_member_veridian_role(p_projexa_role text)
RETURNS text
LANGUAGE sql
IMMUTABLE
SET search_path = pg_catalog, pg_temp
AS $fn$
  SELECT CASE lower(btrim(coalesce(p_projexa_role, '')))
    WHEN 'owner' THEN 'admin'
    WHEN 'admin' THEN 'admin'
    WHEN 'pm' THEN 'manager'
    WHEN 'site_engineer' THEN 'member'
    WHEN 'member' THEN 'member'
    WHEN 'client_viewer' THEN 'client_viewer'
    ELSE NULL
  END
$fn$;

CREATE OR REPLACE FUNCTION public.projexa_ensure_member_user(p_org_id text, p_auth_user_id uuid, p_email text, p_name text, p_projexa_role text)
RETURNS TABLE(outcome text, user_id text, role text)
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = pg_catalog, pg_temp
AS $fn$
DECLARE
  v_email text := lower(btrim(coalesce(p_email, '')));
  v_name text := btrim(coalesce(p_name, ''));
  v_role text := public.projexa_member_veridian_role(p_projexa_role);
  v_dept text;
  v_id text;
  v_u record;
BEGIN
  IF p_org_id IS NULL OR btrim(p_org_id) = '' OR p_auth_user_id IS NULL OR v_email !~ '^[^[:space:]@]+@[^[:space:]@]+\.[^[:space:]@]+$' THEN
    RETURN QUERY SELECT 'bad_input'::text, NULL::text, NULL::text;
    RETURN;
  END IF;
  IF v_role IS NULL THEN
    RETURN QUERY SELECT 'role_not_mapped'::text, NULL::text, NULL::text;
    RETURN;
  END IF;
  IF v_name = '' THEN v_name := split_part(v_email, '@', 1); END IF;
  IF length(v_name) > 200 THEN v_name := left(v_name, 200); END IF;

  -- one decision per person at a time: two concurrent calls (the accept and the first mint, say) cannot both insert
  PERFORM pg_advisory_xact_lock(hashtext('projexa_member_user:' || p_auth_user_id::text));

  -- the organisation: live, and reachable by a key (PROJEXA reaches its VERIDIAN organisation only through veridian_credentials' key)
  IF NOT EXISTS (SELECT 1 FROM compliance.organisations o WHERE o.id = p_org_id AND o.is_active)
     OR NOT EXISTS (SELECT 1 FROM compliance.api_keys k WHERE k.org_id = p_org_id AND k.is_active) THEN
    RETURN QUERY SELECT 'not_eligible'::text, NULL::text, NULL::text;
    RETURN;
  END IF;

  -- the person is already linked: never a second row, never a role change, never a revival
  SELECT u.id, u.org_id, u.is_active, u.role::text AS role INTO v_u
    FROM compliance.users u
   WHERE u.auth_user_id = p_auth_user_id
   ORDER BY (u.org_id = p_org_id) DESC, u.is_active DESC, u.id
   LIMIT 1;
  IF FOUND THEN
    IF v_u.org_id = p_org_id AND v_u.is_active THEN
      RETURN QUERY SELECT 'already_linked'::text, v_u.id::text, v_u.role;
    ELSIF v_u.org_id = p_org_id THEN
      RETURN QUERY SELECT 'deactivated'::text, NULL::text, NULL::text;
    ELSE
      RETURN QUERY SELECT 'linked_elsewhere'::text, NULL::text, NULL::text;
    END IF;
    RETURN;
  END IF;

  -- the email already has a user (users.email is UNIQUE across the table)
  SELECT u.id, u.org_id, u.is_active, u.auth_user_id, u.role::text AS role INTO v_u
    FROM compliance.users u
   WHERE lower(u.email) = v_email
   LIMIT 1;
  IF FOUND THEN
    -- link it only when it is this organisation's, active, not linked to anyone, and NO MORE POWERFUL than the PROJEXA role allows
    IF v_u.org_id = p_org_id AND v_u.is_active AND v_u.auth_user_id IS NULL
       AND public.ai_work_link__role_rank(v_u.role) BETWEEN 1 AND public.ai_work_link__role_rank(v_role) THEN
      UPDATE compliance.users u SET auth_user_id = p_auth_user_id, updated_at = now() WHERE u.id = v_u.id AND u.auth_user_id IS NULL;
      RETURN QUERY SELECT 'linked_existing'::text, v_u.id::text, v_u.role;
    ELSE
      RETURN QUERY SELECT 'email_taken'::text, NULL::text, NULL::text;
    END IF;
    RETURN;
  END IF;

  SELECT d.id INTO v_dept FROM compliance.departments d WHERE d.org_id = p_org_id ORDER BY (d.name = 'General') DESC, d.created_at LIMIT 1;

  INSERT INTO compliance.users (name, email, password_hash, role, org_id, department_id, auth_user_id, onboarding_completed)
  VALUES (v_name, v_email, 'supabase-auth-managed', v_role::compliance.user_role, p_org_id, v_dept, p_auth_user_id, false)
  ON CONFLICT (email) DO NOTHING
  RETURNING id INTO v_id;

  IF v_id IS NULL THEN
    RETURN QUERY SELECT 'email_taken'::text, NULL::text, NULL::text;
  ELSE
    RETURN QUERY SELECT 'created'::text, v_id, v_role;
  END IF;
END
$fn$;

REVOKE ALL ON FUNCTION public.projexa_member_veridian_role(text) FROM PUBLIC, anon, authenticated;
REVOKE ALL ON FUNCTION public.projexa_ensure_member_user(text, uuid, text, text, text) FROM PUBLIC, anon, authenticated;
DO $$ BEGIN
  IF EXISTS (SELECT 1 FROM pg_roles WHERE rolname = 'app_runtime') THEN
    EXECUTE 'REVOKE ALL ON FUNCTION public.projexa_member_veridian_role(text) FROM app_runtime';
    EXECUTE 'REVOKE ALL ON FUNCTION public.projexa_ensure_member_user(text, uuid, text, text, text) FROM app_runtime';
  END IF;
END $$;
GRANT EXECUTE ON FUNCTION public.projexa_member_veridian_role(text) TO service_role;
GRANT EXECUTE ON FUNCTION public.projexa_ensure_member_user(text, uuid, text, text, text) TO service_role;

COMMIT;
