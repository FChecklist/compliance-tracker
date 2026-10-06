-- PRE-APPROVED-LIVE-DDL: Owner delegated full PM authority and ordered the PROJEXA no-Vercel upload route built, in chat on 2026-10-06 (project manager order "file-upload route for PROJEXA that works WITHOUT Vercel"); adds the public Storage bucket projexa-files, the projexa_upload_sign_log table and the SECURITY DEFINER rate-limit function.
-- PROJEXA FILE UPLOADS WITHOUT VERCEL (projexa-api POST /uploads/sign, supabase/functions/projexa-api/upload-sign.ts).
--
-- WHAT
--   storage.buckets 'projexa-files': PUBLIC (owner decision: low-security product, the stored record link must work forever), 50 MB per file
--     (Supabase Free per-file limit), allowed_mime_types = the contract allow-list. Object paths are <orgId>/<kind>/<random uuid>/<file name>: unguessable.
--   NO policy on storage.objects is created for this bucket: anon and authenticated therefore cannot list, insert, update or delete in it through the
--     Storage API (a public bucket serves GET of a known object URL without any policy). Only the service role (the Edge Function) creates signed upload URLs.
--   public.projexa_upload_sign_log + public.projexa_upload_sign_reserve(p_org, p_limit): atomically counts the org's sign requests of the last hour and
--     records a new one when under the limit (the 200 files/hour sanity limit). service_role only.
-- DATA LOSS: none; purely additive; applying twice changes nothing.
-- ROLLBACK: drizzle/down/0732_projexa_files_bucket_and_sign_log.down.sql
BEGIN;
SET LOCAL lock_timeout = '5s';

INSERT INTO storage.buckets (id, name, public, file_size_limit, allowed_mime_types)
VALUES ('projexa-files', 'projexa-files', true, 52428800, ARRAY[
  'application/pdf','image/png','image/jpeg','image/webp','image/gif','image/heic',
  'application/vnd.openxmlformats-officedocument.wordprocessingml.document',
  'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet',
  'application/vnd.openxmlformats-officedocument.presentationml.presentation',
  'text/csv','text/plain','image/vnd.dwg','application/acad','image/vnd.dxf','application/dxf','application/zip','application/x-zip-compressed','application/x-dwg'
])
ON CONFLICT (id) DO UPDATE SET public = true, file_size_limit = EXCLUDED.file_size_limit, allowed_mime_types = EXCLUDED.allowed_mime_types;

CREATE TABLE IF NOT EXISTS public.projexa_upload_sign_log (
  id bigserial PRIMARY KEY,
  org_id text NOT NULL,
  signed_at timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX IF NOT EXISTS projexa_upload_sign_log_org_time_idx ON public.projexa_upload_sign_log (org_id, signed_at DESC);
ALTER TABLE public.projexa_upload_sign_log ENABLE ROW LEVEL SECURITY;
REVOKE ALL ON public.projexa_upload_sign_log FROM PUBLIC, anon, authenticated;

CREATE OR REPLACE FUNCTION public.projexa_upload_sign_reserve(p_org text, p_limit integer)
RETURNS boolean
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = pg_catalog, pg_temp
AS $fn$
DECLARE n integer;
BEGIN
  IF p_org IS NULL OR p_org = '' OR p_limit IS NULL OR p_limit < 1 THEN RETURN false; END IF;
  PERFORM pg_advisory_xact_lock(hashtext('projexa_upload_sign:' || p_org));
  SELECT count(*) INTO n FROM public.projexa_upload_sign_log WHERE org_id = p_org AND signed_at > now() - interval '1 hour';
  IF n >= p_limit THEN RETURN false; END IF;
  INSERT INTO public.projexa_upload_sign_log (org_id) VALUES (p_org);
  DELETE FROM public.projexa_upload_sign_log WHERE signed_at < now() - interval '1 day';
  RETURN true;
END
$fn$;
REVOKE ALL ON FUNCTION public.projexa_upload_sign_reserve(text, integer) FROM PUBLIC, anon, authenticated, app_runtime;
GRANT EXECUTE ON FUNCTION public.projexa_upload_sign_reserve(text, integer) TO service_role;
COMMIT;
