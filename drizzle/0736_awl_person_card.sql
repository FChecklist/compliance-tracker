-- PRE-APPROVED-LIVE-DDL: Owner delegated full PM authority and ordered the 100-point audit gaps closed, in chat on 2026-10-05; adds the read-only service_role-only SECURITY DEFINER function public.ai_work_link_person_card (AUDIT-100 item 4) and its roll-back
-- AUDIT-100 item 4 (D2): the person's name and organisation, shown on the confirm screens so the person can see WHO the change is made as and in which
-- organisation (a phishing check). Read-only, service_role only (the ai-work-link Edge function calls it with the id it already resolved from the link or
-- the signed-in session); it returns nothing for an unknown or inactive user. Additive: no table or function is changed.
CREATE OR REPLACE FUNCTION public.ai_work_link_person_card(p_user_id text)
RETURNS jsonb
LANGUAGE sql STABLE SECURITY DEFINER
SET search_path = ''
AS $fn$
  SELECT jsonb_build_object('name', u.name, 'organisation', o.name)
    FROM compliance.users u
    LEFT JOIN compliance.organisations o ON o.id = u.org_id
   WHERE u.id = p_user_id AND u.is_active
   LIMIT 1
$fn$;

REVOKE ALL ON FUNCTION public.ai_work_link_person_card(text) FROM public, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.ai_work_link_person_card(text) TO service_role;
