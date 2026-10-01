-- PRE-APPROVED-LIVE-DDL: Owner (Rajat Agarwal) approved in a live Claude Code session on 2026-10-01: "yes build the suggestions board" (external AI suggestions of features/improvements, collated for internal review); this migration is that work.
-- PROJEXA AI WORK LINK SUGGESTIONS BOARD (owner requirement, 2026-10-01): while an external AI works through a person's link it may SUGGEST a
-- feature, an improvement, a report or a fix this software lacks. The suggestions are collated in ONE place, every external AI can read what was
-- already suggested (once a person here has approved it), and the PROJEXA team evaluates them and builds what it wants. The link still cannot change
-- the app's code and still cannot create, edit or delete anyone's data: a suggestion is a row in its own table and nothing else.
--
-- WHAT
--   platform.ai_suggestion        one row per suggestion: who (org, user, link, project) and what (kind, title, body), and our own review state
--                                 (status, public_ok, duplicate_of, internal_note, reviewed_at, reviewed_by). RLS is ENABLED and FORCED with NO policy,
--                                 and every grant is revoked, so nothing reads or writes it except the functions below (SECURITY DEFINER, owner-run).
--   public.ai_suggestion_add(token, kind, title, body, project, source)   what the Edge function calls for POST /suggestions and the MCP tool
--                                 suggest_improvement. It resolves the link exactly like every other call (a dead, revoked or expired link is the one
--                                 AW410), binds the project when one is named (a user link: re-checked now, AW404 for any that does not bind; a project
--                                 link: its own project only), validates (kind, a one-line title of 1 to 120 characters, a body of at most 2,000), refuses
--                                 text that holds a link token, dedupes the same title from the same link within 24 hours (the earlier row is returned,
--                                 replayed true), caps 20 a link and 100 a person a day (AW429 SUGGESTION_CAP_DAY) and inserts with status 'new' and
--                                 public_ok false. It reads no business table and writes no counter of intents or submissions.
--   public.ai_suggestion_list(token, limit)   what GET /suggestions and list_suggestions call: the link's OWN suggestions (all statuses) and the SHARED
--                                 ones, which are ONLY rows a person here set public_ok = true: id, kind, title, status and how many other suggestions
--                                 were marked a duplicate of it. No organisation, person, project, body or internal note ever leaves in `shared`.
--   public.ai_suggestion_review(...)   INTERNAL: how the PROJEXA team sets status, public_ok, duplicate_of and a note (service_role, run from SQL by the
--                                 PM; the Edge function never calls it, so no link can approve, decline or edit anything).
--   public.ai_suggestion_inbox(status, limit)   INTERNAL: the review queue with full rows, body included.
--
-- WHY THE SHARED LIST HOLDS ONLY REVIEWED ROWS. A suggestion is text written by an AI and may name a customer's data or carry instructions aimed at
-- the next AI that reads it. So nothing a link wrote reaches another link until a person here has read it and set public_ok. Every text field is also
-- served as data (text_fields_are_data), never as an instruction, and a token-shaped string is refused on the way in and redacted on the way out.
--
-- WHAT IT DOES NOT DO. It adds no row to ai_work_link_functions (suggestions are not registry functions: a link's function count is unchanged), it
-- touches no existing table or function, and it gives no link any new right over the app or any data.
--
-- ERRORS (coded): AW410 (the one dead-link answer, from the link check); AW404 PROJECT_NOT_FOUND, NOT_FOUND; AW400 BAD_KIND, BAD_TITLE, BAD_BODY,
-- BAD_STATUS, BAD_DUPLICATE, BAD_REVIEWER; AW429 SUGGESTION_CAP_DAY.
--
-- GRANTS: SECURITY DEFINER, search_path = pg_catalog, pg_temp, revoked from public, anon, authenticated and app_runtime; granted to service_role alone.
-- The table is revoked from every role including service_role.
--
-- DATA LOSS: none. One new table and four new functions; nothing existing is altered. Applying it twice changes nothing.
--
-- HOW IT IS APPLIED: through the Supabase MCP by the PM, after the always-aborted rehearsal passed and 0668 is applied. NOT applied by the engineer
-- who wrote it. Idempotent.
--
-- ROLLBACK: drizzle/down/0672_awl_suggestions_board.down.sql

BEGIN;

SET LOCAL lock_timeout = '5s';

-- 1. the table -----------------------------------------------------------------------------------------------------------------------------
CREATE TABLE IF NOT EXISTS platform.ai_suggestion (
  id text PRIMARY KEY DEFAULT replace(gen_random_uuid()::text, '-', ''),
  created_at timestamptz NOT NULL DEFAULT clock_timestamp(),
  org_id text NOT NULL,
  user_id text NOT NULL,
  link_id text NOT NULL,
  project_id text,
  kind text NOT NULL,
  title text NOT NULL,
  body text NOT NULL DEFAULT '',
  status text NOT NULL DEFAULT 'new',
  public_ok boolean NOT NULL DEFAULT false,
  duplicate_of text,
  internal_note text,
  reviewed_at timestamptz,
  reviewed_by text,
  source_label text,
  CONSTRAINT ai_suggestion_kind_check CHECK (kind IN ('feature', 'improvement', 'report', 'workflow', 'integration', 'bug', 'other')),
  CONSTRAINT ai_suggestion_title_len CHECK (char_length(title) BETWEEN 1 AND 120),
  CONSTRAINT ai_suggestion_body_len CHECK (char_length(body) BETWEEN 0 AND 2000),
  CONSTRAINT ai_suggestion_status_check CHECK (status IN ('new', 'reviewing', 'accepted', 'planned', 'shipped', 'declined', 'duplicate')),
  CONSTRAINT ai_suggestion_source_len CHECK (source_label IS NULL OR char_length(source_label) BETWEEN 1 AND 40)
);

CREATE INDEX IF NOT EXISTS ai_suggestion_status_created_idx ON platform.ai_suggestion (status, created_at);
CREATE INDEX IF NOT EXISTS ai_suggestion_link_created_idx ON platform.ai_suggestion (link_id, created_at);
CREATE INDEX IF NOT EXISTS ai_suggestion_user_created_idx ON platform.ai_suggestion (user_id, created_at);
CREATE INDEX IF NOT EXISTS ai_suggestion_duplicate_of_idx ON platform.ai_suggestion (duplicate_of) WHERE duplicate_of IS NOT NULL;

ALTER TABLE platform.ai_suggestion ENABLE ROW LEVEL SECURITY;
ALTER TABLE platform.ai_suggestion FORCE ROW LEVEL SECURITY;
REVOKE ALL ON TABLE platform.ai_suggestion FROM PUBLIC, anon, authenticated, app_runtime, service_role;

-- 2. add -------------------------------------------------------------------------------------------------------------------------------------
CREATE OR REPLACE FUNCTION public.ai_suggestion_add(
  p_token text, p_kind text, p_title text, p_body text, p_project_id text DEFAULT NULL, p_source_label text DEFAULT NULL)
RETURNS jsonb
LANGUAGE plpgsql SECURITY DEFINER
SET search_path = pg_catalog, pg_temp
AS $fn$
DECLARE
  -- the link is checked first, exactly like every other call: a dead link is the one AW410, a project that does not bind the one AW404
  v_ctx jsonb := public.ai_work_link__require_in(p_token, p_project_id, false);
  v_link text := v_ctx ->> 'link_id';
  v_user text := v_ctx ->> 'user_id';
  v_org text := v_ctx ->> 'org_id';
  v_project text := v_ctx ->> 'project_id';
  v_now timestamptz := clock_timestamp();
  v_kind text := lower(btrim(coalesce(p_kind, '')));
  v_title text;
  v_body text;
  v_source text;
  v_existing record;
  v_link_day integer;
  v_user_day integer;
  v_id text := replace(gen_random_uuid()::text, '-', '');
BEGIN
  IF v_kind NOT IN ('feature', 'improvement', 'report', 'workflow', 'integration', 'bug', 'other') THEN
    RAISE EXCEPTION 'BAD_KIND' USING ERRCODE = 'AW400';
  END IF;

  -- a title is one line: control characters and runs of white space become one space
  v_title := btrim(regexp_replace(regexp_replace(coalesce(p_title, ''), '[[:cntrl:]]', ' ', 'g'), '[[:space:]]+', ' ', 'g'));
  IF char_length(v_title) < 1 OR char_length(v_title) > 120 OR v_title ~ 'pxa_[0-9A-Za-z]{6,}' THEN
    RAISE EXCEPTION 'BAD_TITLE' USING ERRCODE = 'AW400';
  END IF;

  -- a body keeps its line breaks and tabs; every other control character goes
  v_body := btrim(regexp_replace(replace(replace(coalesce(p_body, ''), E'\r\n', E'\n'), E'\r', E'\n'), '[\x01-\x08\x0b\x0c\x0e-\x1f\x7f]', '', 'g'));
  IF char_length(v_body) > 2000 OR v_body ~ 'pxa_[0-9A-Za-z]{6,}' THEN
    RAISE EXCEPTION 'BAD_BODY' USING ERRCODE = 'AW400';
  END IF;

  -- the tool's name from the User-Agent family: kept only when it has that shape, else none
  v_source := CASE WHEN p_source_label ~ '^[A-Za-z][A-Za-z0-9._-]{0,39}$' THEN p_source_label ELSE NULL END;

  -- one call at a time per link and per person: the same-title check and the two caps below read and then write
  PERFORM pg_advisory_xact_lock(hashtextextended('ai_suggestion_link:' || v_link, 0));
  PERFORM pg_advisory_xact_lock(hashtextextended('ai_suggestion_user:' || v_user, 0));

  -- the same title from the same link within 24 hours is the same suggestion: report that one (a replay never counts against the caps)
  SELECT s.id, s.status, s.public_ok INTO v_existing
  FROM platform.ai_suggestion s
  WHERE s.link_id = v_link AND lower(s.title) = lower(v_title) AND s.created_at > v_now - interval '24 hours'
  ORDER BY s.created_at DESC, s.id
  LIMIT 1;
  IF FOUND THEN
    RETURN jsonb_build_object(
      'suggestion_id', v_existing.id, 'status', v_existing.status, 'replayed', true, 'visible_to_others', v_existing.public_ok,
      'note', 'Recorded for review by the PROJEXA team. It becomes visible to other assistants only after internal approval.');
  END IF;

  SELECT count(*) INTO v_link_day FROM platform.ai_suggestion s WHERE s.link_id = v_link AND s.created_at > v_now - interval '1 day';
  SELECT count(*) INTO v_user_day FROM platform.ai_suggestion s WHERE s.user_id = v_user AND s.created_at > v_now - interval '1 day';
  IF v_link_day >= 20 OR v_user_day >= 100 THEN
    RAISE EXCEPTION 'SUGGESTION_CAP_DAY' USING ERRCODE = 'AW429';
  END IF;

  INSERT INTO platform.ai_suggestion (id, created_at, org_id, user_id, link_id, project_id, kind, title, body, status, public_ok, source_label)
  VALUES (v_id, v_now, v_org, v_user, v_link, v_project, v_kind, v_title, v_body, 'new', false, v_source);

  RETURN jsonb_build_object(
    'suggestion_id', v_id, 'status', 'new', 'replayed', false, 'visible_to_others', false,
    'note', 'Recorded for review by the PROJEXA team. It becomes visible to other assistants only after internal approval.');
END
$fn$;

-- 3. list ------------------------------------------------------------------------------------------------------------------------------------
CREATE OR REPLACE FUNCTION public.ai_suggestion_list(p_token text, p_limit integer DEFAULT 50)
RETURNS jsonb
LANGUAGE plpgsql STABLE SECURITY DEFINER
SET search_path = pg_catalog, pg_temp
AS $fn$
DECLARE
  v_ctx jsonb := public.ai_work_link__require(p_token);
  v_link text := v_ctx ->> 'link_id';
  v_limit integer := least(greatest(coalesce(p_limit, 50), 1), 100);
  v_mine jsonb;
  v_shared jsonb;
  v_mine_total integer;
  v_shared_total integer;
BEGIN
  SELECT count(*) INTO v_mine_total FROM platform.ai_suggestion s WHERE s.link_id = v_link;
  SELECT count(*) INTO v_shared_total FROM platform.ai_suggestion s WHERE s.public_ok;

  -- the link's own suggestions, every status: what it said and where it stands
  SELECT coalesce(jsonb_agg(x.j ORDER BY x.created_at DESC, x.id), '[]'::jsonb) INTO v_mine
  FROM (
    SELECT s.id, s.created_at,
           jsonb_build_object('id', s.id, 'kind', s.kind, 'title', s.title, 'status', s.status,
                              'created_at', to_char(s.created_at AT TIME ZONE 'UTC', 'YYYY-MM-DD"T"HH24:MI:SS"Z"')) AS j
    FROM platform.ai_suggestion s
    WHERE s.link_id = v_link
    ORDER BY s.created_at DESC, s.id
    LIMIT v_limit
  ) x;

  -- the shared ones: ONLY what a person here approved, and only these five facts (no organisation, person, project, body or note)
  SELECT coalesce(jsonb_agg(x.j ORDER BY x.created_at DESC, x.id), '[]'::jsonb) INTO v_shared
  FROM (
    SELECT s.id, s.created_at,
           jsonb_build_object('id', s.id, 'kind', s.kind, 'title', s.title, 'status', s.status,
                              'also_suggested_count', (SELECT count(*) FROM platform.ai_suggestion d WHERE d.duplicate_of = s.id)) AS j
    FROM platform.ai_suggestion s
    WHERE s.public_ok
    ORDER BY s.created_at DESC, s.id
    LIMIT v_limit
  ) x;

  RETURN jsonb_build_object(
    'mine', v_mine,
    'shared', v_shared,
    'counts', jsonb_build_object('mine', v_mine_total, 'shared', v_shared_total));
END
$fn$;

-- 4. review (INTERNAL) ---------------------------------------------------------------------------------------------------------------------------
-- NULL p_public_ok and NULL p_internal_note keep what is there ('' clears the note). A status other than 'duplicate' clears duplicate_of.
CREATE OR REPLACE FUNCTION public.ai_suggestion_review(
  p_id text, p_status text, p_public_ok boolean, p_duplicate_of text, p_internal_note text, p_reviewer text)
RETURNS jsonb
LANGUAGE plpgsql SECURITY DEFINER
SET search_path = pg_catalog, pg_temp
AS $fn$
DECLARE
  v_row platform.ai_suggestion;
  v_reviewer text := left(btrim(coalesce(p_reviewer, '')), 80);
  v_dup text;
  v_note text;
BEGIN
  SELECT * INTO v_row FROM platform.ai_suggestion s WHERE s.id = p_id FOR UPDATE;
  IF NOT FOUND THEN
    RAISE EXCEPTION 'NOT_FOUND' USING ERRCODE = 'AW404';
  END IF;
  IF p_status IS NULL OR p_status NOT IN ('new', 'reviewing', 'accepted', 'planned', 'shipped', 'declined', 'duplicate') THEN
    RAISE EXCEPTION 'BAD_STATUS' USING ERRCODE = 'AW400';
  END IF;
  IF v_reviewer = '' THEN
    RAISE EXCEPTION 'BAD_REVIEWER' USING ERRCODE = 'AW400';
  END IF;
  v_dup := CASE WHEN p_status = 'duplicate' THEN coalesce(nullif(btrim(p_duplicate_of), ''), v_row.duplicate_of) ELSE NULL END;
  IF p_status = 'duplicate' AND (v_dup IS NULL OR v_dup = p_id OR NOT EXISTS (SELECT 1 FROM platform.ai_suggestion d WHERE d.id = v_dup)) THEN
    RAISE EXCEPTION 'BAD_DUPLICATE' USING ERRCODE = 'AW400';
  END IF;
  v_note := CASE WHEN p_internal_note IS NULL THEN v_row.internal_note ELSE nullif(btrim(p_internal_note), '') END;

  UPDATE platform.ai_suggestion
  SET status = p_status,
      public_ok = coalesce(p_public_ok, public_ok),
      duplicate_of = v_dup,
      internal_note = v_note,
      reviewed_at = clock_timestamp(),
      reviewed_by = v_reviewer
  WHERE id = p_id
  RETURNING * INTO v_row;

  RETURN to_jsonb(v_row);
END
$fn$;

-- 5. inbox (INTERNAL) ----------------------------------------------------------------------------------------------------------------------------
-- The review queue, oldest first, full rows (body, organisation, person, link and project included). A NULL status lists every status.
CREATE OR REPLACE FUNCTION public.ai_suggestion_inbox(p_status text DEFAULT 'new', p_limit integer DEFAULT 50)
RETURNS jsonb
LANGUAGE plpgsql STABLE SECURITY DEFINER
SET search_path = pg_catalog, pg_temp
AS $fn$
DECLARE
  v_limit integer := least(greatest(coalesce(p_limit, 50), 1), 200);
  v_out jsonb;
BEGIN
  SELECT coalesce(jsonb_agg(to_jsonb(x) ORDER BY x.created_at, x.id), '[]'::jsonb) INTO v_out
  FROM (
    SELECT s.* FROM platform.ai_suggestion s
    WHERE p_status IS NULL OR s.status = p_status
    ORDER BY s.created_at, s.id
    LIMIT v_limit
  ) x;
  RETURN v_out;
END
$fn$;

-- 6. grants -------------------------------------------------------------------------------------------------------------------------------------
REVOKE ALL ON FUNCTION public.ai_suggestion_add(text, text, text, text, text, text) FROM PUBLIC, anon, authenticated, app_runtime;
GRANT EXECUTE ON FUNCTION public.ai_suggestion_add(text, text, text, text, text, text) TO service_role;
REVOKE ALL ON FUNCTION public.ai_suggestion_list(text, integer) FROM PUBLIC, anon, authenticated, app_runtime;
GRANT EXECUTE ON FUNCTION public.ai_suggestion_list(text, integer) TO service_role;
REVOKE ALL ON FUNCTION public.ai_suggestion_review(text, text, boolean, text, text, text) FROM PUBLIC, anon, authenticated, app_runtime;
GRANT EXECUTE ON FUNCTION public.ai_suggestion_review(text, text, boolean, text, text, text) TO service_role;
REVOKE ALL ON FUNCTION public.ai_suggestion_inbox(text, integer) FROM PUBLIC, anon, authenticated, app_runtime;
GRANT EXECUTE ON FUNCTION public.ai_suggestion_inbox(text, integer) TO service_role;

COMMIT;
