-- PRE-APPROVED-LIVE-DDL: Owner (Rajat Agarwal) directive of 2026-10-02 in a live Claude Code session: "complete this 100%" and, in the same session, "each file in user to have proper number, version and recorded in backend, supabase so that when updating history is maintained; the versions will help in sync". This migration records a VERSION and a HISTORY for every record of the synced kinds, which sync then uses for conflict detection and for propagating changes and deletes. Hardened 2026-10-02 (cloud package lf-d3-versions-sql-fixes) after an independent review: commit-order-safe change cursor, statement-level tracking, moves and unlinks as tombstones, an epoch, a prune floor.
-- PROJEXA RECORD VERSIONS AND CHANGE LOG (feat/lf-sync-backend).
--
-- ORDER (read first). 0678 .. 0686 are ONE chain: apply them together, in number order (ideally in ONE transaction / one MCP call, in a quiet window: every commit
-- that touches schema public can trigger a PostgREST schema-cache reload). Roll back strictly in REVERSE order (0686, 0684, 0683, 0682, 0681, 0680, 0679, 0678).
-- Re-applying the whole chain in order changes nothing. The down file of this migration refuses to run while a later migration's triggers still exist.
--
-- WHAT
--   platform.projexa_record_head   one row per tracked record: its current `version` (integer, +1 on every REAL change; absent = 0 = never changed since tracking began),
--                                   the SHA-256 of its content, whether it is deleted (or left the project's stream), the project and organisation it belongs to, and who last changed it.
--   platform.projexa_change_log    append-only history: one row per version (seq, xid = the writing TRANSACTION, org, project, kind, record, version, op I/U/D, hash, actor, session role, time).
--                                   A delete is a TOMBSTONE row; so is a record that leaves a project (moved to another project, a document unlinked, a wiki page archived).
--   platform.projexa_sync_epoch    one row: a random id made when these tables are made. A rollback of this migration and a re-apply make a NEW epoch, so a laptop that sees a
--                                   different epoch knows every version and cursor it holds is meaningless and resyncs (versions restart at 1 after a rollback).
--   platform.projexa_change_floor  per (organisation, project): the newest transaction whose change rows were PRUNED (drizzle/0686). A laptop whose cursor is older is told
--                                   `reset_required` instead of silently missing tombstones.
--   platform.projexa_track_error   per kind: how many times tracking failed (counted at most once a minute) and the last error. Tracking never fails a business write, so this is
--                                   where a failure becomes visible (see platform.projexa_tracking_health() in 0686).
--   platform.projexa_track_change() the ONE tracking trigger function for every synced kind, project kinds (13 here, 15 in 0683) and organisation kinds (9 in 0684). It is attached as
--                                   THREE STATEMENT-LEVEL triggers per table (projexa_track_i / _u / _d, with transition tables): one function call, one subtransaction and two
--                                   set-based writes PER STATEMENT, whatever the number of rows (a 10,000-line BOQ import is 1 call, not 10,000). How a row finds its project is
--                                   given by the trigger's arguments (kind, mode, a, b, parent kind), so 0683 and 0684 only attach triggers and NEVER redefine this function.
--                                   SECURITY DEFINER (writes the tables whatever role the business write ran as), search_path pinned. It NEVER blocks a business write: any error
--                                   is a WARNING plus a count in projexa_track_error. Rows that do not concern a project (a DPDP document, a MoM about something else) make it
--                                   return after ONE tiny query on the statement's own rows, before any catalog lookup or hashing.
--   platform.projexa_track__attach(specs)  attaches the three triggers to each table of a list, idempotently: a table whose triggers are already exactly right is not touched (no
--                                   lock at all on a re-apply); the tables that need work are locked together with NOWAIT and a short retry, so the migration never queues
--                                   behind a long writer while holding other tables' locks (no hold-and-wait, no deadlock with application transactions).
--   public.projexa_sync__feed(...)   the change feed of one (organisation, project), shared by projexa_sync_changes (here) and projexa_sync_org_changes (0684).
--   public.projexa_sync_changes(...) what a laptop asks to learn what changed in a project since a cursor (and the tombstones).
--   public.projexa_sync_pull_ids(...) exact rows by id (a row of a table without updated_at changes without moving the keyset cursor; the change log names it, this fetches it).
--   public.projexa_sync_pull(...)    REPLACED (additive): the same answer as 0677 plus `version` on every item and `view_class` on every page.
--   public.projexa_sync_ids(...)     REPLACED (additive): 0678's answer plus `versions` (aligned with `ids`, 0 = untracked), `head_seq` and `epoch`.
--
-- THE CURSOR IS COMMIT-ORDER SAFE. seq (an identity) is taken when the trigger fires, not when the transaction commits, so a reader that only follows seq can pass a seq whose
-- transaction commits later and miss it for ever (22 of the 28 project kinds have no updated_at: the change log is the ONLY way an update reaches a laptop). Every log row
-- therefore carries the writing transaction's id (`xid`, xid8, pg_current_xact_id()), and the feed serves ONLY rows whose xid is below the reader's snapshot xmin (every such
-- transaction is finished, so no row can ever appear below that point later). The cursor a laptop holds (`after_seq` / `next_seq` / `head_seq` on the wire, a whole number)
-- is the xid of the last transaction it has fully received; a page always ends at a transaction boundary (one transaction larger than a page comes whole; one larger than
-- 20,000 rows answers `reset_required`). The price: a writing transaction that stays open anywhere on the database delays the feed (never loses anything) until it ends.
-- `reset_required: true` also answers a cursor older than the prune floor, and a cursor from the future (a database restored to an earlier point).
--
-- A REAL CHANGE. The hash is over the row as jsonb minus `updated_at` and the generated / vector columns (`search_vector`, `embedding`, any tsvector or vector column; they are not
-- even serialised), so a touch that only moves updated_at is not a new version, and an UPDATE that writes the same values is not either. For organisation kinds (0684) the hash
-- is over the ALLOW-LISTED columns only. For project kinds it is over the whole row ON PURPOSE (decision, sync:SYNC-14): what a laptop receives also contains values DERIVED
-- from columns it does not receive (records_core joins and computes), so hashing only the projected names could MISS a real visible change; a spurious version costs one
-- re-fetch, a missed one leaves stale data. The first change to a row that was never tracked makes version 1 (the baseline is 0: no backfill of existing data is needed).
--
-- HISTORY IS VERSION METADATA ONLY (decision, requirements:F14): the log keeps who changed which record to which version, when, and the content hash, NOT what the
-- record said at an older version. Keeping old row content (jsonb per version) would multiply the log's size against the 500 MB free database; server-side undo is
-- therefore not offered, and the losing side of a conflict lives in that laptop's outbox until the person resolves it.
-- THE CURSOR IS A GLOBAL NUMBER (decision, tenant-and-role:TI-5): head_seq / next_seq are transaction ids of the shared database, so the gaps between them reveal how
-- many write transactions happened elsewhere (a COUNT, never a record, an id or a project). Accepted under the owner's priority order (cost, then ease, then security):
-- hiding it would need a per-project sequence or an encrypted cursor for no protection of content.
--
-- NOTHING IS REIMPLEMENTED AS AUTHORITY. Who may ask for a project's changes is 0677's rule (projexa_read_resolve_user + ai_work_link__bind: same organisation, readable by the person NOW,
-- else the one AW404). A row's scope is projexa_sync__src's (organisation AND project). The new tables are readable by nothing except the functions here.
--
-- ERRORS (coded, same as 0677): AW404 NOT_FOUND; AW400 BAD_CURSOR / BAD_LIMIT. A person who does not resolve gets {"status": <reason>} and no data.
-- COST. Per tracked STATEMENT: one trigger call, one subtransaction, one catalog lookup, one set-based head upsert and one set-based log insert (only for rows that really
-- changed). The change log has 2 indexes (PK, (org, project, xid, seq)). Measured on PGlite (projexa-sync-tracking.pglite.test.ts, "cost"): a 2,000-row insert in one
-- statement consumes 2 transaction ids, its own and ONE subtransaction (the per-row trigger it replaces consumed 2,001: a subtransaction per row, which overflows the
-- 64-entry subxid cache after 64 rows and slows every other session's visibility checks on the shared database).
-- LOCKS. CREATE OR REPLACE TRIGGER takes SHARE ROW EXCLUSIVE (blocks writes, not reads) on each table and the lock is held until COMMIT (they accumulate over the list); see
-- projexa_track__attach: tables already right are skipped, the rest are locked NOWAIT together with a retry. lock_timeout is 5 s; the whole migration is one transaction.
-- GRANTS: SECURITY DEFINER functions, search_path = pg_catalog, pg_temp, timezone UTC; revoked from public, anon, authenticated, app_runtime; the sync entry points are granted to
-- service_role alone; the helpers and the trigger function to nobody. The tables are revoked from every role including service_role.
-- DATA LOSS: none. No existing table is altered. Applying it twice changes nothing (tables IF NOT EXISTS, functions replaced, triggers skipped when already right).
-- ROLLBACK: drizzle/down/0679_projexa_record_versions.down.sql (drops the triggers FIRST, then the functions and tables, and restores the 0677 pull and the 0678 ids exactly)

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
  xid xid8 NOT NULL DEFAULT pg_current_xact_id(),
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
CREATE INDEX IF NOT EXISTS projexa_change_log_project_xid_idx ON platform.projexa_change_log (org_id, project_id, xid, seq);

CREATE TABLE IF NOT EXISTS platform.projexa_sync_epoch (
  id boolean PRIMARY KEY DEFAULT true CHECK (id),
  epoch text NOT NULL DEFAULT replace(gen_random_uuid()::text, '-', ''),
  created_at timestamptz NOT NULL DEFAULT clock_timestamp()
);
INSERT INTO platform.projexa_sync_epoch (id) VALUES (true) ON CONFLICT DO NOTHING;

CREATE TABLE IF NOT EXISTS platform.projexa_change_floor (
  org_id text NOT NULL,
  project_id text NOT NULL,
  floor_xid xid8 NOT NULL,
  updated_at timestamptz NOT NULL DEFAULT clock_timestamp(),
  PRIMARY KEY (org_id, project_id)
);

CREATE TABLE IF NOT EXISTS platform.projexa_track_error (
  kind text PRIMARY KEY,
  errors bigint NOT NULL DEFAULT 0,
  last_sqlstate text,
  last_message text,
  last_at timestamptz NOT NULL DEFAULT clock_timestamp()
);

DO $$
DECLARE
  t text;
BEGIN
  FOREACH t IN ARRAY ARRAY['projexa_record_head', 'projexa_change_log', 'projexa_sync_epoch', 'projexa_change_floor', 'projexa_track_error'] LOOP
    EXECUTE format('ALTER TABLE platform.%I ENABLE ROW LEVEL SECURITY', t);
    EXECUTE format('ALTER TABLE platform.%I FORCE ROW LEVEL SECURITY', t);
    EXECUTE format('REVOKE ALL ON TABLE platform.%I FROM PUBLIC, anon, authenticated, service_role', t);
    IF EXISTS (SELECT 1 FROM pg_roles WHERE rolname = 'app_runtime') THEN
      EXECUTE format('REVOKE ALL ON TABLE platform.%I FROM app_runtime', t);
    END IF;
  END LOOP;
END $$;

-- 2. SQL builders the trigger uses (pure text; the column names come from the catalog or from the trigger's own arguments) -------------------------
-- how a row (alias p_alias) finds its project: self (the project itself), col (a column), parent (the parent row's project), link (a typed link),
-- col_unless (a column, unless a boolean says the row left the stream), org (the organisation sentinel '__org__')
CREATE OR REPLACE FUNCTION platform.projexa_track__project_sql(p_mode text, p_a text, p_b text, p_alias text)
RETURNS text
LANGUAGE sql IMMUTABLE
SET search_path = pg_catalog, pg_temp
AS $fn$
  SELECT CASE p_mode
    WHEN 'self' THEN format('%s.id::text', p_alias)
    WHEN 'col' THEN format('%s.%I::text', p_alias, coalesce(p_a, 'project_id'))
    WHEN 'parent' THEN format('(SELECT p.project_id::text FROM compliance.%I p WHERE p.id = %s.%I AND p.org_id = %s.org_id)', p_a, p_alias, p_b, p_alias)
    WHEN 'link' THEN format('CASE WHEN %1$s.%2$I = ''project'' THEN %1$s.%3$I::text END', p_alias, p_a, p_b)
    WHEN 'col_unless' THEN format('CASE WHEN %1$s.%3$I IS NOT TRUE THEN %1$s.%2$I::text END', p_alias, p_a, p_b)
    -- the project unless a (timestamp) column is set: a soft delete (`deleted_at`) LEAVES the project's stream, so it is one tombstone
    WHEN 'col_unset' THEN format('CASE WHEN %1$s.%3$I IS NULL THEN %1$s.%2$I::text END', p_alias, p_a, p_b)
    WHEN 'org' THEN '''__org__''::text'
  END
$fn$;

-- the row as jsonb for the content hash: the table's columns (or only p_cols) minus updated_at and generated / vector columns, built from the column list so a large
-- vector or tsvector is never serialised; chunks of 50 pairs because jsonb_build_object takes at most 100 arguments
CREATE OR REPLACE FUNCTION platform.projexa_track__json_sql(p_rel regclass, p_cols text[], p_alias text)
RETURNS text
LANGUAGE sql STABLE
SET search_path = pg_catalog, pg_temp
AS $fn$
  SELECT coalesce(string_agg(c.chunk, ' || ' ORDER BY c.g), '''{}''::jsonb')
  FROM (
    SELECT x.g, 'jsonb_build_object(' || string_agg(format('%L, %s.%I', x.attname, p_alias, x.attname), ', ' ORDER BY x.attnum) || ')' AS chunk
    FROM (SELECT a.attname::text AS attname, a.attnum, (row_number() OVER (ORDER BY a.attnum) - 1) / 50 AS g
          FROM pg_attribute a JOIN pg_type ty ON ty.oid = a.atttypid
          WHERE a.attrelid = p_rel AND a.attnum > 0 AND NOT a.attisdropped
            AND a.attname NOT IN ('updated_at', 'search_vector', 'embedding')
            AND ty.typname NOT IN ('tsvector', 'vector', 'halfvec', 'sparsevec')
            AND (p_cols IS NULL OR a.attname = ANY (p_cols))) x
    GROUP BY x.g) c
$fn$;

-- who changed it: the first of the usual actor columns the table has
CREATE OR REPLACE FUNCTION platform.projexa_track__actor_sql(p_rel regclass, p_alias text)
RETURNS text
LANGUAGE sql STABLE
SET search_path = pg_catalog, pg_temp
AS $fn$
  SELECT coalesce('coalesce(' || string_agg(format('%s.%I::text', p_alias, c.col), ', ' ORDER BY c.n) || ')', 'NULL::text')
  FROM unnest(ARRAY['updated_by_id', 'updated_by', 'created_by_id', 'requested_by_id', 'raised_by_id', 'recorded_by_id']) WITH ORDINALITY AS c(col, n)
  WHERE EXISTS (SELECT 1 FROM pg_attribute a WHERE a.attrelid = p_rel AND a.attname = c.col AND a.attnum > 0 AND NOT a.attisdropped)
$fn$;

-- the writer: `chg` (kind, org, rid, proj, hash, actor, eop, old_proj) holds only REAL changes, one per record.
-- One upsert of the heads (version + 1, or 1) and one append of the log; a record that moved also gets a tombstone under the project it left.
CREATE OR REPLACE FUNCTION platform.projexa_track__writer_sql(p_chg text)
RETURNS text
LANGUAGE sql IMMUTABLE
SET search_path = pg_catalog, pg_temp
AS $fn$
  SELECT format($q$
WITH %s,
up AS (
  INSERT INTO platform.projexa_record_head AS h (org_id, kind, record_id, project_id, version, content_hash, deleted, updated_at, actor_id)
  SELECT c.org, c.kind, c.rid, c.proj, 1, c.hash, c.eop = 'D', clock_timestamp(), c.actor FROM chg c
  ON CONFLICT (org_id, kind, record_id) DO UPDATE
    SET version = h.version + 1, project_id = EXCLUDED.project_id, content_hash = EXCLUDED.content_hash, deleted = EXCLUDED.deleted,
        updated_at = EXCLUDED.updated_at, actor_id = EXCLUDED.actor_id
  RETURNING h.org_id, h.kind, h.record_id, h.version
),
lg AS (
  INSERT INTO platform.projexa_change_log (org_id, project_id, kind, record_id, version, op, content_hash, actor_id, db_role)
  SELECT c.org, x.proj, c.kind, c.rid, u.version, x.op, c.hash, c.actor, session_user::text
  FROM chg c JOIN up u ON u.org_id = c.org AND u.kind = c.kind AND u.record_id = c.rid
  CROSS JOIN LATERAL (VALUES (1, c.old_proj, 'D'), (2, c.proj, c.eop)) AS x(n, proj, op)
  WHERE x.proj IS NOT NULL
  ORDER BY c.rid, x.n
  RETURNING 1
)
SELECT count(*) FROM lg$q$, p_chg)
$fn$;

-- 3. the trigger function ----------------------------------------------------------------------------------------------------------------------
-- TG_ARGV: [0] kind, [1] mode, [2] a, [3] b, [4] parent kind (mode parent). Statement level, transition tables projexa_new / projexa_old.
CREATE OR REPLACE FUNCTION platform.projexa_track_change()
RETURNS trigger
LANGUAGE plpgsql SECURITY DEFINER
SET search_path = pg_catalog, pg_temp
SET timezone = 'UTC'
AS $fn$
DECLARE
  v_kind text := TG_ARGV[0];
  v_mode text := coalesce(nullif(TG_ARGV[1], ''), 'col');
  v_a text := nullif(TG_ARGV[2], '');
  v_b text := nullif(TG_ARGV[3], '');
  v_pkind text := nullif(TG_ARGV[4], '');
  v_filtered boolean;
  v_pn text;
  v_po text;
  v_cols text[];
  v_jn text;
  v_jo text;
  v_an text;
  v_ao text;
  v_fn text;
  v_fo text;
  v_ent text;
  v_pp text := 'NULL::text';
  v_pjoin text := '';
  v_any boolean;
  v_n bigint;
  v_state text;
  v_msg text;
BEGIN
  IF TG_LEVEL <> 'STATEMENT' THEN
    RETURN NULL;
  END IF;
  BEGIN
    v_filtered := v_mode IN ('link', 'col_unless', 'col_unset');
    v_pn := platform.projexa_track__project_sql(v_mode, v_a, v_b, 'n');
    v_po := platform.projexa_track__project_sql(v_mode, v_a, v_b, 'o');

    -- 0. nothing happened, or nothing that concerns a project (a DPDP document, a MoM about something else): return before any other work
    IF TG_OP = 'INSERT' THEN
      EXECUTE format('SELECT EXISTS (SELECT 1 FROM projexa_new n WHERE %s)', CASE WHEN v_filtered THEN v_pn || ' IS NOT NULL' ELSE 'true' END) INTO v_any;
    ELSIF TG_OP = 'DELETE' THEN
      EXECUTE format('SELECT EXISTS (SELECT 1 FROM projexa_old o WHERE %s)', CASE WHEN v_filtered THEN v_po || ' IS NOT NULL' ELSE 'true' END) INTO v_any;
    ELSE
      EXECUTE format('SELECT EXISTS (SELECT 1 FROM projexa_new n WHERE %s) OR EXISTS (SELECT 1 FROM projexa_old o WHERE %s)',
                     CASE WHEN v_filtered THEN v_pn || ' IS NOT NULL' ELSE 'true' END, CASE WHEN v_filtered THEN v_po || ' IS NOT NULL' ELSE 'true' END) INTO v_any;
    END IF;

    IF v_any THEN
      IF v_mode = 'org' THEN
        EXECUTE 'SELECT public.projexa_sync__org_cols($1)' INTO v_cols USING v_kind;
        v_an := 'NULL::text';
        v_ao := 'NULL::text';
      ELSE
        v_an := platform.projexa_track__actor_sql(TG_RELID, 'n');
        v_ao := platform.projexa_track__actor_sql(TG_RELID, 'o');
      END IF;
      v_jn := platform.projexa_track__json_sql(TG_RELID, v_cols, 'n');
      v_jo := platform.projexa_track__json_sql(TG_RELID, v_cols, 'o');
      IF v_mode = 'parent' THEN
        v_fn := format('n.%I::text', v_b);
        v_fo := format('o.%I::text', v_b);
        v_pp := 'ph.project_id';
        v_pjoin := 'LEFT JOIN platform.projexa_record_head ph ON ph.org_id = e.org AND ph.kind = $2 AND ph.record_id = e.parent_id';
      ELSE
        v_fn := 'NULL::text';
        v_fo := 'NULL::text';
      END IF;

      -- 1. the statement's rows: (record, organisation, project of the new row, project of the old row, content, actor, op, parent)
      IF TG_OP = 'INSERT' THEN
        v_ent := format('SELECT n.id::text AS rid, n.org_id::text AS org, %s AS pn, NULL::text AS po, %s AS j, %s AS actor, ''I''::text AS op, %s AS parent_id FROM projexa_new n%s',
                        v_pn, v_jn, v_an, v_fn, CASE WHEN v_filtered THEN ' WHERE ' || v_pn || ' IS NOT NULL' ELSE '' END);
      ELSIF TG_OP = 'DELETE' THEN
        v_ent := format('SELECT o.id::text AS rid, o.org_id::text AS org, NULL::text AS pn, %s AS po, %s AS j, %s AS actor, ''D''::text AS op, %s AS parent_id FROM projexa_old o%s',
                        v_po, v_jo, v_ao, v_fo, CASE WHEN v_filtered THEN ' WHERE ' || v_po || ' IS NOT NULL' ELSE '' END);
      ELSE
        -- an update: old and new paired by id; a row whose project and content did not change is dropped HERE (a touch of updated_at, a login of a user)
        v_ent := format(
          'SELECT x.rid, x.org, x.pn, x.po, coalesce(x.jn, x.jo) AS j, x.actor, x.op, x.parent_id FROM ('
          || 'SELECT coalesce(n.id, o.id)::text AS rid, coalesce(n.org_id, o.org_id)::text AS org, '
          || 'CASE WHEN n.id IS NOT NULL THEN %1$s END AS pn, CASE WHEN o.id IS NOT NULL THEN %2$s END AS po, '
          || 'CASE WHEN n.id IS NOT NULL THEN %3$s END AS jn, CASE WHEN o.id IS NOT NULL THEN %4$s END AS jo, '
          || 'CASE WHEN n.id IS NOT NULL THEN %5$s ELSE %6$s END AS actor, '
          || 'CASE WHEN o.id IS NULL THEN ''I'' WHEN n.id IS NULL THEN ''D'' ELSE ''U'' END AS op, '
          || 'CASE WHEN n.id IS NOT NULL THEN %7$s ELSE %8$s END AS parent_id '
          || 'FROM projexa_new n FULL JOIN projexa_old o ON o.id = n.id OFFSET 0) x '
          || 'WHERE (x.op <> ''U'' OR x.pn IS DISTINCT FROM x.po OR x.jn IS DISTINCT FROM x.jo)%9$s',
          v_pn, v_po, v_jn, v_jo, v_an, v_ao, v_fn, v_fo, CASE WHEN v_filtered THEN ' AND (x.pn IS NOT NULL OR x.po IS NOT NULL)' ELSE '' END);
      END IF;

      -- 2. resolve: the head as laptops know it, the effective op and project, real changes only. A child whose parent is already gone (a cascade, or the
      --    application deleting the BOQ before its lines) takes the project its own head recorded, else the one the PARENT's head recorded: Postgres fires the
      --    parent statement's own triggers before the cascaded children's, so a deleted parent always has its tombstone head by then.
      EXECUTE platform.projexa_track__writer_sql(format($q$e AS (%1$s),
r AS (
  SELECT e.rid, e.org, e.op, e.pn, e.po, e.parent_id, e.actor, encode(sha256(convert_to(e.j::text, 'UTF8')), 'hex') AS hash,
         h.version AS hv, h.content_hash AS hh, h.deleted AS hd,
         CASE WHEN h.version IS NOT NULL THEN CASE WHEN h.deleted THEN NULL ELSE h.project_id END ELSE e.po END AS known,
         %2$s AS pp
  FROM e LEFT JOIN platform.projexa_record_head h ON h.org_id = e.org AND h.kind = $1 AND h.record_id = e.rid
  %3$s
  WHERE e.rid IS NOT NULL AND e.org IS NOT NULL
),
d AS (
  SELECT r.*,
    CASE WHEN r.pn IS NOT NULL THEN CASE WHEN r.op = 'I' THEN 'I' ELSE 'U' END
         WHEN r.op = 'D' OR r.po IS NOT NULL THEN 'D'
         ELSE CASE WHEN r.op = 'I' THEN 'I' ELSE 'U' END END AS eop,
    CASE WHEN r.pn IS NOT NULL THEN r.pn
         WHEN r.op = 'D' OR r.po IS NOT NULL THEN coalesce(r.known, r.po, r.pp)
         ELSE coalesce(r.known, r.pp) END AS proj
  FROM r
),
chg AS (
  SELECT DISTINCT ON (d.org, d.rid) $1::text AS kind, d.org, d.rid, d.proj, d.hash, d.actor, d.eop,
         CASE WHEN d.eop <> 'D' AND d.known IS DISTINCT FROM d.proj THEN d.known END AS old_proj
  FROM d
  WHERE d.proj IS NOT NULL
    AND (d.hv IS NULL OR (d.eop = 'D' AND NOT d.hd) OR (d.eop <> 'D' AND (d.hd OR d.hh IS DISTINCT FROM d.hash OR d.known IS DISTINCT FROM d.proj)))
  ORDER BY d.org, d.rid
)$q$, v_ent, v_pp, v_pjoin)) INTO v_n USING v_kind, v_pkind;
    END IF;
  EXCEPTION WHEN OTHERS THEN
    -- tracking is best effort by design: it must never be the reason a business write fails. It is COUNTED (at most once a minute per kind, so a broken
    -- kind on a hot table cannot make every writer queue on the counter row) and the health check reports it.
    v_state := SQLSTATE;
    v_msg := SQLERRM;
    RAISE WARNING 'projexa_track_change(%): % (%)', v_kind, v_msg, v_state;
    BEGIN
      IF NOT EXISTS (SELECT 1 FROM platform.projexa_track_error x WHERE x.kind = v_kind AND x.last_at > clock_timestamp() - interval '1 minute') THEN
        INSERT INTO platform.projexa_track_error AS x (kind, errors, last_sqlstate, last_message, last_at)
        VALUES (v_kind, 1, v_state, left(v_msg, 300), clock_timestamp())
        ON CONFLICT (kind) DO UPDATE SET errors = x.errors + 1, last_sqlstate = EXCLUDED.last_sqlstate, last_message = EXCLUDED.last_message, last_at = EXCLUDED.last_at;
      END IF;
    EXCEPTION WHEN OTHERS THEN
      NULL;
    END;
  END;
  RETURN NULL;
END
$fn$;

-- 4. attach the three triggers to a list of tables, idempotently --------------------------------------------------------------------------------
-- p_specs: [{"k": kind, "t": table in schema compliance, "m": mode, "a": ..., "b": ..., "p": parent kind}]. A missing table is skipped. Returns how many tables
-- were (re)attached; 0 means every existing table already had exactly the right three triggers (so calling it twice is also the self-check).
CREATE OR REPLACE FUNCTION platform.projexa_track__attach(p_specs jsonb)
RETURNS integer
LANGUAGE plpgsql
SET search_path = pg_catalog, pg_temp
AS $fn$
DECLARE
  s jsonb;
  v_rel regclass;
  v_args text[];
  v_ok boolean;
  v_todo jsonb := '[]'::jsonb;
  v_list text;
  v_fn oid := 'platform.projexa_track_change()'::regprocedure;
  i integer;
  v_argsql text;
BEGIN
  FOR s IN SELECT e FROM jsonb_array_elements(p_specs) AS e LOOP
    v_rel := to_regclass('compliance.' || (s ->> 't'));
    CONTINUE WHEN v_rel IS NULL;
    v_args := ARRAY[s ->> 'k', coalesce(s ->> 'm', 'col'), coalesce(s ->> 'a', ''), coalesce(s ->> 'b', ''), coalesce(s ->> 'p', '')];
    SELECT count(*) = 3 INTO v_ok FROM pg_trigger tg
    WHERE tg.tgrelid = v_rel AND NOT tg.tgisinternal AND tg.tgfoid = v_fn AND tg.tgnargs = 5
      AND (tg.tgname, tg.tgtype::integer) IN (('projexa_track_i', 4), ('projexa_track_u', 16), ('projexa_track_d', 8))
      AND (string_to_array(encode(tg.tgargs, 'escape'), '\000'))[1:5] = v_args
      AND coalesce(tg.tgnewtable::text, '') = CASE tg.tgname WHEN 'projexa_track_d' THEN '' ELSE 'projexa_new' END
      AND coalesce(tg.tgoldtable::text, '') = CASE tg.tgname WHEN 'projexa_track_i' THEN '' ELSE 'projexa_old' END;
    IF v_ok AND NOT EXISTS (SELECT 1 FROM pg_trigger tg WHERE tg.tgrelid = v_rel AND tg.tgname = 'projexa_track_change') THEN
      CONTINUE;
    END IF;
    v_todo := v_todo || jsonb_build_array(s || jsonb_build_object('rel', v_rel::text));
  END LOOP;
  IF jsonb_array_length(v_todo) = 0 THEN
    RETURN 0;
  END IF;

  -- lock every table that needs work together, NOWAIT, with a short retry: never wait in a queue while holding the others
  SELECT string_agg(e ->> 'rel', ', ' ORDER BY e ->> 'rel') INTO v_list FROM jsonb_array_elements(v_todo) AS e;
  FOR i IN 1..50 LOOP
    BEGIN
      EXECUTE format('LOCK TABLE %s IN SHARE ROW EXCLUSIVE MODE NOWAIT', v_list);
      EXIT;
    EXCEPTION WHEN lock_not_available THEN
      IF i = 50 THEN
        RAISE;
      END IF;
      PERFORM pg_sleep(0.1);
    END;
  END LOOP;

  FOR s IN SELECT e FROM jsonb_array_elements(v_todo) AS e LOOP
    IF EXISTS (SELECT 1 FROM pg_trigger tg WHERE tg.tgrelid = (s ->> 'rel')::regclass AND tg.tgname = 'projexa_track_change') THEN
      EXECUTE format('DROP TRIGGER projexa_track_change ON %s', s ->> 'rel'); -- the per-row trigger of an earlier draft
    END IF;
    v_argsql := format('%L, %L, %L, %L, %L', s ->> 'k', coalesce(s ->> 'm', 'col'), coalesce(s ->> 'a', ''), coalesce(s ->> 'b', ''), coalesce(s ->> 'p', ''));
    EXECUTE format('CREATE OR REPLACE TRIGGER projexa_track_i AFTER INSERT ON %s REFERENCING NEW TABLE AS projexa_new FOR EACH STATEMENT EXECUTE FUNCTION platform.projexa_track_change(%s)', s ->> 'rel', v_argsql);
    EXECUTE format('CREATE OR REPLACE TRIGGER projexa_track_u AFTER UPDATE ON %s REFERENCING OLD TABLE AS projexa_old NEW TABLE AS projexa_new FOR EACH STATEMENT EXECUTE FUNCTION platform.projexa_track_change(%s)', s ->> 'rel', v_argsql);
    EXECUTE format('CREATE OR REPLACE TRIGGER projexa_track_d AFTER DELETE ON %s REFERENCING OLD TABLE AS projexa_old FOR EACH STATEMENT EXECUTE FUNCTION platform.projexa_track_change(%s)', s ->> 'rel', v_argsql);
  END LOOP;
  RETURN jsonb_array_length(v_todo);
END
$fn$;

REVOKE ALL ON FUNCTION platform.projexa_track__project_sql(text, text, text, text) FROM PUBLIC, anon, authenticated, service_role;
REVOKE ALL ON FUNCTION platform.projexa_track__json_sql(regclass, text[], text) FROM PUBLIC, anon, authenticated, service_role;
REVOKE ALL ON FUNCTION platform.projexa_track__actor_sql(regclass, text) FROM PUBLIC, anon, authenticated, service_role;
REVOKE ALL ON FUNCTION platform.projexa_track__writer_sql(text) FROM PUBLIC, anon, authenticated, service_role;
REVOKE ALL ON FUNCTION platform.projexa_track_change() FROM PUBLIC, anon, authenticated, service_role;
REVOKE ALL ON FUNCTION platform.projexa_track__attach(jsonb) FROM PUBLIC, anon, authenticated, service_role;

-- 5. the 13 tables of 0677's kinds ----------------------------------------------------------------------------------------------------------------
DO $$
DECLARE
  v_specs jsonb := '[
    {"k": "project",       "t": "projects",                           "m": "self"},
    {"k": "tasks",         "t": "pms_issues",                         "m": "col", "a": "project_id"},
    {"k": "boqs",          "t": "construction_boqs",                  "m": "col", "a": "project_id"},
    {"k": "boq_lines",     "t": "construction_boq_line_items",        "m": "parent", "a": "construction_boqs", "b": "boq_id", "p": "boqs"},
    {"k": "activities",    "t": "construction_activities",            "m": "col", "a": "project_id"},
    {"k": "progress",      "t": "construction_work_progress_entries", "m": "col", "a": "project_id"},
    {"k": "rfis",          "t": "construction_rfis",                  "m": "col", "a": "project_id"},
    {"k": "submittals",    "t": "construction_submittals",            "m": "col", "a": "project_id"},
    {"k": "punch_list",    "t": "construction_punch_list_items",      "m": "col", "a": "project_id"},
    {"k": "change_orders", "t": "construction_change_orders",         "m": "col", "a": "project_id"},
    {"k": "milestones",    "t": "pms_milestones",                     "m": "col", "a": "project_id"},
    {"k": "materials",     "t": "construction_materials",             "m": "col", "a": "project_id"},
    {"k": "documents",     "t": "documents",                          "m": "link", "a": "linked_entity_type", "b": "linked_entity_id"}
  ]'::jsonb;
BEGIN
  PERFORM platform.projexa_track__attach(v_specs);
  -- self-check (sql:SQL-08): a second pass must find nothing left to do
  IF platform.projexa_track__attach(v_specs) <> 0 THEN
    RAISE EXCEPTION 'projexa tracking self-check failed: triggers are not as specified';
  END IF;
END $$;

-- 6. rows with versions: one builder for pull and pull_ids ----------------------------------------------------------------------------------------
-- p_cands is [{id, ts}] in the order to answer; every row is the AI work link's own row for that id under the bound context, with its version.
-- ONE statement per page (records_core is called once per id inside it; the versions come from one join; jsonb_agg, not repeated concatenation).
CREATE OR REPLACE FUNCTION public.projexa_sync__items(p_bound jsonb, p_org text, p_kind text, p_cands jsonb)
RETURNS jsonb
LANGUAGE sql STABLE
SET search_path = pg_catalog, pg_temp
AS $fn$
  SELECT coalesce(jsonb_agg(jsonb_build_object('id', c.e ->> 'id', 'updated_at', c.e ->> 'ts', 'version', coalesce(h.version, 0), 'data', r.row) ORDER BY c.n), '[]'::jsonb)
  FROM jsonb_array_elements(p_cands) WITH ORDINALITY AS c(e, n)
  CROSS JOIN LATERAL (SELECT (public.ai_work_link__records_core(p_bound, p_kind, NULL, 1, '{}'::jsonb, c.e ->> 'id')) -> 'items' -> 0 AS row) r
  LEFT JOIN platform.projexa_record_head h ON h.org_id = p_org AND h.kind = p_kind AND h.record_id = c.e ->> 'id'
  WHERE r.row IS NOT NULL
$fn$;

-- 7. pull, replaced: 0677's answer plus version on every item and the view class the page was redacted under --------------------------------------
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
    'redacted', coalesce(cardinality(v_hidden), 0) > 0,
    'view_class', public.projexa_sync__view_class(v_org, v_ctx ->> 'live_role'));
END
$fn$;

-- 8. exact rows by id ------------------------------------------------------------------------------------------------------------------------
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
    'redacted', coalesce(cardinality(v_hidden), 0) > 0,
    'view_class', public.projexa_sync__view_class(v_org, v_ctx ->> 'live_role'));
END
$fn$;

-- 9. the change feed of one (organisation, project) -------------------------------------------------------------------------------------------------
-- Rows are served only below the reader's snapshot xmin (every older transaction is finished), in (xid, seq) order, whole transactions per page, one entry per
-- record (its latest change on the page). The cursor (p_after) is the xid of the last transaction received; NULL asks for the head only.
CREATE OR REPLACE FUNCTION public.projexa_sync__feed(p_org text, p_project text, p_kinds text[], p_after bigint, p_limit integer)
RETURNS jsonb
LANGUAGE plpgsql STABLE
SET search_path = pg_catalog, pg_temp
SET timezone = 'UTC'
AS $fn$
DECLARE
  v_snap pg_snapshot := pg_current_snapshot();
  v_horizon xid8 := public.projexa_sync__horizon();
  v_epoch text;
  v_head bigint;
  v_floor bigint;
  v_rows jsonb;
  v_n integer;
  v_cut bigint;
  v_has_more boolean := false;
  v_next bigint;
  v_page jsonb;
BEGIN
  SELECT e.epoch INTO v_epoch FROM platform.projexa_sync_epoch e;
  SELECT c.xid::text::bigint INTO v_head FROM platform.projexa_change_log c
  WHERE c.org_id = p_org AND c.project_id = p_project AND c.xid < v_horizon AND c.kind = ANY (p_kinds)
  ORDER BY c.xid DESC, c.seq DESC LIMIT 1;
  v_head := coalesce(v_head, 0);
  SELECT f.floor_xid::text::bigint INTO v_floor FROM platform.projexa_change_floor f WHERE f.org_id = p_org AND f.project_id = p_project;

  IF p_after IS NULL THEN
    RETURN jsonb_build_object('status', 'ok', 'changes', '[]'::jsonb, 'next_seq', v_head, 'has_more', false, 'head_seq', v_head, 'epoch', v_epoch, 'reset_required', false);
  END IF;
  -- older than the pruned history, or from the future (a restored database): the laptop must resync this project fully, then continue from head_seq
  IF (v_floor IS NOT NULL AND p_after < v_floor) OR p_after >= pg_snapshot_xmax(v_snap)::text::bigint THEN
    RETURN jsonb_build_object('status', 'ok', 'changes', '[]'::jsonb, 'next_seq', v_head, 'has_more', false, 'head_seq', v_head, 'epoch', v_epoch, 'reset_required', true);
  END IF;

  SELECT coalesce(jsonb_agg(jsonb_build_object('seq', x.seq, 'x', x.xid::text::bigint, 'kind', x.kind, 'id', x.record_id, 'version', x.version, 'op', x.op::text) ORDER BY x.xid, x.seq), '[]'::jsonb)
    INTO v_rows
  FROM (SELECT c.seq, c.xid, c.kind, c.record_id, c.version, c.op FROM platform.projexa_change_log c
        WHERE c.org_id = p_org AND c.project_id = p_project AND c.xid > p_after::text::xid8 AND c.xid < v_horizon AND c.kind = ANY (p_kinds)
        ORDER BY c.xid, c.seq LIMIT p_limit + 1) x;
  v_n := jsonb_array_length(v_rows);

  IF v_n > p_limit THEN
    v_has_more := true;
    v_cut := (v_rows -> p_limit ->> 'x')::bigint;
    IF (v_rows -> 0 ->> 'x')::bigint = v_cut THEN
      -- one transaction larger than a page: it comes whole (a cursor cannot point inside a transaction)
      SELECT coalesce(jsonb_agg(jsonb_build_object('seq', x.seq, 'x', x.xid::text::bigint, 'kind', x.kind, 'id', x.record_id, 'version', x.version, 'op', x.op::text) ORDER BY x.seq), '[]'::jsonb)
        INTO v_rows
      FROM (SELECT c.seq, c.xid, c.kind, c.record_id, c.version, c.op FROM platform.projexa_change_log c
            WHERE c.org_id = p_org AND c.project_id = p_project AND c.xid = v_cut::text::xid8 AND c.kind = ANY (p_kinds)
            ORDER BY c.seq LIMIT 20001) x;
      IF jsonb_array_length(v_rows) > 20000 THEN
        -- re-reading the project is cheaper than naming more than 20,000 records: resync, then continue from head_seq
        RETURN jsonb_build_object('status', 'ok', 'changes', '[]'::jsonb, 'next_seq', v_head, 'has_more', false, 'head_seq', v_head, 'epoch', v_epoch, 'reset_required', true);
      END IF;
      v_next := v_cut;
      v_has_more := EXISTS (SELECT 1 FROM platform.projexa_change_log c
                            WHERE c.org_id = p_org AND c.project_id = p_project AND c.xid > v_cut::text::xid8 AND c.xid < v_horizon AND c.kind = ANY (p_kinds));
    ELSE
      SELECT jsonb_agg(t.e ORDER BY t.n) INTO v_rows FROM jsonb_array_elements(v_rows) WITH ORDINALITY AS t(e, n) WHERE (t.e ->> 'x')::bigint < v_cut;
      v_next := (v_rows -> (jsonb_array_length(v_rows) - 1) ->> 'x')::bigint;
    END IF;
  ELSE
    v_next := CASE WHEN v_n > 0 THEN (v_rows -> (v_n - 1) ->> 'x')::bigint ELSE p_after END;
  END IF;

  -- one entry per record: its latest change on this page
  SELECT coalesce(jsonb_agg(jsonb_build_object('seq', d.e -> 'seq', 'kind', d.e -> 'kind', 'id', d.e -> 'id', 'version', d.e -> 'version', 'op', d.e -> 'op') ORDER BY d.n), '[]'::jsonb)
    INTO v_page
  FROM (SELECT DISTINCT ON (t.e ->> 'kind', t.e ->> 'id') t.e, t.n FROM jsonb_array_elements(v_rows) WITH ORDINALITY AS t(e, n) ORDER BY t.e ->> 'kind', t.e ->> 'id', t.n DESC) d;

  RETURN jsonb_build_object('status', 'ok', 'changes', v_page, 'next_seq', v_next, 'has_more', v_has_more, 'head_seq', greatest(v_head, v_next), 'epoch', v_epoch, 'reset_required', false);
END
$fn$;

-- the reader's horizon: every transaction older than this is finished. Its own function so the deterministic out-of-order test can pin it (a single PGlite backend
-- cannot hold two open transactions).
CREATE OR REPLACE FUNCTION public.projexa_sync__horizon()
RETURNS xid8
LANGUAGE sql STABLE
SET search_path = pg_catalog, pg_temp
AS $fn$ SELECT pg_snapshot_xmin(pg_current_snapshot()) $fn$;

