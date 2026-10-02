-- PRE-APPROVED-LIVE-DDL: Owner (Rajat Agarwal) directive of 2026-10-02 in a live Claude Code session: "the download that happens in user laptop should have a version number, download date etc; it should be one file or something like docker so that its properly matched with the backend; also each file in user to have proper number, version and recorded in backend, supabase so that when updating history is maintained; the versions will help in sync". This migration is the backend registry of that: releases, files and installs.
-- PROJEXA RELEASE REGISTRY (feat/lf-sync-backend).
--
-- WHAT
--   platform.projexa_release         one row per published app release: release_version (YYYY.MM.DD-NNN), manifest_sha256 (the "image digest": sha256 of the canonical manifest), git_sha,
--                                     built_at, the sync protocol and laptop-database schema it speaks, the single bundle file (path, size, sha256), file count and total bytes.
--   platform.projexa_file            the PERMANENT NUMBER of every file path ever shipped (file_no, never reused, assigned on first sight).
--   platform.projexa_release_file    which file bytes (sha256, size) a release holds, with that path's file_version: 1 on first sight, +1 each time the bytes change between releases,
--                                     the same number again when a later release ships identical bytes. This is the update history of every file.
--   platform.projexa_release_policy  one row: min_compatible, the oldest release still allowed to sync (a laptop below it is told to update first).
--   platform.projexa_client_install  one row per laptop install event: who, which device, which release, from which previous release, when it was downloaded and installed, how many
--                                     files and bytes, whether it worked. The history of every update of every laptop.
--   public.projexa_release_register(manifest)         registers a release (idempotent on manifest_sha256; the same version with different content is refused AW409).
--   public.projexa_release_current()                  the newest release with its file table, and min_compatible.
--   public.projexa_release_set_min_compatible(text)   how the owner raises the floor (service_role / SQL only).
--   public.projexa_install_record(...)                records one install event for the PERSON who is signed in (resolved by projexa_read_resolve_user), capped at 50 a day.
--
-- WHY THE REGISTRY, NOT THE BUILD, ASSIGNS NUMBERS. The build cannot know what was shipped last time. The registry sees every release in order, so it can say "this path's bytes changed:
-- version 4" and keep the number of a path forever. Registration takes a manifest the OWNER published at https://projexa-ai.com/_release/release.json (the Edge function fetches it itself;
-- nothing a caller sends is trusted), so a caller cannot register a release the owner did not publish.
--
-- ERRORS (coded, same family as 0677): AW400 BAD_MANIFEST / BAD_INSTALL; AW409 VERSION_TAKEN; AW429 INSTALL_CAP_DAY. A person who does not resolve gets {"status": <reason>} and nothing is written.
-- GRANTS: SECURITY DEFINER, search_path = pg_catalog, pg_temp, timezone UTC; revoked from public, anon, authenticated, app_runtime; granted to service_role alone. The tables are revoked from every role including service_role.
-- DATA LOSS: none. New tables and functions only; applying it twice changes nothing.
-- ROLLBACK: drizzle/down/0680_projexa_release_registry.down.sql

BEGIN;

SET LOCAL lock_timeout = '5s';

-- 1. tables ------------------------------------------------------------------------------------------------------------------------------------
CREATE TABLE IF NOT EXISTS platform.projexa_release (
  release_version text PRIMARY KEY,
  manifest_sha256 text NOT NULL UNIQUE,
  git_sha text,
  built_at timestamptz NOT NULL,
  registered_at timestamptz NOT NULL DEFAULT clock_timestamp(),
  protocol integer NOT NULL,
  schema_version integer NOT NULL,
  bundle_path text NOT NULL,
  bundle_size bigint NOT NULL,
  bundle_sha256 text NOT NULL,
  files_count integer NOT NULL DEFAULT 0,
  bytes_total bigint NOT NULL DEFAULT 0,
  CONSTRAINT projexa_release_version_check CHECK (release_version ~ '^[0-9]{4}\.[0-9]{2}\.[0-9]{2}-[0-9]{3}$'),
  CONSTRAINT projexa_release_sha_check CHECK (manifest_sha256 ~ '^[0-9a-f]{64}$' AND bundle_sha256 ~ '^[0-9a-f]{64}$')
);
CREATE INDEX IF NOT EXISTS projexa_release_built_idx ON platform.projexa_release (built_at DESC, release_version DESC);

