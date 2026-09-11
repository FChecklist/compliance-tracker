-- CRR-027/028 EXPAND step, part 2 (W-ENV, 2026-09-10). Per PM instruction:
-- EXPAND ONLY -- purely additive, zero policy changes, zero grant removals,
-- nothing that can deny a call that used to succeed. Safe at 21:xx when the
-- CONTRACT phase (dropping the blanket app_runtime_preauth_read_*/update_*
-- qual=true policies) is explicitly NOT, per PM's own 0587 revert earlier
-- today. Covers, in one migration:
--   (A) the two tables with ZERO expand-phase functions at all
--       (compliance.report_share_links, compliance.api_key_request_log --
--       confirmed live via `select proname from pg_proc where proname ilike
--       '%share_link%' or '%api_key_request%' or '%report_share%'` -> 0 rows,
--       both today and re-confirmed before writing this file);
--   (B) the 6 NEEDS_NEW_NARROW_FUNCTION call sites from
--       pm/CRR027_028_CONTRACT_AUDIT_2026-09-10.md section 6, whose exact
--       function shapes were already worked out there and are reproduced
--       here verbatim, not re-derived;
--   (C) one ADDITIONAL function beyond the audit's 6, requested directly by
--       PM: api_key_request_log's real pre-auth need is a WRITE (a batched
--       multi-org INSERT, src/lib/auth/api-key-audit.ts's insertRequestLog),
--       not a read -- the audit only flagged the READ side (the rate-limit
--       COUNT in api-key-auth.ts) as needing a function, since an
--       unconditional INSERT policy does not expose existing rows and so was
--       correctly not counted as a leak. This file gives the table's WRITE
--       surface its own narrow path too, on PM's explicit instruction, not
--       because the audit required it.
--
-- SEVEN functions total: 4 for compliance.users (audit rows: prompt-
-- governance-service.ts:193, support-session-service.ts:96, dispatch-
-- completion-monitor/run/route.ts:66, whoami-target/route.ts:31), 2 for
-- compliance.api_key_request_log (the audited READ + the PM-requested
-- WRITE), 1 for compliance.report_share_links (the audited READ). All 6 of
-- the audit's NEED_NEW_NARROW_FUNCTION rows are covered -- none dropped.
--
-- *** THE ONE PLACE report_share_links DOES NOT MATCH
-- rpc_resolve_ai_link_token's SHAPE, STATED EXPLICITLY BECAUSE IT IS EASY TO
-- MISS *** -- rpc_resolve_ai_link_token (0584, today) bakes its own
-- usability check (status = 'active') directly into the SQL WHERE clause,
-- because that check is unique to platform.user_ai_links. report_share_links'
-- equivalent check is NOT unique to this table: src/lib/share-link-usable.ts
-- is a single, deliberately dependency-free, unit-tested-without-a-database
-- predicate (isShareLinkUsable: not revoked, not expired) shared verbatim
-- across at least seven public token surfaces in this codebase (report-
-- share-service.ts, veri-meeting-service.ts, veri-chat-service.ts x2,
-- firm-client-portal-service.ts, erp-vendor-master-service.ts, erp-
-- procurement-workflow-service.ts -- confirmed live via grep before writing
-- this file, not assumed from the file's own header comment alone). That
-- file's own header states outright: "a security predicate copied into four
-- places is not wrong today, it is a thing that goes wrong QUIETLY later,
-- when one copy is edited and the others are not." Baking a report_share_
-- links-specific copy of that check into THIS SQL function would do exactly
-- what that file exists to prevent: fork the one shared rule into an eighth
-- place, this one written in SQL where the other seven can't see it if it's
-- ever changed. rpc_lookup_report_share_link_by_token below therefore does
-- ONLY the exact-token-equality lookup and returns the FULL row, unfiltered
-- by expiry/revocation -- isShareLinkUsable(row, new Date()) keeps running
-- in application code exactly as it does today, completely unchanged by
-- this migration. A pattern that almost fits is more dangerous than one
-- that plainly does not; this is the place it almost fit.
--
-- Every function: SECURITY DEFINER, owned by postgres (rolbypassrls=true,
-- confirmed live), pinned search_path matching lookup_user_by_email/
-- lookup_api_key_by_hash's own convention exactly ('compliance', 'pg_temp'
-- -- these are siblings, not platform.* functions, so no platform/compliance
-- multi-schema path is needed). REVOKE ALL FROM PUBLIC first, GRANT EXECUTE
-- TO app_runtime only. No free-form parameters beyond what each real call
-- site already passes today.
--
-- WIDENING, STATED AS A WIDENING, before and after counts (query: SELECT
-- count(*) FROM pg_proc p JOIN pg_namespace n ON n.oid=p.pronamespace WHERE
-- p.prosecdef=true AND EXISTS (SELECT 1 FROM unnest(p.proacl) acl WHERE
-- acl::text LIKE 'app_runtime=%') -- run live before and after applying,
-- reported to PM as two integers, not inferred from this file's own count):
-- this adds 7 new compliance-schema SECURITY DEFINER functions with an
-- explicit app_runtime EXECUTE grant, on top of the 5 that already exist
-- (lookup_user_by_email, lookup_api_key_by_hash, conversation_org_id,
-- is_conversation_participant, gap_log_orgs_with_recent_activity --
-- confirmed live via pg_proc.proacl before writing this file, corrected
-- from an earlier undercount of 2 that missed the 3 non-preauth-lookup
-- ones already in this schema). 5 -> 12. Not applied yet -- dry-run
-- evidence and the live before/after count go to PM before this file is
-- ever run for real, per standing instruction.
--
-- Not touched, on purpose: zero ALTER on any RLS policy on any of the four
-- tables (users, api_keys, api_key_request_log, report_share_links). Zero
-- REVOKE. This migration cannot deny a call that succeeds today.
--
-- *** APPLIED LIVE 2026-09-10 via the Supabase MCP, ahead of this file
-- merging (PM ruling, same pattern as 0584/0585 earlier today) *** -- do
-- not be confused if these objects already exist when this PR is reviewed;
-- that is expected, not drift. AFTER-apply widening confirmed live via
-- pg_proc.proacl: 5 -> 12 compliance-schema SECURITY DEFINER functions
-- with an explicit app_runtime EXECUTE grant, exact count, not estimated.
--
-- NAMED RESIDUAL, per PM instruction, not to be silently absorbed into this
-- comment and forgotten: compliance.lookup_user_by_id(p_id) above returns
-- SETOF compliance.users for ANY id, cross-org, SECURITY DEFINER -- correct
-- and necessary today (the caller passes the full row to logActivity(),
-- whose signature requires typeof users.$inferSelect, and narrowing this
-- function means changing that signature, which is CONTRACT-adjacent work,
-- not EXPAND). This is a real reduction from today's status quo (a full
-- SELECT * FROM compliance.users returning every tenant's rows, via the
-- postgres-role bypass) down to "one row at a time, by exact id, through a
-- named function" -- but it is NOT eliminated by this migration or by the
-- eventual CONTRACT phase closing the blanket policies. Tracked as its own
-- follow-up ticket: narrow lookup_user_by_id by changing logActivity's
-- dbUser parameter shape first, then narrow this function's return type to
-- match. Carry this forward explicitly -- CRR-027/028 should never be
-- reported as fully closed while this function's full-row cross-org shape
-- is still live, even after CONTRACT lands.

