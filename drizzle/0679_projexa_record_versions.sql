-- PRE-APPROVED-LIVE-DDL: Owner (Rajat Agarwal) directive of 2026-10-02 in a live Claude Code session: "complete this 100%" and, in the same session, "each file in user to have proper number, version and recorded in backend, supabase so that when updating history is maintained; the versions will help in sync". This migration records a VERSION and a HISTORY for every record of the 13 synced kinds, which sync then uses for conflict detection and for propagating changes and deletes.
-- PROJEXA RECORD VERSIONS AND CHANGE LOG (feat/lf-sync-backend).
--
-- WHAT
--   platform.projexa_record_head   one row per tracked record: its current `version` (integer, +1 on every REAL change; absent = 0 = never changed since tracking began),
--                                   the SHA-256 of its content, whether it is deleted, the project and organisation it belongs to, and who last changed it.
--   platform.projexa_change_log    append-only history: one row per version (seq, org, project, kind, record, version, op I/U/D, hash, actor, session role, time). A delete is a TOMBSTONE row.
--   platform.projexa_track_change() the AFTER row trigger function on the 13 tables of the synced kinds. SECURITY DEFINER (so it writes the two tables whatever role
--                                   the business write ran as), search_path pinned. It NEVER blocks a business write: any error inside it is turned into a WARNING and the write goes on.
--   13 triggers `projexa_track_change` on compliance.projects / pms_issues / construction_boqs / construction_boq_line_items / construction_activities /
--                                   construction_work_progress_entries / construction_rfis / construction_submittals / construction_punch_list_items /
--                                   construction_change_orders / pms_milestones / construction_materials / documents (documents: only rows linked to a project).
--   public.projexa_sync_changes(...)   what a laptop asks to learn what changed in a project since a sequence number (and the tombstones).
--   public.projexa_sync_pull_ids(...)  exact rows by id (a row of a table without updated_at changes without moving the keyset cursor; the change log names it, this fetches it).
--   public.projexa_sync_pull(...)      REPLACED (additive): the same answer as 0677 plus `version` on every item.
--
-- A REAL CHANGE. The hash is over the row as jsonb minus `updated_at` (and the generated `search_vector` / `embedding`), so a touch that only moves updated_at is not a new version, and
-- an UPDATE that writes the same values is not either. The first change to a row that was never tracked makes version 1 (the baseline is 0: no backfill of existing data is needed).
--
-- NOTHING IS REIMPLEMENTED AS AUTHORITY. Who may ask for a project's changes is 0677's rule (projexa_read_resolve_user + ai_work_link__bind: same organisation, readable by the person NOW,
-- else the one AW404). A row's scope is projexa_sync__src's (organisation AND project). The two new tables are readable by nothing except the functions here.
--
-- KNOWN LIMIT (documented, not hidden). seq is an identity: two transactions can take seq 10 and 11 and commit in the other order, so a reader that has seen 11 may not yet see 10. Laptops
-- therefore re-ask from `after_seq - 200` (idempotent: a change is applied only when its version is higher than the local one), and the daily /ids reconcile and the updated_at keyset pull
-- repair anything a long transaction straddled.
--
-- COST. One small indexed upsert plus one append per CHANGED row, inside the same transaction as the business write (a 10,000-line BOQ import adds 10,000 of each).
-- LOCKS. CREATE TRIGGER takes a SHARE ROW EXCLUSIVE lock on each table for an instant; lock_timeout is 5 s and the whole migration is one transaction (all or nothing).
-- GRANTS: SECURITY DEFINER functions, search_path = pg_catalog, pg_temp, timezone UTC; revoked from public, anon, authenticated, app_runtime; the new sync functions are granted to service_role alone.
-- The two tables are revoked from every role including service_role.
-- DATA LOSS: none. No existing table is altered. Applying it twice changes nothing (triggers are dropped and re-created, tables IF NOT EXISTS).
-- ROLLBACK: drizzle/down/0679_projexa_record_versions.down.sql (drops the triggers FIRST, then the function and tables, and restores the 0678-era pull exactly)

BEGIN;

SET LOCAL lock_timeout = '5s';