-- 10. what changed in a project since a cursor (and the tombstones) -------------------------------------------------------------------------------
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
  RETURN public.projexa_sync__feed(v_org, p_project_id, public.projexa_sync__kinds(), p_after_seq, p_limit);
END
$fn$;

-- 11. id inventory, replaced: 0678's answer plus the version of every id (0 = untracked), the head and the epoch, so the reconcile also repairs a stale version and a
-- laptop can tell what changed while it was paging (sync:SYNC-01 (2), SYNC-08)
CREATE OR REPLACE FUNCTION public.projexa_sync_ids(
  p_sub text, p_email text, p_project_id text, p_kind text, p_after_id text DEFAULT NULL, p_limit integer DEFAULT 5000)
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
  v_ids jsonb;
  v_vers jsonb;
  v_n integer;
  v_has_more boolean := false;
  v_feed jsonb;
BEGIN
  IF p_limit IS NULL OR p_limit < 1 OR p_limit > 5000 THEN
    RAISE EXCEPTION 'BAD_LIMIT' USING ERRCODE = 'AW400';
  END IF;
  IF p_after_id IS NOT NULL AND p_after_id !~ '^[A-Za-z0-9._:-]{1,64}$' THEN
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
  SELECT s.from_sql, s.scope_sql INTO v_src FROM public.projexa_sync__src(p_kind) s;
  IF NOT FOUND THEN
    RAISE EXCEPTION 'NOT_FOUND' USING ERRCODE = 'AW404';
  END IF;
  -- the head BEFORE the list is read: a laptop keeps a local row that the list does not name when the feed names it after this point
  v_feed := public.projexa_sync__feed(v_org, p_project_id, public.projexa_sync__kinds(), NULL, 1);

  EXECUTE format(
    'SELECT coalesce(jsonb_agg(c.id ORDER BY c.id), ''[]''::jsonb), coalesce(jsonb_agg(coalesce(h.version, 0) ORDER BY c.id), ''[]''::jsonb) '
    || 'FROM (SELECT t.id::text AS id FROM %1$s WHERE %2$s%3$s ORDER BY t.id::text LIMIT %4$s) c '
    || 'LEFT JOIN platform.projexa_record_head h ON h.org_id = $2 AND h.kind = $4 AND h.record_id = c.id',
    v_src.from_sql, v_src.scope_sql, CASE WHEN p_after_id IS NULL THEN '' ELSE ' AND t.id::text > $3' END, p_limit + 1)
    INTO v_ids, v_vers USING p_project_id, v_org, p_after_id, p_kind;

  v_n := jsonb_array_length(v_ids);
  IF v_n > p_limit THEN
    v_has_more := true;
    v_ids := v_ids - p_limit;
    v_vers := v_vers - p_limit;
    v_n := p_limit;
  END IF;

  RETURN jsonb_build_object('status', 'ok', 'ids', v_ids, 'has_more', v_has_more, 'next_id', CASE WHEN v_n > 0 THEN v_ids ->> (v_n - 1) END,
                            'versions', v_vers, 'head_seq', v_feed -> 'head_seq', 'epoch', v_feed -> 'epoch');