CREATE TABLE IF NOT EXISTS platform.projexa_file (
  path text PRIMARY KEY,
  file_no integer GENERATED ALWAYS AS IDENTITY UNIQUE,
  first_release text,
  created_at timestamptz NOT NULL DEFAULT clock_timestamp(),
  CONSTRAINT projexa_file_path_check CHECK (char_length(path) BETWEEN 1 AND 400 AND path !~ '[[:cntrl:]]' AND path !~ '(^|/)\.\.(/|$)')
);

CREATE TABLE IF NOT EXISTS platform.projexa_release_file (
  release_version text NOT NULL REFERENCES platform.projexa_release (release_version),
  path text NOT NULL REFERENCES platform.projexa_file (path),
  file_no integer NOT NULL,
  file_version integer NOT NULL,
  sha256 text NOT NULL,
  size bigint NOT NULL,
  PRIMARY KEY (release_version, path),
  CONSTRAINT projexa_release_file_sha_check CHECK (sha256 ~ '^[0-9a-f]{64}$'),
  CONSTRAINT projexa_release_file_version_check CHECK (file_version >= 1 AND size >= 0)
);
CREATE INDEX IF NOT EXISTS projexa_release_file_path_idx ON platform.projexa_release_file (path, file_version);

CREATE TABLE IF NOT EXISTS platform.projexa_release_policy (
  id boolean PRIMARY KEY DEFAULT true CHECK (id),
  min_compatible text NOT NULL DEFAULT '',
  updated_at timestamptz NOT NULL DEFAULT clock_timestamp()
);
INSERT INTO platform.projexa_release_policy (id) VALUES (true) ON CONFLICT DO NOTHING;

CREATE TABLE IF NOT EXISTS platform.projexa_client_install (
  id bigint GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
  user_id text NOT NULL,
  org_id text NOT NULL,
  device_id text NOT NULL,
  release_version text NOT NULL,
  previous_release text,
  manifest_sha256 text,
  downloaded_at timestamptz NOT NULL,
  installed_at timestamptz,
  files_count integer,
  bytes bigint,
  status text NOT NULL,
  error text,
  recorded_at timestamptz NOT NULL DEFAULT clock_timestamp(),
  CONSTRAINT projexa_client_install_status_check CHECK (status IN ('installed', 'updated', 'failed')),
  CONSTRAINT projexa_client_install_device_check CHECK (device_id ~ '^[A-Za-z0-9_-]{8,64}$'),
  CONSTRAINT projexa_client_install_error_len CHECK (error IS NULL OR char_length(error) <= 300)
);
CREATE INDEX IF NOT EXISTS projexa_client_install_user_idx ON platform.projexa_client_install (user_id, recorded_at DESC);
CREATE INDEX IF NOT EXISTS projexa_client_install_device_idx ON platform.projexa_client_install (device_id, recorded_at DESC);

DO $$
DECLARE
  t text;
BEGIN
  FOREACH t IN ARRAY ARRAY['projexa_release', 'projexa_file', 'projexa_release_file', 'projexa_release_policy', 'projexa_client_install'] LOOP
    EXECUTE format('ALTER TABLE platform.%I ENABLE ROW LEVEL SECURITY', t);
    EXECUTE format('ALTER TABLE platform.%I FORCE ROW LEVEL SECURITY', t);
    EXECUTE format('REVOKE ALL ON TABLE platform.%I FROM PUBLIC, anon, authenticated, app_runtime, service_role', t);
  END LOOP;
END $$;

-- 2. register ----------------------------------------------------------------------------------------------------------------------------------
CREATE OR REPLACE FUNCTION public.projexa_release_register(p_manifest jsonb)
RETURNS jsonb
LANGUAGE plpgsql SECURITY DEFINER
SET search_path = pg_catalog, pg_temp
SET timezone = 'UTC'
AS $fn$
DECLARE
  v_ver text := p_manifest ->> 'release_version';
  v_sha text := p_manifest ->> 'manifest_sha256';
  v_files jsonb := p_manifest -> 'files';
  v_bundle jsonb := p_manifest -> 'bundle';
  v_built timestamptz;
  v_existing text;
  f jsonb;
  v_path text;
  v_fsha text;
  v_size bigint;
  v_prev record;
  v_fv integer;
  v_no integer;
  v_added integer := 0;
  v_changed integer := 0;
  v_same integer := 0;
  v_bytes bigint := 0;
