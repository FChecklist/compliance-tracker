-- PRE-APPROVED-LIVE-DDL: Owner (Rajat Agarwal) asked in a live Claude Code session on 2026-10-01/02 that the fresh PROJEXA signup "SUMEET" (owner sumeetds@gmail.com) work end to end and that the fix must not need a Vercel deploy (the daily deploy limit is exhausted); this migration is the SQL half of that fix (the same self-heal as PR #2029 platform-first-user-service.ts, for the Supabase Edge Function path).
-- AI WORK LINK FIRST-USER SELF-HEAL (fix/awl-first-user-self-heal).
--
-- THE GAP. POST /api/v1/platform/provision-org (a PROJEXA signup) creates the VERIDIAN organisation, its platform-issued vk_ key and its
-- product-branch enablements, and NO compliance.users row for the person who signed up. The ai-work-link Edge Function then asks
-- public.projexa_read_resolve_user (drizzle/0618) who the PROJEXA session is; it matches compliance.users.auth_user_id to the session's `sub`,
-- finds nothing and the browser shows "not linked". PR #2029 closes this in the Next.js backend, but that path needs a Vercel deploy.
--
-- WHAT. ONE function, public.projexa_ensure_first_user(p_org_id, p_auth_user_id, p_email, p_name), that the Edge Function calls ONCE when the
-- lookup said not_linked and it has established the organisation from a TRUSTED source (the PROJEXA project's own membership table, see
-- supabase/functions/ai-work-link/first-user.ts; never from anything the caller sends). It creates the organisation's FIRST compliance.users row
-- (role admin, password_hash 'supabase-auth-managed', auth_user_id = the session sub, the org's General department, onboarding_completed false).
--
-- WHY IT IS NOT A PRIVILEGE ESCALATION (the guards, all inside the one function, under one per-org advisory lock so two calls cannot both pass):
--   1. the organisation must exist, be active, and hold an active key ISSUED FOR A PLATFORM APPLICATION (api_keys.issued_for_application_id is
--      not null): an organisation a customer made for themselves is never touched;
--   2. the organisation must have ZERO users (any row, active or not): it can never add a second person, raise anyone or revive anyone;
--   3. the email must be well formed, and users.email is UNIQUE: if that email already belongs to a user (of any organisation) nothing is
--      written and the answer is 'email_taken';
--   4. the auth user id must not already be linked to another user (the person already resolves; nothing to heal).
-- Idempotent: a repeat call finds the organisation has a user and writes nothing ('org_has_users', or 'already_linked' when that user is this person).
--
-- ANSWER. One row: outcome in ('created','already_linked','org_has_users','email_taken','not_eligible','bad_input') and user_id (set for created and
-- already_linked, else null). It never raises for a guard, so the caller cannot tell an oracle apart by an error text.
--
-- GRANTS: SECURITY DEFINER, search_path = pg_catalog, pg_temp, revoked from public, anon, authenticated and app_runtime; granted to service_role alone
-- (the same pattern as the other public.ai_work_link_* / ai_suggestion_* functions).
--
-- DATA LOSS: none. One new function; nothing existing is altered. Applying it twice changes nothing.
-- ROLLBACK: drizzle/down/0675_awl_first_user_self_heal.down.sql

BEGIN;

SET LOCAL lock_timeout = '5s';

CREATE OR REPLACE FUNCTION public.projexa_ensure_first_user(p_org_id text, p_auth_user_id uuid, p_email text, p_name text)
RETURNS TABLE(outcome text, user_id text)
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = pg_catalog, pg_temp
AS $fn$
DECLARE
  v_email text := lower(btrim(coalesce(p_email, '')));
  v_name text := btrim(coalesce(p_name, ''));
  v_dept text;
  v_id text;
BEGIN
  IF p_org_id IS NULL OR btrim(p_org_id) = '' OR p_auth_user_id IS NULL OR v_email !~ '^[^[:space:]@]+@[^[:space:]@]+\.[^[:space:]@]+$' THEN
    RETURN QUERY SELECT 'bad_input'::text, NULL::text;
    RETURN;
  END IF;
  IF v_name = '' THEN v_name := split_part(v_email, '@', 1); END IF;
  IF length(v_name) > 200 THEN v_name := left(v_name, 200); END IF;

  -- one caller at a time per organisation: the "zero users" check and the insert are one decision
  PERFORM pg_advisory_xact_lock(hashtext('projexa_first_user:' || p_org_id));

  -- guard 1: a live organisation that a platform application provisioned
  IF NOT EXISTS (SELECT 1 FROM compliance.organisations o WHERE o.id = p_org_id AND o.is_active)
     OR NOT EXISTS (SELECT 1 FROM compliance.api_keys k WHERE k.org_id = p_org_id AND k.is_active AND k.issued_for_application_id IS NOT NULL) THEN
    RETURN QUERY SELECT 'not_eligible'::text, NULL::text;
    RETURN;
  END IF;

  -- guard 2: zero users of any kind
  IF EXISTS (SELECT 1 FROM compliance.users u WHERE u.org_id = p_org_id) THEN
    SELECT u.id INTO v_id FROM compliance.users u WHERE u.org_id = p_org_id AND u.auth_user_id = p_auth_user_id AND u.is_active LIMIT 1;
    IF v_id IS NOT NULL THEN
      RETURN QUERY SELECT 'already_linked'::text, v_id;
    ELSE
      RETURN QUERY SELECT 'org_has_users'::text, NULL::text;
    END IF;
    RETURN;
  END IF;

  -- guard 4: this person is already linked somewhere: nothing to heal here
  IF EXISTS (SELECT 1 FROM compliance.users u WHERE u.auth_user_id = p_auth_user_id) THEN
    RETURN QUERY SELECT 'email_taken'::text, NULL::text;
    RETURN;
  END IF;

  -- guard 3: the email is unique across the table
  IF EXISTS (SELECT 1 FROM compliance.users u WHERE lower(u.email) = v_email) THEN
    RETURN QUERY SELECT 'email_taken'::text, NULL::text;
    RETURN;
  END IF;

  SELECT d.id INTO v_dept FROM compliance.departments d WHERE d.org_id = p_org_id ORDER BY (d.name = 'General') DESC, d.created_at LIMIT 1;

  INSERT INTO compliance.users (name, email, password_hash, role, org_id, department_id, auth_user_id, onboarding_completed)
  VALUES (v_name, v_email, 'supabase-auth-managed', 'admin', p_org_id, v_dept, p_auth_user_id, false)
  ON CONFLICT (email) DO NOTHING
  RETURNING id INTO v_id;

  IF v_id IS NULL THEN
    RETURN QUERY SELECT 'email_taken'::text, NULL::text;
  ELSE
    RETURN QUERY SELECT 'created'::text, v_id;
  END IF;
END
$fn$;

REVOKE ALL ON FUNCTION public.projexa_ensure_first_user(text, uuid, text, text) FROM PUBLIC, anon, authenticated;
DO $$ BEGIN
  IF EXISTS (SELECT 1 FROM pg_roles WHERE rolname = 'app_runtime') THEN
    EXECUTE 'REVOKE ALL ON FUNCTION public.projexa_ensure_first_user(text, uuid, text, text) FROM app_runtime';
  END IF;
END $$;
GRANT EXECUTE ON FUNCTION public.projexa_ensure_first_user(text, uuid, text, text) TO service_role;

COMMIT;
