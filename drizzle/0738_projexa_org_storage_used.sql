-- PRE-APPROVED-LIVE-DDL: Owner delegated full PM authority and ordered the PROJEXA no-Vercel upload route and its Storage safety cap built, in chat on 2026-10-06 (project manager order "file-upload route for PROJEXA that works WITHOUT Vercel"; UPLOAD_CONTRACT_2026-10-06.md proposed the 100 MB per-organisation cap, PM package P9 of 2026-10-08 implements it); adds the read-only service_role-only SECURITY DEFINER function public.projexa_org_storage_used.
-- PROJEXA UPLOAD CAP (projexa-api POST /uploads/sign, supabase/functions/projexa-api/upload-sign.ts, UPLOAD_ORG_QUOTA_BYTES = 100 MB).
--
-- WHAT
--   public.projexa_org_storage_used(p_org text) -> bigint: the bytes now stored for the organisation in the public bucket projexa-files, i.e. the sum of
--   storage.objects metadata size for object names that start with '<orgId>/' (the folder the Edge function always builds from the person's membership).
--   No new table and no counter: the number is read from the Storage catalogue itself, so a deleted file frees its space at once.
--   The organisation id must be a uuid (the same shape the Edge function checks); anything else RAISES, the Edge function then answers a retryable 503,
--   so the cap is never silently skipped.
--   A file that was signed but not uploaded yet is not counted until it lands (the signed address lasts 2 hours): the cap is a safety net for a 1 GB
--   project, not an accounting ledger; the worst case is a few files over the line for a short while.
-- GRANTS: service_role only (the Edge function). Read only; additive; applying twice changes nothing.
-- DATA LOSS: none.
-- ROLLBACK: drizzle/down/0738_projexa_org_storage_used.down.sql
-- ORDER: apply this BEFORE deploying the projexa-api version that calls it (until then the new code would answer 503 on every sign request).
CREATE OR REPLACE FUNCTION public.projexa_org_storage_used(p_org text)
RETURNS bigint
LANGUAGE plpgsql STABLE SECURITY DEFINER
SET search_path = pg_catalog, pg_temp
AS $fn$
BEGIN
  IF p_org IS NULL OR p_org !~* '^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$' THEN
    RAISE EXCEPTION 'projexa_org_storage_used: organisation id must be a uuid';
  END IF;
  RETURN (SELECT coalesce(sum((o.metadata ->> 'size')::bigint), 0)::bigint
            FROM storage.objects o
           WHERE o.bucket_id = 'projexa-files' AND o.name LIKE p_org || '/%');
END
$fn$;

REVOKE ALL ON FUNCTION public.projexa_org_storage_used(text) FROM PUBLIC, anon, authenticated, app_runtime;
GRANT EXECUTE ON FUNCTION public.projexa_org_storage_used(text) TO service_role;