BEGIN
  IF jsonb_typeof(p_manifest) IS DISTINCT FROM 'object'
     OR v_ver IS NULL OR v_ver !~ '^[0-9]{4}\.[0-9]{2}\.[0-9]{2}-[0-9]{3}$'
     OR v_sha IS NULL OR v_sha !~ '^[0-9a-f]{64}$'
     OR jsonb_typeof(v_files) IS DISTINCT FROM 'array' OR jsonb_array_length(v_files) < 1 OR jsonb_array_length(v_files) > 5000
     OR jsonb_typeof(v_bundle) IS DISTINCT FROM 'object' OR coalesce(v_bundle ->> 'path', '') = '' OR coalesce(v_bundle ->> 'sha256', '') !~ '^[0-9a-f]{64}$'
     OR coalesce(v_bundle ->> 'size', '') !~ '^[0-9]{1,12}$'
     OR coalesce(p_manifest ->> 'protocol', '') !~ '^[0-9]{1,4}$' OR coalesce(p_manifest ->> 'schema', '') !~ '^[0-9]{1,4}$'
     OR coalesce(p_manifest ->> 'built_at', '') !~ '^[0-9]{4}-[0-9]{2}-[0-9]{2}T' THEN
    RAISE EXCEPTION 'BAD_MANIFEST' USING ERRCODE = 'AW400';
  END IF;
  v_built := (p_manifest ->> 'built_at')::timestamptz;

  PERFORM pg_advisory_xact_lock(hashtext('projexa_release_register'));

  SELECT r.release_version INTO v_existing FROM platform.projexa_release r WHERE r.manifest_sha256 = v_sha;
  IF FOUND THEN
    RETURN jsonb_build_object('registered', false, 'release_version', v_existing, 'reason', 'already_registered');
  END IF;
  IF EXISTS (SELECT 1 FROM platform.projexa_release r WHERE r.release_version = v_ver) THEN
    -- the same version name with different content is never overwritten
    RAISE EXCEPTION 'VERSION_TAKEN' USING ERRCODE = 'AW409';
  END IF;

  INSERT INTO platform.projexa_release (release_version, manifest_sha256, git_sha, built_at, protocol, schema_version, bundle_path, bundle_size, bundle_sha256)
  VALUES (v_ver, v_sha, nullif(left(coalesce(p_manifest ->> 'git_sha', ''), 64), ''), v_built, (p_manifest ->> 'protocol')::integer, (p_manifest ->> 'schema')::integer,
          v_bundle ->> 'path', (v_bundle ->> 'size')::bigint, v_bundle ->> 'sha256');

  FOR f IN SELECT e FROM jsonb_array_elements(v_files) AS e LOOP
    v_path := f ->> 'path';
    v_fsha := f ->> 'sha256';
    IF v_path IS NULL OR char_length(v_path) NOT BETWEEN 1 AND 400 OR v_path ~ '[[:cntrl:]]' OR v_path ~ '(^|/)\.\.(/|$)'
       OR v_fsha IS NULL OR v_fsha !~ '^[0-9a-f]{64}$' OR coalesce(f ->> 'size', '') !~ '^[0-9]{1,12}$' THEN
      RAISE EXCEPTION 'BAD_MANIFEST' USING ERRCODE = 'AW400';
    END IF;
    v_size := (f ->> 'size')::bigint;
    v_bytes := v_bytes + v_size;

    -- look the number up FIRST: an INSERT ... ON CONFLICT DO NOTHING would still burn an identity value and leave holes in the permanent numbers (the advisory lock makes this race-free)
    SELECT pf.file_no INTO v_no FROM platform.projexa_file pf WHERE pf.path = v_path;
    IF NOT FOUND THEN
      INSERT INTO platform.projexa_file (path, first_release) VALUES (v_path, v_ver) RETURNING file_no INTO v_no;
    END IF;

    SELECT rf.sha256, rf.file_version INTO v_prev
    FROM platform.projexa_release_file rf JOIN platform.projexa_release r ON r.release_version = rf.release_version
    WHERE rf.path = v_path
    ORDER BY r.built_at DESC, r.release_version DESC LIMIT 1;
    IF NOT FOUND THEN
      v_fv := 1;
      v_added := v_added + 1;
    ELSIF v_prev.sha256 = v_fsha THEN
      v_fv := v_prev.file_version;
      v_same := v_same + 1;
    ELSE
      v_fv := v_prev.file_version + 1;
      v_changed := v_changed + 1;
    END IF;

    INSERT INTO platform.projexa_release_file (release_version, path, file_no, file_version, sha256, size) VALUES (v_ver, v_path, v_no, v_fv, v_fsha, v_size)
    ON CONFLICT (release_version, path) DO NOTHING;
  END LOOP;

  UPDATE platform.projexa_release SET files_count = jsonb_array_length(v_files), bytes_total = v_bytes WHERE release_version = v_ver;
  RETURN jsonb_build_object('registered', true, 'release_version', v_ver, 'files_added', v_added, 'files_changed', v_changed, 'files_unchanged', v_same, 'files', jsonb_array_length(v_files), 'bytes', v_bytes);