END
$fn$;

-- 12. grants ----------------------------------------------------------------------------------------------------------------------------------
REVOKE ALL ON FUNCTION public.projexa_sync__items(jsonb, text, text, jsonb) FROM PUBLIC, anon, authenticated, service_role;
REVOKE ALL ON FUNCTION public.projexa_sync__feed(text, text, text[], bigint, integer) FROM PUBLIC, anon, authenticated, service_role;
REVOKE ALL ON FUNCTION public.projexa_sync__horizon() FROM PUBLIC, anon, authenticated, service_role;
REVOKE ALL ON FUNCTION public.projexa_sync_pull(text, text, text, text, text, text, integer) FROM PUBLIC, anon, authenticated;
REVOKE ALL ON FUNCTION public.projexa_sync_pull_ids(text, text, text, text, text[]) FROM PUBLIC, anon, authenticated;
REVOKE ALL ON FUNCTION public.projexa_sync_changes(text, text, text, bigint, integer) FROM PUBLIC, anon, authenticated;
REVOKE ALL ON FUNCTION public.projexa_sync_ids(text, text, text, text, text, integer) FROM PUBLIC, anon, authenticated;
DO $$ BEGIN
  IF EXISTS (SELECT 1 FROM pg_roles WHERE rolname = 'app_runtime') THEN
    EXECUTE 'REVOKE ALL ON FUNCTION public.projexa_sync__items(jsonb, text, text, jsonb) FROM app_runtime';
    EXECUTE 'REVOKE ALL ON FUNCTION public.projexa_sync__feed(text, text, text[], bigint, integer) FROM app_runtime';
    EXECUTE 'REVOKE ALL ON FUNCTION public.projexa_sync__horizon() FROM app_runtime';
    EXECUTE 'REVOKE ALL ON FUNCTION public.projexa_sync_pull(text, text, text, text, text, text, integer) FROM app_runtime';
    EXECUTE 'REVOKE ALL ON FUNCTION public.projexa_sync_pull_ids(text, text, text, text, text[]) FROM app_runtime';
    EXECUTE 'REVOKE ALL ON FUNCTION public.projexa_sync_changes(text, text, text, bigint, integer) FROM app_runtime';
    EXECUTE 'REVOKE ALL ON FUNCTION public.projexa_sync_ids(text, text, text, text, text, integer) FROM app_runtime';
    EXECUTE 'REVOKE ALL ON FUNCTION platform.projexa_track__project_sql(text, text, text, text) FROM app_runtime';
    EXECUTE 'REVOKE ALL ON FUNCTION platform.projexa_track__json_sql(regclass, text[], text) FROM app_runtime';
    EXECUTE 'REVOKE ALL ON FUNCTION platform.projexa_track__actor_sql(regclass, text) FROM app_runtime';
    EXECUTE 'REVOKE ALL ON FUNCTION platform.projexa_track__writer_sql(text) FROM app_runtime';
    EXECUTE 'REVOKE ALL ON FUNCTION platform.projexa_track_change() FROM app_runtime';
    EXECUTE 'REVOKE ALL ON FUNCTION platform.projexa_track__attach(jsonb) FROM app_runtime';
  END IF;
END $$;
GRANT EXECUTE ON FUNCTION public.projexa_sync_pull(text, text, text, text, text, text, integer) TO service_role;
GRANT EXECUTE ON FUNCTION public.projexa_sync_pull_ids(text, text, text, text, text[]) TO service_role;
GRANT EXECUTE ON FUNCTION public.projexa_sync_changes(text, text, text, bigint, integer) TO service_role;
GRANT EXECUTE ON FUNCTION public.projexa_sync_ids(text, text, text, text, text, integer) TO service_role;

COMMIT;