-- 1. tables ------------------------------------------------------------------------------------------------------------------------------------
CREATE TABLE IF NOT EXISTS platform.projexa_record_head (
  org_id text NOT NULL,
  kind text NOT NULL,
  record_id text NOT NULL,
  project_id text NOT NULL,
  version bigint NOT NULL,
  content_hash text NOT NULL,
  deleted boolean NOT NULL DEFAULT false,
  updated_at timestamptz NOT NULL DEFAULT clock_timestamp(),
  actor_id text,
  PRIMARY KEY (org_id, kind, record_id),
  CONSTRAINT projexa_record_head_version_check CHECK (version >= 1)
);
CREATE INDEX IF NOT EXISTS projexa_record_head_project_idx ON platform.projexa_record_head (org_id, project_id, kind);

CREATE TABLE IF NOT EXISTS platform.projexa_change_log (
  seq bigint GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
  org_id text NOT NULL,
  project_id text NOT NULL,
  kind text NOT NULL,
  record_id text NOT NULL,
  version bigint NOT NULL,
  op char(1) NOT NULL,
  content_hash text,
  actor_id text,
  db_role text,
  at timestamptz NOT NULL DEFAULT clock_timestamp(),
  CONSTRAINT projexa_change_log_op_check CHECK (op IN ('I', 'U', 'D'))
);
CREATE INDEX IF NOT EXISTS projexa_change_log_project_seq_idx ON platform.projexa_change_log (org_id, project_id, seq);
CREATE INDEX IF NOT EXISTS projexa_change_log_record_idx ON platform.projexa_change_log (org_id, kind, record_id, version);

ALTER TABLE platform.projexa_record_head ENABLE ROW LEVEL SECURITY;
ALTER TABLE platform.projexa_record_head FORCE ROW LEVEL SECURITY;
REVOKE ALL ON TABLE platform.projexa_record_head FROM PUBLIC, anon, authenticated, app_runtime, service_role;
ALTER TABLE platform.projexa_change_log ENABLE ROW LEVEL SECURITY;
ALTER TABLE platform.projexa_change_log FORCE ROW LEVEL SECURITY;
REVOKE ALL ON TABLE platform.projexa_change_log FROM PUBLIC, anon, authenticated, app_runtime, service_role;

-- 2. the trigger function ----------------------------------------------------------------------------------------------------------------------
CREATE OR REPLACE FUNCTION platform.projexa_track_change()
RETURNS trigger
LANGUAGE plpgsql SECURITY DEFINER
SET search_path = pg_catalog, pg_temp
SET timezone = 'UTC'
AS $fn$
DECLARE
  v_kind text := TG_ARGV[0];
  v_row jsonb;
  v_op char(1);
  v_id text;
  v_org text;
  v_project text;
  v_hash text;
  v_prev record;
  v_ver bigint;
  v_actor text;
BEGIN
  BEGIN
    IF TG_OP = 'DELETE' THEN
      v_row := to_jsonb(OLD);
      v_op := 'D';
    ELSE
      v_row := to_jsonb(NEW);
      v_op := CASE TG_OP WHEN 'INSERT' THEN 'I' ELSE 'U' END;
    END IF;
    v_id := v_row ->> 'id';
    v_org := v_row ->> 'org_id';

    IF v_kind = 'project' THEN
      v_project := v_id;
    ELSIF v_kind = 'boq_lines' THEN
      SELECT b.project_id INTO v_project FROM compliance.construction_boqs b WHERE b.id = (v_row ->> 'boq_id') AND b.org_id = v_org;
    ELSIF v_kind = 'documents' THEN
      IF v_row ->> 'linked_entity_type' IS DISTINCT FROM 'project' THEN
        RETURN NULL;
      END IF;
      v_project := v_row ->> 'linked_entity_id';
    ELSE
      v_project := v_row ->> 'project_id';
    END IF;

    SELECT h.version, h.content_hash, h.deleted, h.project_id INTO v_prev
    FROM platform.projexa_record_head h WHERE h.org_id = v_org AND h.kind = v_kind AND h.record_id = v_id FOR UPDATE;

    -- a boq line removed together with its BOQ (cascade): the parent is already gone, so the project is the one we recorded before
    IF v_project IS NULL AND FOUND THEN
      v_project := v_prev.project_id;
    END IF;
    IF v_org IS NULL OR v_id IS NULL OR v_project IS NULL THEN
      RETURN NULL;
    END IF;

    v_hash := encode(sha256(convert_to((v_row - 'updated_at' - 'search_vector' - 'embedding')::text, 'UTF8')), 'hex');
    IF FOUND THEN
      IF v_op <> 'D' AND NOT v_prev.deleted AND v_prev.content_hash = v_hash THEN
        RETURN NULL; -- not a real change
      END IF;
      v_ver := v_prev.version + 1;
    ELSE
      v_ver := 1;
    END IF;

    v_actor := coalesce(v_row ->> 'updated_by_id', v_row ->> 'updated_by', v_row ->> 'created_by_id', v_row ->> 'requested_by_id', v_row ->> 'raised_by_id');

    INSERT INTO platform.projexa_record_head (org_id, kind, record_id, project_id, version, content_hash, deleted, updated_at, actor_id)
    VALUES (v_org, v_kind, v_id, v_project, v_ver, v_hash, v_op = 'D', clock_timestamp(), v_actor)
    ON CONFLICT (org_id, kind, record_id)
    DO UPDATE SET project_id = EXCLUDED.project_id, version = EXCLUDED.version, content_hash = EXCLUDED.content_hash, deleted = EXCLUDED.deleted, updated_at = EXCLUDED.updated_at, actor_id = EXCLUDED.actor_id;

    INSERT INTO platform.projexa_change_log (org_id, project_id, kind, record_id, version, op, content_hash, actor_id, db_role)
    VALUES (v_org, v_project, v_kind, v_id, v_ver, v_op, v_hash, v_actor, session_user::text);
  EXCEPTION WHEN OTHERS THEN
    -- tracking is best effort by design: it must never be the reason a business write fails
    RAISE WARNING 'projexa_track_change(%): % (%)', v_kind, SQLERRM, SQLSTATE;
  END;
  RETURN NULL;