END
$fn$;

-- 3. current -----------------------------------------------------------------------------------------------------------------------------------
CREATE OR REPLACE FUNCTION public.projexa_release_current()
RETURNS jsonb
LANGUAGE plpgsql STABLE SECURITY DEFINER
SET search_path = pg_catalog, pg_temp
SET timezone = 'UTC'
AS $fn$
DECLARE
  v_r record;
  v_min text;
BEGIN
  SELECT p.min_compatible INTO v_min FROM platform.projexa_release_policy p WHERE p.id;
  SELECT * INTO v_r FROM platform.projexa_release r ORDER BY r.built_at DESC, r.release_version DESC LIMIT 1;
  IF NOT FOUND THEN
    RETURN jsonb_build_object('registered', false, 'current', NULL, 'min_compatible', coalesce(v_min, ''));
  END IF;
  RETURN jsonb_build_object(
    'registered', true,
    'min_compatible', coalesce(v_min, ''),
    'current', jsonb_build_object(
      'release_version', v_r.release_version, 'manifest_sha256', v_r.manifest_sha256, 'git_sha', v_r.git_sha, 'built_at', to_char(v_r.built_at AT TIME ZONE 'UTC', 'YYYY-MM-DD"T"HH24:MI:SS"Z"'),
      'protocol', v_r.protocol, 'schema', v_r.schema_version,
      'bundle', jsonb_build_object('path', v_r.bundle_path, 'size', v_r.bundle_size, 'sha256', v_r.bundle_sha256),
      'files_count', v_r.files_count, 'bytes_total', v_r.bytes_total,
      'files', coalesce((SELECT jsonb_agg(jsonb_build_object('path', rf.path, 'file_no', rf.file_no, 'file_version', rf.file_version, 'sha256', rf.sha256, 'size', rf.size) ORDER BY rf.file_no)
                         FROM platform.projexa_release_file rf WHERE rf.release_version = v_r.release_version), '[]'::jsonb)));
END
$fn$;

CREATE OR REPLACE FUNCTION public.projexa_release_set_min_compatible(p_release text)
RETURNS jsonb
LANGUAGE plpgsql SECURITY DEFINER
SET search_path = pg_catalog, pg_temp
AS $fn$
BEGIN
  IF p_release IS NULL OR (p_release <> '' AND p_release !~ '^[0-9]{4}\.[0-9]{2}\.[0-9]{2}-[0-9]{3}$') THEN
    RAISE EXCEPTION 'BAD_MANIFEST' USING ERRCODE = 'AW400';
  END IF;
  UPDATE platform.projexa_release_policy SET min_compatible = p_release, updated_at = clock_timestamp() WHERE id;
  RETURN jsonb_build_object('min_compatible', p_release);
END
$fn$;

-- 4. install history ---------------------------------------------------------------------------------------------------------------------------
CREATE OR REPLACE FUNCTION public.projexa_install_record(
  p_sub text, p_email text, p_device_id text, p_release_version text, p_manifest_sha256 text, p_previous_release text,
  p_downloaded_at timestamptz, p_installed_at timestamptz, p_files integer, p_bytes bigint, p_status text, p_error text DEFAULT NULL)
RETURNS jsonb
LANGUAGE plpgsql SECURITY DEFINER
SET search_path = pg_catalog, pg_temp
SET timezone = 'UTC'
AS $fn$
DECLARE
  v_user text;
  v_org text;
  v_reason text;
  v_reg text;
  v_id bigint;
