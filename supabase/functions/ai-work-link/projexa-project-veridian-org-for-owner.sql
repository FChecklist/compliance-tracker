-- Applied to the PROJEXA Supabase project (evpckeuxgvahguwsaeul), NOT to verdian-ai, on 2026-10-02 via the Supabase MCP (migration veridian_org_for_owner).
-- Read-only and additive. See first-user.ts for why: it is the trusted source of "which VERIDIAN organisation belongs to this signed-in owner".
-- Returns ids only (never veridian_api_key). Rollback: DROP FUNCTION public.veridian_org_for_owner();
CREATE OR REPLACE FUNCTION public.veridian_org_for_owner()
RETURNS TABLE(veridian_org_id text)
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path = pg_catalog, pg_temp
AS $$
  SELECT vc.veridian_org_id::text
    FROM public.memberships m
    JOIN public.veridian_credentials vc ON vc.organization_id = m.organization_id
   WHERE m.user_id = auth.uid() AND m.role::text = 'owner' AND vc.veridian_org_id IS NOT NULL
$$;
REVOKE ALL ON FUNCTION public.veridian_org_for_owner() FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.veridian_org_for_owner() TO authenticated;