END
$fn$;
REVOKE ALL ON FUNCTION platform.projexa_track_change() FROM PUBLIC, anon, authenticated, app_runtime;

-- 3. the 13 triggers (a table missing in an environment is skipped, not an error) ---------------------------------------------------------------
DO $$
DECLARE
  r record;
BEGIN
  FOR r IN SELECT * FROM (VALUES
    ('project', 'projects'), ('tasks', 'pms_issues'), ('boqs', 'construction_boqs'), ('boq_lines', 'construction_boq_line_items'),
    ('activities', 'construction_activities'), ('progress', 'construction_work_progress_entries'), ('rfis', 'construction_rfis'),
    ('submittals', 'construction_submittals'), ('punch_list', 'construction_punch_list_items'), ('change_orders', 'construction_change_orders'),
    ('milestones', 'pms_milestones'), ('materials', 'construction_materials'), ('documents', 'documents')
  ) AS v(kind, tbl)
  LOOP
    IF to_regclass('compliance.' || r.tbl) IS NOT NULL THEN
      EXECUTE format('DROP TRIGGER IF EXISTS projexa_track_change ON compliance.%I', r.tbl);
      EXECUTE format('CREATE TRIGGER projexa_track_change AFTER INSERT OR UPDATE OR DELETE ON compliance.%I FOR EACH ROW EXECUTE FUNCTION platform.projexa_track_change(%L)', r.tbl, r.kind);
    END IF;
  END LOOP;
END $$;

-- 4. rows with versions: one builder for pull and pull_ids ----------------------------------------------------------------------------------------
-- p_cands is [{id, ts}] in the order to answer; every row is the AI work link's own row for that id under the bound context, with its version
CREATE OR REPLACE FUNCTION public.projexa_sync__items(p_bound jsonb, p_org text, p_kind text, p_cands jsonb)
RETURNS jsonb
LANGUAGE plpgsql STABLE
SET search_path = pg_catalog, pg_temp
AS $fn$
DECLARE
  v_items jsonb := '[]'::jsonb;
  v_c jsonb;
  v_row jsonb;
BEGIN
  FOR v_c IN SELECT e FROM jsonb_array_elements(p_cands) AS e LOOP
    v_row := (public.ai_work_link__records_core(p_bound, p_kind, NULL, 1, '{}'::jsonb, v_c ->> 'id')) -> 'items' -> 0;
    IF v_row IS NOT NULL THEN
      v_items := v_items || jsonb_build_array(jsonb_build_object(
        'id', v_c ->> 'id', 'updated_at', v_c ->> 'ts',
        'version', coalesce((SELECT h.version FROM platform.projexa_record_head h WHERE h.org_id = p_org AND h.kind = p_kind AND h.record_id = v_c ->> 'id'), 0),
        'data', v_row));
    END IF;
  END LOOP;
  RETURN v_items;
END
$fn$;

-- 5. pull, replaced: 0677's answer plus version on every item -----------------------------------------------------------------------------------
CREATE OR REPLACE FUNCTION public.projexa_sync_pull(
  p_sub text, p_email text, p_project_id text, p_kind text, p_after_ts text, p_after_id text, p_limit integer DEFAULT 200)