BEGIN
  IF p_device_id IS NULL OR p_device_id !~ '^[A-Za-z0-9_-]{8,64}$'
     OR p_release_version IS NULL OR p_release_version !~ '^[0-9]{4}\.[0-9]{2}\.[0-9]{2}-[0-9]{3}$'
     OR p_status IS NULL OR p_status NOT IN ('installed', 'updated', 'failed')
     OR p_downloaded_at IS NULL OR (p_manifest_sha256 IS NOT NULL AND p_manifest_sha256 !~ '^[0-9a-f]{64}$')
     OR (p_previous_release IS NOT NULL AND p_previous_release !~ '^[0-9]{4}\.[0-9]{2}\.[0-9]{2}-[0-9]{3}$')
     OR (p_files IS NOT NULL AND (p_files < 0 OR p_files > 100000)) OR (p_bytes IS NOT NULL AND p_bytes < 0)
     OR (p_error IS NOT NULL AND char_length(p_error) > 300) THEN
    RAISE EXCEPTION 'BAD_INSTALL' USING ERRCODE = 'AW400';
  END IF;

  SELECT r.user_id, r.org_id, r.reason INTO v_user, v_org, v_reason FROM public.projexa_read_resolve_user(p_sub, p_email) r;
  IF v_org IS NULL THEN
    RETURN jsonb_build_object('status', coalesce(v_reason, 'not_linked'));
  END IF;

  -- a success must name a registered release whose digest matches what the laptop says it installed
  IF p_status <> 'failed' THEN
    SELECT r.release_version INTO v_reg FROM platform.projexa_release r WHERE r.release_version = p_release_version AND (p_manifest_sha256 IS NULL OR r.manifest_sha256 = p_manifest_sha256);
    IF NOT FOUND THEN
      RAISE EXCEPTION 'BAD_INSTALL' USING ERRCODE = 'AW400';
    END IF;
  END IF;

  IF (SELECT count(*) FROM platform.projexa_client_install i WHERE i.user_id = v_user AND i.recorded_at > clock_timestamp() - interval '1 day') >= 50 THEN
    RAISE EXCEPTION 'INSTALL_CAP_DAY' USING ERRCODE = 'AW429';
  END IF;

  INSERT INTO platform.projexa_client_install (user_id, org_id, device_id, release_version, previous_release, manifest_sha256, downloaded_at, installed_at, files_count, bytes, status, error)
  VALUES (v_user, v_org, p_device_id, p_release_version, p_previous_release, p_manifest_sha256, p_downloaded_at, p_installed_at, p_files, p_bytes, p_status, p_error)
  RETURNING id INTO v_id;
  RETURN jsonb_build_object('status', 'ok', 'recorded', v_id);
END
$fn$;

-- 5. grants ------------------------------------------------------------------------------------------------------------------------------------
REVOKE ALL ON FUNCTION public.projexa_release_register(jsonb) FROM PUBLIC, anon, authenticated;
REVOKE ALL ON FUNCTION public.projexa_release_current() FROM PUBLIC, anon, authenticated;
REVOKE ALL ON FUNCTION public.projexa_release_set_min_compatible(text) FROM PUBLIC, anon, authenticated;
REVOKE ALL ON FUNCTION public.projexa_install_record(text, text, text, text, text, text, timestamptz, timestamptz, integer, bigint, text, text) FROM PUBLIC, anon, authenticated;
DO $$ BEGIN
  IF EXISTS (SELECT 1 FROM pg_roles WHERE rolname = 'app_runtime') THEN
    EXECUTE 'REVOKE ALL ON FUNCTION public.projexa_release_register(jsonb) FROM app_runtime';
    EXECUTE 'REVOKE ALL ON FUNCTION public.projexa_release_current() FROM app_runtime';
    EXECUTE 'REVOKE ALL ON FUNCTION public.projexa_release_set_min_compatible(text) FROM app_runtime';
    EXECUTE 'REVOKE ALL ON FUNCTION public.projexa_install_record(text, text, text, text, text, text, timestamptz, timestamptz, integer, bigint, text, text) FROM app_runtime';
  END IF;
END $$;
GRANT EXECUTE ON FUNCTION public.projexa_release_register(jsonb) TO service_role;
GRANT EXECUTE ON FUNCTION public.projexa_release_current() TO service_role;
GRANT EXECUTE ON FUNCTION public.projexa_release_set_min_compatible(text) TO service_role;
GRANT EXECUTE ON FUNCTION public.projexa_install_record(text, text, text, text, text, text, timestamptz, timestamptz, integer, bigint, text, text) TO service_role;

COMMIT;