-- ============================================================
-- 1. compliance.user_exists -- prompt-governance-service.ts:193
-- Site only does `if (!owner) throw` -- an existence check, nothing else.
-- Narrowest possible surface: no row data returned at all.
-- ============================================================
CREATE OR REPLACE FUNCTION compliance.user_exists(p_id text)
RETURNS boolean
LANGUAGE sql
STABLE SECURITY DEFINER
SET search_path TO 'compliance', 'pg_temp'
AS $$
  SELECT EXISTS (SELECT 1 FROM compliance.users WHERE id = p_id);
$$;

ALTER FUNCTION compliance.user_exists(text) OWNER TO postgres;
REVOKE ALL ON FUNCTION compliance.user_exists(text) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION compliance.user_exists(text) TO app_runtime;

-- ============================================================
-- 2. compliance.lookup_user_by_id_in_org -- support-session-service.ts:96
-- Site's own where clause is `eq(users.id, targetUserId) AND
-- eq(users.orgId, targetOrgId)` -- both are real filters in the caller's
-- code today (already deliberately, explicitly cross-org by design per that
-- file's own header -- a support agent's own row lives in a different org
-- than the target). Caller only reads `.name` off the result (l.110, l.129)
-- -- narrow return shape, not the full row.
-- ============================================================
CREATE OR REPLACE FUNCTION compliance.lookup_user_by_id_in_org(p_id text, p_org_id text)
RETURNS TABLE(id text, name text)
LANGUAGE sql
STABLE SECURITY DEFINER
SET search_path TO 'compliance', 'pg_temp'
AS $$
  SELECT u.id, u.name FROM compliance.users u WHERE u.id = p_id AND u.org_id = p_org_id;
$$;

ALTER FUNCTION compliance.lookup_user_by_id_in_org(text, text) OWNER TO postgres;
REVOKE ALL ON FUNCTION compliance.lookup_user_by_id_in_org(text, text) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION compliance.lookup_user_by_id_in_org(text, text) TO app_runtime;

-- ============================================================
-- 3. compliance.lookup_oldest_active_admin_by_role --
-- dispatch-completion-monitor/run/route.ts:66
-- Site's own where clause: eq(users.orgId, org.id) AND eq(users.role,
-- 'veridian_admin') AND eq(users.isActive, true), orderBy asc(createdAt),
-- findFirst (implicit LIMIT 1) -- confirmed by reading the route file
-- directly, not the audit's paraphrase. Genuinely cross-org by construction:
-- a cron has no per-request org context, so it loops every org and needs
-- each one's own longest-tenured active admin to attribute the sweep to.
-- Caller needs the FULL row (passed as runDispatchCompletionSweep's
-- `dbUser: typeof users.$inferSelect`), same mapper convention as
-- lookup_user_by_email. p_role IS a real parameter (the audit's own
-- suggested signature), but constrained to the one value any real caller
-- ever passes -- this function runs SECURITY DEFINER, bypassing RLS, so an
-- attacker holding app_runtime credentials directly could otherwise use an
-- unconstrained role parameter to identify ANY role's longest-tenured
-- active user in ANY org, which is a materially wider disclosure than what
-- this route actually needs.
-- ============================================================
CREATE OR REPLACE FUNCTION compliance.lookup_oldest_active_admin_by_role(p_org_id text, p_role text)
RETURNS SETOF compliance.users
LANGUAGE plpgsql
STABLE SECURITY DEFINER
SET search_path TO 'compliance', 'pg_temp'
AS $$
BEGIN
  IF p_role NOT IN ('veridian_admin') THEN
    RAISE EXCEPTION 'lookup_oldest_active_admin_by_role: unsupported role %', p_role;
  END IF;

  RETURN QUERY
  SELECT * FROM compliance.users
  WHERE org_id = p_org_id AND role = p_role::compliance.user_role AND is_active = true
  ORDER BY created_at ASC
  LIMIT 1;
END;
$$;

ALTER FUNCTION compliance.lookup_oldest_active_admin_by_role(text, text) OWNER TO postgres;
REVOKE ALL ON FUNCTION compliance.lookup_oldest_active_admin_by_role(text, text) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION compliance.lookup_oldest_active_admin_by_role(text, text) TO app_runtime;

-- ============================================================
-- 4. compliance.lookup_user_by_id -- whoami-target/route.ts:31
-- Site's own where clause: eq(users.id, session.initiatedByUserId). Already
-- explicitly, deliberately cross-org by design (this file's own inline
-- comment: "fetched via the raw (RLS-bypassing) client because the agent's
-- own user row lives in a DIFFERENT org"), same accepted-design class as
-- support-session-service.ts above. Caller needs the FULL row (passed
-- straight to logActivity({dbUser: initiator, ...}), which requires
-- `typeof users.$inferSelect` per audit.ts:57) -- no narrower shape is
-- possible without changing logActivity's own signature, which is out of
-- scope for an EXPAND-only migration.
-- ============================================================
CREATE OR REPLACE FUNCTION compliance.lookup_user_by_id(p_id text)
RETURNS SETOF compliance.users
LANGUAGE sql
STABLE SECURITY DEFINER
SET search_path TO 'compliance', 'pg_temp'
AS $$
  SELECT * FROM compliance.users WHERE id = p_id;
$$;

ALTER FUNCTION compliance.lookup_user_by_id(text) OWNER TO postgres;
REVOKE ALL ON FUNCTION compliance.lookup_user_by_id(text) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION compliance.lookup_user_by_id(text) TO app_runtime;

-- ============================================================
-- 5. compliance.count_recent_api_key_requests -- api-key-auth.ts:166-168
-- (audit's READ-side NEW_FN site). Site's own where clause:
-- eq(apiKeyRequestLog.apiKeyId, row.id) AND gte(createdAt, cutoff) --
-- genuinely pre-auth (runs inside validateApiKey(), before any org context
-- exists, keyed by the already-resolved apiKeyId, not org). Caller only
-- ever consumes count(*) -- no row columns, narrowest possible return
-- shape for this table.
-- ============================================================
CREATE OR REPLACE FUNCTION compliance.count_recent_api_key_requests(p_api_key_id text, p_since timestamptz)
RETURNS bigint
LANGUAGE sql
STABLE SECURITY DEFINER
SET search_path TO 'compliance', 'pg_temp'
AS $$
  SELECT count(*) FROM compliance.api_key_request_log
  WHERE api_key_id = p_api_key_id AND created_at >= p_since;
$$;

ALTER FUNCTION compliance.count_recent_api_key_requests(text, timestamptz) OWNER TO postgres;
REVOKE ALL ON FUNCTION compliance.count_recent_api_key_requests(text, timestamptz) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION compliance.count_recent_api_key_requests(text, timestamptz) TO app_runtime;

-- ============================================================
-- 6. compliance.record_api_key_request_batch -- src/lib/auth/api-key-
-- audit.ts's insertRequestLog (NOT in the audit's 6, added on PM's direct
-- instruction: this table's real pre-auth need is a WRITE, not a read).
-- THE SHAPE DIFFERS FROM EVERY OTHER FUNCTION IN THIS FILE ON PURPOSE, AND
-- THE NEXT PERSON SHOULD NOT ASSUME IT MIRRORS THE READ-SHAPED ONES ABOVE:
-- it is an INSERT, not a SELECT, and it accepts a BATCH (jsonb array), not
-- a single row, because src/lib/auth/api-key-audit.ts buffers requests from
-- potentially MANY different API keys -- spanning MANY different orgs --
-- into one multi-row INSERT per flush interval (R67 F-17, see that file's
-- own header). A per-row org context (withTenantContext/app_runtime RLS)
-- is structurally incompatible with this batching design: a single
-- transaction can only SET ONE org_id GUC value, but one flush's batch can
-- legitimately span many orgs' keys at once. A SECURITY DEFINER function
-- that inserts the whole batch atomically, bypassing per-row RLS entirely
-- inside its own body, is the only way to keep the batched-multi-org write
-- pattern while giving it a narrow, auditable surface instead of the
-- current bare `db.insert(apiKeyRequestLog).values(...)` over the
-- unrestricted bypass-role client. Column shape matches insertRequestLog's
-- existing values() mapping exactly (apiKeyId/orgId/route/method/
-- wasRateLimited/createdAt -- createdAt is the request's own time, passed
-- through verbatim, NEVER defaulted, per that file's own explicit
-- created-at-is-not-flush-time rule). No existence/validity check on
-- api_key_id here -- the caller (recordApiKeyUse) is only ever invoked
-- with a key that JUST passed lookup_api_key_by_hash in the same request,
-- so re-validating it here would be redundant, not defensive; this
-- function's job is the insert, not re-proving the key is real.
-- ============================================================
CREATE OR REPLACE FUNCTION compliance.record_api_key_request_batch(p_rows jsonb)
RETURNS void
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path TO 'compliance', 'pg_temp'
AS $$
BEGIN
  IF jsonb_typeof(p_rows) IS DISTINCT FROM 'array' THEN
    RAISE EXCEPTION 'record_api_key_request_batch: p_rows must be a jsonb array';
  END IF;

  INSERT INTO compliance.api_key_request_log (api_key_id, org_id, route, method, was_rate_limited, created_at)
  SELECT
    r ->> 'apiKeyId',
    r ->> 'orgId',
    r ->> 'route',
    r ->> 'method',
    (r ->> 'wasRateLimited')::boolean,
    (r ->> 'createdAt')::timestamptz
  FROM jsonb_array_elements(p_rows) AS r;
END;
$$;

ALTER FUNCTION compliance.record_api_key_request_batch(jsonb) OWNER TO postgres;
REVOKE ALL ON FUNCTION compliance.record_api_key_request_batch(jsonb) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION compliance.record_api_key_request_batch(jsonb) TO app_runtime;

-- ============================================================
-- 7. compliance.lookup_report_share_link_by_token -- report-share-
-- service.ts:120 (audit's report_share_links NEW_FN site). Site's own
-- where clause: eq(reportShareLinks.token, token) -- exact equality only,
-- matching this table's own UNIQUE(token) constraint (confirmed live
-- before writing this file: report_share_links_token_key). Structurally
-- the direct analogue of rpc_resolve_ai_link_token (0584, today) -- EXCEPT
-- for the usability-check difference stated at length in this file's own
-- header above: this function does NOT filter on expiry/revocation, it
-- returns the row exactly as a plain findFirst-by-token would, and
-- isShareLinkUsable() keeps deciding usability in application code,
-- unchanged. Returns the full row: caller reads .reportType, .reportRef,
-- .orgId, .expiresAt, .revokedAt (all confirmed via reading
-- resolveReportShareLink directly, lines 119-129).
-- ============================================================
CREATE OR REPLACE FUNCTION compliance.lookup_report_share_link_by_token(p_token text)
RETURNS SETOF compliance.report_share_links
LANGUAGE sql
STABLE SECURITY DEFINER
SET search_path TO 'compliance', 'pg_temp'
AS $$
  SELECT * FROM compliance.report_share_links WHERE token = p_token;
$$;

ALTER FUNCTION compliance.lookup_report_share_link_by_token(text) OWNER TO postgres;
REVOKE ALL ON FUNCTION compliance.lookup_report_share_link_by_token(text) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION compliance.lookup_report_share_link_by_token(text) TO app_runtime;