RETURNS jsonb
LANGUAGE plpgsql STABLE SECURITY DEFINER
SET search_path = pg_catalog, pg_temp
SET timezone = 'UTC'
AS $fn$
DECLARE
  v_user text;
  v_org text;
  v_reason text;
  v_ctx jsonb;
  v_bound jsonb;
  v_src record;
  v_ts text;
  v_limit integer;
  v_cands jsonb;
  v_n integer;
  v_after_ts timestamptz;
  v_where text := '';
  v_hidden text[];
  v_has_more boolean := false;
  v_last jsonb;
BEGIN
  IF p_limit IS NULL OR p_limit < 1 OR p_limit > 500 THEN
    RAISE EXCEPTION 'BAD_LIMIT' USING ERRCODE = 'AW400';
  END IF;
  v_limit := p_limit;

  SELECT r.user_id, r.org_id, r.reason INTO v_user, v_org, v_reason FROM public.projexa_read_resolve_user(p_sub, p_email) r;
  IF v_org IS NULL THEN
    RETURN jsonb_build_object('status', coalesce(v_reason, 'not_linked'));
  END IF;
  v_ctx := public.projexa_sync__ctx(v_user, v_org);
  IF v_ctx IS NULL THEN
    RETURN jsonb_build_object('status', 'not_linked');
  END IF;

  v_bound := public.ai_work_link__bind(v_ctx, p_project_id);
  IF v_bound IS NULL THEN
    RAISE EXCEPTION 'NOT_FOUND' USING ERRCODE = 'AW404';
  END IF;
  SELECT s.from_sql, s.scope_sql, s.rel INTO v_src FROM public.projexa_sync__src(p_kind) s;
  IF NOT FOUND THEN
    RAISE EXCEPTION 'NOT_FOUND' USING ERRCODE = 'AW404';
  END IF;

  v_ts := format('(coalesce(t.%1$I, t.created_at))::timestamptz', public.projexa_sync__cursor_field(v_src.rel));

  IF p_after_ts IS NOT NULL OR p_after_id IS NOT NULL THEN
    IF p_after_ts IS NULL OR p_after_id IS NULL OR p_after_ts !~ '^[0-9]{4}-[0-9]{2}-[0-9]{2}T[0-9]{2}:[0-9]{2}:[0-9]{2}(\.[0-9]{1,6})?Z$'
       OR p_after_id !~ '^[A-Za-z0-9._:-]{1,64}$' THEN
      RAISE EXCEPTION 'BAD_CURSOR' USING ERRCODE = 'AW400';
    END IF;
    v_after_ts := p_after_ts::timestamptz;
    v_where := format(' AND (%s, t.id) > ($3, $4)', v_ts);
  END IF;

  EXECUTE format(
    'SELECT coalesce(jsonb_agg(jsonb_build_object(''id'', c.id, ''ts'', to_char(c.ts AT TIME ZONE ''UTC'', ''YYYY-MM-DD"T"HH24:MI:SS.US"Z"'')) ORDER BY c.ts, c.id), ''[]''::jsonb) '
    || 'FROM (SELECT t.id AS id, %1$s AS ts FROM %2$s WHERE %3$s%4$s ORDER BY %1$s, t.id LIMIT %5$s) c',
    v_ts, v_src.from_sql, v_src.scope_sql, v_where, v_limit + 1)
    INTO v_cands USING p_project_id, v_org, v_after_ts, p_after_id;

  v_n := jsonb_array_length(v_cands);
  IF v_n > v_limit THEN
    v_has_more := true;
    v_cands := v_cands - v_limit;
  END IF;

  v_hidden := public.ai_work_link__hidden_cols(p_kind, v_org, v_ctx ->> 'live_role');

  v_n := jsonb_array_length(v_cands);
  v_last := CASE WHEN v_n > 0 THEN v_cands -> (v_n - 1) END;
  RETURN jsonb_build_object(
    'status', 'ok',
    'items', public.projexa_sync__items(v_bound, v_org, p_kind, v_cands),
    'has_more', v_has_more,
    'next_ts', v_last ->> 'ts',
    'next_id', v_last ->> 'id',
    'hidden_fields', to_jsonb(v_hidden),
    'money_visible', (v_ctx ->> 'live_rank')::integer >= 3,
    'redacted', coalesce(cardinality(v_hidden), 0) > 0);
END
$fn$;

-- 6. exact rows by id ------------------------------------------------------------------------------------------------------------------------
CREATE OR REPLACE FUNCTION public.projexa_sync_pull_ids(p_sub text, p_email text, p_project_id text, p_kind text, p_ids text[])
RETURNS jsonb
LANGUAGE plpgsql STABLE SECURITY DEFINER
SET search_path = pg_catalog, pg_temp
SET timezone = 'UTC'
AS $fn$
DECLARE
  v_user text;
  v_org text;
  v_reason text;
  v_ctx jsonb;
  v_bound jsonb;
  v_src record;
  v_ts text;
  v_cands jsonb;
  v_hidden text[];
BEGIN
  IF p_ids IS NULL OR cardinality(p_ids) < 1 OR cardinality(p_ids) > 200 THEN
    RAISE EXCEPTION 'BAD_LIMIT' USING ERRCODE = 'AW400';
  END IF;
  IF EXISTS (SELECT 1 FROM unnest(p_ids) AS x WHERE x IS NULL OR x !~ '^[A-Za-z0-9._:-]{1,64}$') THEN
    RAISE EXCEPTION 'BAD_CURSOR' USING ERRCODE = 'AW400';
  END IF;

  SELECT r.user_id, r.org_id, r.reason INTO v_user, v_org, v_reason FROM public.projexa_read_resolve_user(p_sub, p_email) r;
  IF v_org IS NULL THEN
    RETURN jsonb_build_object('status', coalesce(v_reason, 'not_linked'));
  END IF;
  v_ctx := public.projexa_sync__ctx(v_user, v_org);
  IF v_ctx IS NULL THEN
    RETURN jsonb_build_object('status', 'not_linked');
  END IF;

  v_bound := public.ai_work_link__bind(v_ctx, p_project_id);
  IF v_bound IS NULL THEN
    RAISE EXCEPTION 'NOT_FOUND' USING ERRCODE = 'AW404';
  END IF;
  SELECT s.from_sql, s.scope_sql, s.rel INTO v_src FROM public.projexa_sync__src(p_kind) s;
  IF NOT FOUND THEN
    RAISE EXCEPTION 'NOT_FOUND' USING ERRCODE = 'AW404';
  END IF;

  v_ts := format('(coalesce(t.%1$I, t.created_at))::timestamptz', public.projexa_sync__cursor_field(v_src.rel));
  EXECUTE format(
    'SELECT coalesce(jsonb_agg(jsonb_build_object(''id'', c.id, ''ts'', to_char(c.ts AT TIME ZONE ''UTC'', ''YYYY-MM-DD"T"HH24:MI:SS.US"Z"'')) ORDER BY c.id), ''[]''::jsonb) '
    || 'FROM (SELECT t.id AS id, %1$s AS ts FROM %2$s WHERE %3$s AND t.id::text = ANY($3) ORDER BY t.id) c',
    v_ts, v_src.from_sql, v_src.scope_sql)
    INTO v_cands USING p_project_id, v_org, p_ids;

  v_hidden := public.ai_work_link__hidden_cols(p_kind, v_org, v_ctx ->> 'live_role');
  RETURN jsonb_build_object(
    'status', 'ok',
    'items', public.projexa_sync__items(v_bound, v_org, p_kind, v_cands),
    'has_more', false,
    'next_ts', NULL,
    'next_id', NULL,
    'hidden_fields', to_jsonb(v_hidden),
    'money_visible', (v_ctx ->> 'live_rank')::integer >= 3,
    'redacted', coalesce(cardinality(v_hidden), 0) > 0);
END
$fn$;

-- 7. what changed in a project since a sequence number (and the tombstones) ------------------------------------------------------------------------
CREATE OR REPLACE FUNCTION public.projexa_sync_changes(p_sub text, p_email text, p_project_id text, p_after_seq bigint, p_limit integer DEFAULT 1000)
RETURNS jsonb
LANGUAGE plpgsql STABLE SECURITY DEFINER
SET search_path = pg_catalog, pg_temp
SET timezone = 'UTC'
AS $fn$
DECLARE
  v_user text;
  v_org text;
  v_reason text;
  v_ctx jsonb;
  v_bound jsonb;
  v_head bigint;
  v_rows jsonb;
  v_n integer;
  v_has_more boolean := false;
  v_next bigint;
BEGIN
  IF p_limit IS NULL OR p_limit < 1 OR p_limit > 1000 THEN
    RAISE EXCEPTION 'BAD_LIMIT' USING ERRCODE = 'AW400';
  END IF;
  IF p_after_seq IS NOT NULL AND p_after_seq < 0 THEN
    RAISE EXCEPTION 'BAD_CURSOR' USING ERRCODE = 'AW400';
  END IF;

  SELECT r.user_id, r.org_id, r.reason INTO v_user, v_org, v_reason FROM public.projexa_read_resolve_user(p_sub, p_email) r;
  IF v_org IS NULL THEN
    RETURN jsonb_build_object('status', coalesce(v_reason, 'not_linked'));
  END IF;
  v_ctx := public.projexa_sync__ctx(v_user, v_org);
  IF v_ctx IS NULL THEN
    RETURN jsonb_build_object('status', 'not_linked');
  END IF;
  v_bound := public.ai_work_link__bind(v_ctx, p_project_id);
  IF v_bound IS NULL THEN
    RAISE EXCEPTION 'NOT_FOUND' USING ERRCODE = 'AW404';
  END IF;

  SELECT coalesce(max(c.seq), 0) INTO v_head FROM platform.projexa_change_log c WHERE c.org_id = v_org AND c.project_id = p_project_id;
  IF p_after_seq IS NULL THEN
    RETURN jsonb_build_object('status', 'ok', 'changes', '[]'::jsonb, 'next_seq', v_head, 'has_more', false, 'head_seq', v_head);
  END IF;

  SELECT coalesce(jsonb_agg(jsonb_build_object('seq', x.seq, 'kind', x.kind, 'id', x.record_id, 'version', x.version, 'op', x.op::text) ORDER BY x.seq), '[]'::jsonb)
    INTO v_rows
  FROM (SELECT c.seq, c.kind, c.record_id, c.version, c.op FROM platform.projexa_change_log c
        WHERE c.org_id = v_org AND c.project_id = p_project_id AND c.seq > p_after_seq
          AND c.kind = ANY (public.projexa_sync__kinds())
        ORDER BY c.seq LIMIT p_limit + 1) x;

  v_n := jsonb_array_length(v_rows);
  IF v_n > p_limit THEN
    v_has_more := true;
    v_rows := v_rows - p_limit;
    v_n := p_limit;
  END IF;
  v_next := CASE WHEN v_n > 0 THEN (v_rows -> (v_n - 1) ->> 'seq')::bigint ELSE p_after_seq END;
  RETURN jsonb_build_object('status', 'ok', 'changes', v_rows, 'next_seq', v_next, 'has_more', v_has_more, 'head_seq', v_head);
END
$fn$;

-- 8. grants ----------------------------------------------------------------------------------------------------------------------------------
REVOKE ALL ON FUNCTION public.projexa_sync__items(jsonb, text, text, jsonb) FROM PUBLIC, anon, authenticated, service_role;
REVOKE ALL ON FUNCTION public.projexa_sync_pull(text, text, text, text, text, text, integer) FROM PUBLIC, anon, authenticated;
REVOKE ALL ON FUNCTION public.projexa_sync_pull_ids(text, text, text, text, text[]) FROM PUBLIC, anon, authenticated;
REVOKE ALL ON FUNCTION public.projexa_sync_changes(text, text, text, bigint, integer) FROM PUBLIC, anon, authenticated;
DO $$ BEGIN
  IF EXISTS (SELECT 1 FROM pg_roles WHERE rolname = 'app_runtime') THEN
    EXECUTE 'REVOKE ALL ON FUNCTION public.projexa_sync__items(jsonb, text, text, jsonb) FROM app_runtime';
    EXECUTE 'REVOKE ALL ON FUNCTION public.projexa_sync_pull(text, text, text, text, text, text, integer) FROM app_runtime';
    EXECUTE 'REVOKE ALL ON FUNCTION public.projexa_sync_pull_ids(text, text, text, text, text[]) FROM app_runtime';
    EXECUTE 'REVOKE ALL ON FUNCTION public.projexa_sync_changes(text, text, text, bigint, integer) FROM app_runtime';
  END IF;
END $$;
GRANT EXECUTE ON FUNCTION public.projexa_sync_pull(text, text, text, text, text, text, integer) TO service_role;
GRANT EXECUTE ON FUNCTION public.projexa_sync_pull_ids(text, text, text, text, text[]) TO service_role;
GRANT EXECUTE ON FUNCTION public.projexa_sync_changes(text, text, text, bigint, integer) TO service_role;

COMMIT;
