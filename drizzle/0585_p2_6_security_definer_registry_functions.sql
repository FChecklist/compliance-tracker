-- PM-T23 (W-ENV, 2026-09-10). Fixes the transport regression from ct
-- commits bfb1fcb8/9b7a596b: capability-audit-service.ts and
-- capability-learning-service.ts moved their platform-wide (org_id IS
-- NULL) writes to platform.task_capabilities, and all writes to
-- platform.capability_improvement_proposals, onto a supabase-js client
-- scoped to db:{schema:"platform"} -- PostgREST does not expose the
-- platform schema (current_setting('pgrst.db_schemas', true) reads NULL
-- on this project, confirming the Supabase default of public-only), so
-- every one of those calls throws "Invalid schema: platform" before RLS
-- is ever evaluated. Both tables' RLS itself is correct (0577/0578) --
-- the problem is purely transport.
--
-- THE FIX. Nine SECURITY DEFINER functions, owned by postgres (which has
-- rolbypassrls=true, confirmed live), called from application code over
-- the EXISTING drizzle `db` connection (src/lib/db/index.ts, direct
-- Postgres, app_runtime role) -- the same connection
-- src/lib/services/graph-impact-service.ts already uses to call
-- platform.graph_impact(). This requires zero new credential, zero new
-- client, zero PostgREST configuration change. Full design history,
-- three independent Opus adversarial reviews (attacker-holding-
-- app_runtime, cross-org-row-access, and a general design review), and
-- every named defect these functions fix is recorded in
-- pm/PM_T23_OPTION_II_SECURITY_DEFINER_DESIGN_2026-09-10.md (v4) in the
-- audit working folder -- read that file for the full reasoning; this
-- comment states only what a future reader needs to trust the SQL below.
--
-- SEARCH_PATH: matches the majority house style of the 8 pre-existing
-- platform.* SECURITY DEFINER functions (platform, compliance,
-- pg_catalog, pg_temp), verified live against all 8 before writing this
-- file, not assumed. pg_temp last, so nothing here can be hijacked by an
-- attacker-created same-named object earlier in an unpinned search path.
--
-- WHY app_runtime GETS EXECUTE ON THESE AT ALL: 0577/0578 correctly deny
-- app_runtime write access to these platform-wide rows. Every function
-- below hands back a narrow slice of that write power -- ONLY the exact
-- shape the two real TypeScript services already need, nothing free-form.
-- Once RLS is bypassed inside a SECURITY DEFINER body, the function's own
-- signature is the ONLY remaining access-control boundary: no caller-
-- supplied column name, no free-form JSONB patch, no caller-supplied
-- version/timestamp that could manipulate the audit gate. This widens
-- app_runtime's SECURITY DEFINER EXECUTE grants on platform.* from 1
-- (platform.graph_full_resync, the only pre-existing grant) to 10. That
-- is a real widening of the app_runtime privilege surface, not a routine
-- extension of precedent -- stated here in those terms per the owner
-- ruling on this design (PM, 2026-09-10).
--
-- ATTACKER-HELD-APP_RUNTIME THREAT MODEL, the one that actually governs
-- this file: anyone who holds valid app_runtime Postgres credentials can
-- call SELECT platform.rpc_*(...) directly, over the same direct-Postgres
-- transport the app itself uses. HTTP-layer gates (CRON_SECRET,
-- requireAuth, role checks) are NEVER in that caller's path -- they are
-- enforced by application code the attacker never has to invoke. Every
-- guard in this file is written to that standard, not to "a legitimate
-- caller would never construct this call."
--
-- NOT DONE HERE: no change to service-role-client.ts or the two calling
-- services (capability-audit-service.ts, capability-learning-service.ts)
-- -- those are a separate commit in this same PR, repointing their calls
-- from the broken service-role client onto these functions.
-- Idempotent: CREATE OR REPLACE FUNCTION is naturally idempotent; each
-- REVOKE/GRANT pair is unconditional and safe to re-run.

-- ── 1. platform.rpc_task_capability_mark_audited ───────────────────────
-- Site: capability-audit-service.ts's runCapabilityAudit(), ~line 531.
-- Only ever passes 'yes' or 'no' (never 'in_progress' -- that value is
-- reachable ONLY via function 8 below, as a side effect of a real
-- dispatch, never standalone). last_audited_version is read from the
-- row's own `version` in-SQL, never a caller-supplied integer -- v2/v3 of
-- the design left this parameter caller-controlled on THIS function
-- while fixing the identical bug on function 2 below; an attacker-framed
-- review caught the inconsistency (an app_runtime holder could set
-- last_audited_version equal to a capability's real version to mark it
-- falsely "audited, clean" forever, or unequal to force unbounded repeat
-- Auditor LLM spend). Fixed here.
CREATE OR REPLACE FUNCTION platform.rpc_task_capability_mark_audited(p_id text, p_needs_improvement text)
RETURNS void
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = platform, compliance, pg_catalog, pg_temp
AS $$
DECLARE
  v_rows integer;
BEGIN
  IF p_needs_improvement NOT IN ('no', 'yes') THEN
    RAISE EXCEPTION 'rpc_task_capability_mark_audited: invalid needs_improvement %', p_needs_improvement;
  END IF;

  UPDATE platform.task_capabilities
  SET needs_improvement = p_needs_improvement,
      last_audited_at = now(),
      last_audited_version = version,
      updated_at = now()
  WHERE id = p_id AND org_id IS NULL;

  GET DIAGNOSTICS v_rows = ROW_COUNT;
  IF v_rows = 0 THEN
    RAISE EXCEPTION 'rpc_task_capability_mark_audited: no matching platform-wide row for id %', p_id;
  END IF;
END;
$$;

ALTER FUNCTION platform.rpc_task_capability_mark_audited(text, text) OWNER TO postgres;
REVOKE ALL ON FUNCTION platform.rpc_task_capability_mark_audited(text, text) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION platform.rpc_task_capability_mark_audited(text, text) TO app_runtime;

-- ── 2. platform.rpc_task_capability_close_improvement_loop ─────────────
-- Site: capability-audit-service.ts's closeImprovementLoop(), ~line
-- 743-760, which today issues TWO separate service-role calls via
-- Promise.all (one per table) -- a real atomicity gap: a crash between
-- them could bump a capability's version without resolving its proposal,
-- or vice versa, corrupting shouldAuditCapability's gate
-- (lastAuditedVersion !== version). This function does both updates in
-- one body/one implicit transaction. No caller-supplied version integer
-- -- version increments in-SQL only, same reasoning as function 1 above.
-- capability_id is read from the proposal row itself (a real FK), never
-- caller-supplied, so there is no way to point this at an unrelated
-- capability.
CREATE OR REPLACE FUNCTION platform.rpc_task_capability_close_improvement_loop(p_proposal_id text, p_pr_url text)
RETURNS void
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = platform, compliance, pg_catalog, pg_temp
AS $$
DECLARE
  v_rows integer;
  v_capability_id text;
BEGIN
  UPDATE platform.capability_improvement_proposals
  SET status = 'resolved',
      pr_url = p_pr_url,
      updated_at = now()
  WHERE id = p_proposal_id
  RETURNING capability_id INTO v_capability_id;

  GET DIAGNOSTICS v_rows = ROW_COUNT;
  IF v_rows = 0 THEN
    RAISE EXCEPTION 'rpc_task_capability_close_improvement_loop: no matching proposal for id %', p_proposal_id;
  END IF;

  UPDATE platform.task_capabilities
  SET version = version + 1,
      needs_improvement = 'no',
      updated_at = now()
  WHERE id = v_capability_id AND org_id IS NULL;

  GET DIAGNOSTICS v_rows = ROW_COUNT;
  IF v_rows = 0 THEN
    RAISE EXCEPTION 'rpc_task_capability_close_improvement_loop: no matching platform-wide capability for id %', v_capability_id;
  END IF;
END;
$$;

ALTER FUNCTION platform.rpc_task_capability_close_improvement_loop(text, text) OWNER TO postgres;
REVOKE ALL ON FUNCTION platform.rpc_task_capability_close_improvement_loop(text, text) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION platform.rpc_task_capability_close_improvement_loop(text, text) TO app_runtime;

-- ── 3. platform.rpc_task_capability_extend_word_index ──────────────────
-- Site: capability-learning-service.ts's extendPromptWordIndex(), ~line
-- 205-211, reachable from ordinary end-user task execution (via
-- findOrCreateCapability, called from task-execution-engine.ts,
-- dialogue-script-executor.ts, team-service.ts, and the prompt-compiler
-- route). Append-only merge, computed in-SQL (a full-replacement array
-- from TS would be a free-form JSONB patch on a shared, cross-tenant-read
-- column -- exactly what this design's own invariant forbids). Rejects a
-- non-array input, rejects a bare JSON null element (jsonb_array_elements_text
-- coerces every other JSON scalar type to safe text, but a literal null
-- survives as-is and was found live by an attacker-framed review), and
-- coalesces the existing column to '[]' first -- the original naive
-- `col || p_new_words` expression evaluates to SQL NULL and WIPES the
-- column if it was ever NULL (verified live: NULL || anything = NULL in
-- Postgres), a real data-loss bug that review also found. Capped at 500
-- distinct words: this column carries a live GIN index
-- (idx_task_capabilities_prompt_word_index) read by
-- findCapabilityByPromptOverlap for AI-routing overlap scoring, and
-- app_runtime has no statement_timeout (confirmed live, unlike
-- anon/authenticated) -- nothing else bounds the cost of an unbounded
-- array feeding that index and that scoring loop. The cap keeps the
-- alphabetically-first 500 distinct tokens once the column is at
-- capacity; the traded-off cost of this simple policy (a very prolific
-- capability could stop absorbing brand-new distinct tokens once full)
-- is accepted over building recency tracking for a defensive DoS bound.
CREATE OR REPLACE FUNCTION platform.rpc_task_capability_extend_word_index(p_id text, p_new_words jsonb)
RETURNS void
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = platform, compliance, pg_catalog, pg_temp
AS $$
DECLARE
  v_rows integer;
BEGIN
  IF jsonb_typeof(p_new_words) IS DISTINCT FROM 'array' THEN
    RAISE EXCEPTION 'rpc_task_capability_extend_word_index: p_new_words must be a jsonb array';
  END IF;

  IF EXISTS (SELECT 1 FROM jsonb_array_elements(p_new_words) e WHERE e = 'null'::jsonb) THEN
    RAISE EXCEPTION 'rpc_task_capability_extend_word_index: p_new_words must not contain a null element';
  END IF;

  UPDATE platform.task_capabilities
  SET prompt_word_index = (
        SELECT coalesce(jsonb_agg(capped.w ORDER BY capped.w), '[]'::jsonb)
        FROM (
          SELECT DISTINCT w
          FROM jsonb_array_elements_text(coalesce(prompt_word_index, '[]'::jsonb) || p_new_words) AS w
          ORDER BY w
          LIMIT 500
        ) AS capped(w)
      ),
      updated_at = now()
  WHERE id = p_id AND org_id IS NULL;

  GET DIAGNOSTICS v_rows = ROW_COUNT;
  IF v_rows = 0 THEN
    RAISE EXCEPTION 'rpc_task_capability_extend_word_index: no matching platform-wide row for id %', p_id;
  END IF;
END;
$$;

ALTER FUNCTION platform.rpc_task_capability_extend_word_index(text, jsonb) OWNER TO postgres;
REVOKE ALL ON FUNCTION platform.rpc_task_capability_extend_word_index(text, jsonb) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION platform.rpc_task_capability_extend_word_index(text, jsonb) TO app_runtime;

-- ── 4. platform.rpc_task_capability_record_execution_outcome ───────────
-- Site: capability-learning-service.ts's recordExecutionOutcome(), ~line
-- 314-330. Takes only p_bucket, computes the three category deltas AND
-- occurrence_count AND the derived status atomically in-SQL -- v1/v2/v3
-- of this design took pre-computed absolute counters from TS, which does
-- NOT restore the atomicity that file's own comments (lines 300-313)
-- document as lost when the original db.transaction() was removed; it
-- only relocates the race. A SECURITY DEFINER function is exactly where
-- that atomicity can be restored, and PM ruled this in-scope, not scope
-- creep. p_bucket is validated with an explicit RAISE on any value
-- outside the three real ones -- the naive (p_bucket = 'X')::int
-- expression silently evaluates to 0 for all three categories on a typo
-- or attacker-supplied garbage string while STILL incrementing
-- occurrence_count, corrupting it relative to the category counters it's
-- supposed to track; an attacker-framed review demonstrated this live.
-- The status derivation below is an EXACT port of
-- capability-learning-service.ts's deriveCapabilityStatus()
-- (lines 144-149, thresholds MIN_OBSERVATIONS_FOR_STATUS=5,
-- FULL_SOFTWARE_THRESHOLD_PERCENT=80, AI_ONLY_THRESHOLD_PERCENT=60,
-- re-read from source at the time this file was written, not
-- re-derived from memory) -- Postgres's round(numeric) rounds half away
-- from zero for a positive value, matching JS Math.round exactly for
-- every value this computation can produce (percentages are always
-- non-negative).
CREATE OR REPLACE FUNCTION platform.rpc_task_capability_record_execution_outcome(p_id text, p_bucket text)
RETURNS void
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = platform, compliance, pg_catalog, pg_temp
AS $$
DECLARE
  v_rows integer;
  v_full integer;
  v_package integer;
  v_novel integer;
  v_total integer;
  v_status text;
BEGIN
  IF p_bucket NOT IN ('FULL_SOFTWARE', 'PACKAGE_AVAILABLE', 'NOVEL') THEN
    RAISE EXCEPTION 'rpc_task_capability_record_execution_outcome: invalid bucket %', p_bucket;
  END IF;

  UPDATE platform.task_capabilities
  SET full_software_count = full_software_count + (p_bucket = 'FULL_SOFTWARE')::int,
      package_available_count = package_available_count + (p_bucket = 'PACKAGE_AVAILABLE')::int,
      novel_count = novel_count + (p_bucket = 'NOVEL')::int,
      occurrence_count = occurrence_count + 1,
      updated_at = now()
  WHERE id = p_id AND org_id IS NULL
  RETURNING full_software_count, package_available_count, novel_count
    INTO v_full, v_package, v_novel;

  GET DIAGNOSTICS v_rows = ROW_COUNT;
  IF v_rows = 0 THEN
    RAISE EXCEPTION 'rpc_task_capability_record_execution_outcome: no matching platform-wide row for id %', p_id;
  END IF;

  v_total := v_full + v_package + v_novel;
  IF v_total < 5 THEN
    v_status := 'ai_only';
  ELSIF round((v_full::numeric / v_total) * 100) >= 80 THEN
    v_status := 'full_software';
  ELSIF round((v_novel::numeric / v_total) * 100) >= 60 THEN
    v_status := 'ai_only';
  ELSE
    v_status := 'partial';
  END IF;

  UPDATE platform.task_capabilities SET status = v_status WHERE id = p_id;
END;
$$;

ALTER FUNCTION platform.rpc_task_capability_record_execution_outcome(text, text) OWNER TO postgres;
REVOKE ALL ON FUNCTION platform.rpc_task_capability_record_execution_outcome(text, text) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION platform.rpc_task_capability_record_execution_outcome(text, text) TO app_runtime;

-- ── 5. platform.rpc_task_capability_insert_if_absent ───────────────────
-- Site: capability-learning-service.ts's findOrCreateCapability() insert
-- branch, ~line 177-186. p_org_id IS a real parameter, passed through
-- unmodified -- an earlier draft of this design hardcoded org_id=NULL
-- here on the strength of two source-code comments claiming "no live
-- caller inserts an org-scoped row," which a cross-org-focused review
-- proved false: POST /api/prompt-compiler/execute (gated only at
-- requireRole(dbUser,'member'), the lowest real authenticated bar) passes
-- a caller's REAL orgId into exactly this insert path. Hardcoding NULL
-- would have silently converted every one of those org-scoped inserts
-- into a platform-wide row, promoting one tenant's raw prompt text into
-- the shared registry every other tenant's AI reasoning reads --
-- verbatim the threat drizzle/0577 exists to prevent, reopened on the
-- create half. Passing p_org_id through verbatim is not a re-opening:
-- this INSERT was never actually gated by org_id=current_org_id() in a
-- way that could work on this connection anyway (current_org_id() reads
-- NULL here, confirmed live -- capability-learning-service.ts never
-- calls withTenantContext), so this restores exactly today's real
-- behaviour (today's insert already goes through the RLS-bypassing
-- service-role client and already persists the real org_id).
CREATE OR REPLACE FUNCTION platform.rpc_task_capability_insert_if_absent(
  p_capability_key text, p_mode_pill text, p_path_keys jsonb, p_prompt_word_index jsonb, p_org_id text
)
RETURNS void
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = platform, compliance, pg_catalog, pg_temp
AS $$
BEGIN
  INSERT INTO platform.task_capabilities (capability_key, mode_pill, path_keys, prompt_word_index, org_id)
  VALUES (p_capability_key, p_mode_pill, p_path_keys, p_prompt_word_index, p_org_id)
  ON CONFLICT (capability_key) DO NOTHING;
END;
$$;

ALTER FUNCTION platform.rpc_task_capability_insert_if_absent(text, text, jsonb, jsonb, text) OWNER TO postgres;
REVOKE ALL ON FUNCTION platform.rpc_task_capability_insert_if_absent(text, text, jsonb, jsonb, text) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION platform.rpc_task_capability_insert_if_absent(text, text, jsonb, jsonb, text) TO app_runtime;

-- ── 6. platform.rpc_improvement_proposal_upsert_new_finding ────────────
-- Site: capability-audit-service.ts's upsertImprovementProposal(), ~line
-- 596-605. ON CONFLICT DO NOTHING -- capability-audit-service.ts:579-588
-- is explicit that findings/existingAssetMatch must NEVER be overwritten
-- on a repeat finding (function 7 below handles the repeat-occurrence
-- case separately). p_findings' keys are validated against the exact
-- FINDING_KEYS constant (capability-audit-service.ts, re-read at the
-- time this file was written) -- an attacker-framed review found that a
-- free-form findings payload renders verbatim in the veridian_admin
-- review UI and, if dispatched, flows into the Higher-AI role prompt
-- (buildTightTaskFromFindings), a prompt-injection surface into a real
-- LLM dispatch. p_existing_asset_match, if non-null, is verified to
-- resolve to a REAL, matching compliance.platform_assets row (by
-- assetId+sourceTable+sourceId together, not just shape) before being
-- accepted -- the same review found that a forged existing_asset_match is
-- read later by closeImprovementLoop -> registerClosedCapabilityAsUmrAsset
-- -> updateAsset(), an INDIRECT WRITE PATH to a third table entirely
-- outside this design's two-table scope; resolving it here closes that
-- path at its origin instead of trusting it downstream.
CREATE OR REPLACE FUNCTION platform.rpc_improvement_proposal_upsert_new_finding(
  p_capability_id text, p_capability_version integer, p_findings jsonb, p_existing_asset_match jsonb
)
RETURNS void
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = platform, compliance, pg_catalog, pg_temp
AS $$
DECLARE
  v_key text;
BEGIN
  IF jsonb_typeof(p_findings) IS DISTINCT FROM 'object' THEN
    RAISE EXCEPTION 'rpc_improvement_proposal_upsert_new_finding: p_findings must be a jsonb object';
  END IF;

  FOR v_key IN SELECT jsonb_object_keys(p_findings) LOOP
    IF v_key NOT IN (
      'missingApi', 'missingBusinessRule', 'missingFunction', 'missingWorkflow', 'missingValidation',
      'missingReport', 'missingConfiguration', 'missingMetadata', 'missingModePill', 'missingChainOption', 'missingScreen'
    ) THEN
      RAISE EXCEPTION 'rpc_improvement_proposal_upsert_new_finding: unrecognized findings key %', v_key;
    END IF;
  END LOOP;

  IF p_existing_asset_match IS NOT NULL THEN
    IF NOT EXISTS (
      SELECT 1 FROM compliance.platform_assets
      WHERE asset_id = p_existing_asset_match ->> 'assetId'
        AND source_table = p_existing_asset_match ->> 'sourceTable'
        AND source_id = p_existing_asset_match ->> 'sourceId'
    ) THEN
      RAISE EXCEPTION 'rpc_improvement_proposal_upsert_new_finding: existing_asset_match does not resolve to a real platform_assets row';
    END IF;
  END IF;

  INSERT INTO platform.capability_improvement_proposals
    (capability_id, capability_version, findings, existing_asset_match, occurrence_count)
  VALUES (p_capability_id, p_capability_version, p_findings, p_existing_asset_match, 1)
  ON CONFLICT (capability_id, capability_version) DO NOTHING;
END;
$$;

ALTER FUNCTION platform.rpc_improvement_proposal_upsert_new_finding(text, integer, jsonb, jsonb) OWNER TO postgres;
REVOKE ALL ON FUNCTION platform.rpc_improvement_proposal_upsert_new_finding(text, integer, jsonb, jsonb) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION platform.rpc_improvement_proposal_upsert_new_finding(text, integer, jsonb, jsonb) TO app_runtime;

-- ── 7. platform.rpc_improvement_proposal_increment_occurrence ──────────
-- Site: capability-audit-service.ts's upsertImprovementProposal() repeat-
-- finding branch, ~line 591-594. In-SQL increment (atomic), same
-- reasoning as function 4.
CREATE OR REPLACE FUNCTION platform.rpc_improvement_proposal_increment_occurrence(p_id text)
RETURNS void
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = platform, compliance, pg_catalog, pg_temp
AS $$
DECLARE
  v_rows integer;
BEGIN
  UPDATE platform.capability_improvement_proposals
  SET occurrence_count = occurrence_count + 1, updated_at = now()
  WHERE id = p_id;

  GET DIAGNOSTICS v_rows = ROW_COUNT;
  IF v_rows = 0 THEN
    RAISE EXCEPTION 'rpc_improvement_proposal_increment_occurrence: no matching proposal for id %', p_id;
  END IF;
END;
$$;

ALTER FUNCTION platform.rpc_improvement_proposal_increment_occurrence(text) OWNER TO postgres;
REVOKE ALL ON FUNCTION platform.rpc_improvement_proposal_increment_occurrence(text) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION platform.rpc_improvement_proposal_increment_occurrence(text) TO app_runtime;

-- ── 8. platform.rpc_improvement_proposal_mark_dispatched_and_capability_in_progress
-- Site: capability-audit-service.ts's dispatchProposalToHigherAI(), ~line
-- 662-669, which today issues TWO separate service-role calls via
-- Promise.all -- merged here for the same atomicity reason as function 2.
-- SECURITY-CRITICAL BY CONSTRUCTION: v2/v3 of this design had a
-- standalone rpc_task_capability_set_needs_improvement function that
-- accepted 'in_progress' directly from ANY caller, with no requirement
-- that a real dispatch was happening -- an attacker-framed review showed
-- this lets anyone holding app_runtime permanently freeze any capability
-- out of the audit sweep (shouldAuditCapability/findCapabilitiesDueForAudit
-- both exclude needs_improvement='in_progress', and nothing resets it
-- without an existing open->dispatched proposal + veridian_admin to close
-- or reject it). This function removes that standalone path entirely:
-- 'in_progress' is now reachable ONLY as a side effect of legitimately
-- dispatching a real, existing, currently-'open' proposal. status='open'
-- precondition matches capability-audit-service.ts:629-631's own existing
-- check exactly. capability_id is read from the proposal row, never
-- caller-supplied.
CREATE OR REPLACE FUNCTION platform.rpc_improvement_proposal_mark_dispatched_and_capability_in_progress(
  p_proposal_id text, p_role text, p_dispatch_output text
)
RETURNS void
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = platform, compliance, pg_catalog, pg_temp
AS $$
DECLARE
  v_rows integer;
  v_capability_id text;
BEGIN
  UPDATE platform.capability_improvement_proposals
  SET status = 'dispatched',
      dispatched_to_role = p_role,
      dispatched_at = now(),
      dispatch_output = p_dispatch_output,
      updated_at = now()
  WHERE id = p_proposal_id AND status = 'open'
  RETURNING capability_id INTO v_capability_id;

  GET DIAGNOSTICS v_rows = ROW_COUNT;
  IF v_rows = 0 THEN
    RAISE EXCEPTION 'rpc_improvement_proposal_mark_dispatched_and_capability_in_progress: no open proposal for id %', p_proposal_id;
  END IF;

  UPDATE platform.task_capabilities
  SET needs_improvement = 'in_progress', updated_at = now()
  WHERE id = v_capability_id AND org_id IS NULL;

  GET DIAGNOSTICS v_rows = ROW_COUNT;
  IF v_rows = 0 THEN
    RAISE EXCEPTION 'rpc_improvement_proposal_mark_dispatched_and_capability_in_progress: no matching platform-wide capability for id %', v_capability_id;
  END IF;
END;
$$;

ALTER FUNCTION platform.rpc_improvement_proposal_mark_dispatched_and_capability_in_progress(text, text, text) OWNER TO postgres;
REVOKE ALL ON FUNCTION platform.rpc_improvement_proposal_mark_dispatched_and_capability_in_progress(text, text, text) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION platform.rpc_improvement_proposal_mark_dispatched_and_capability_in_progress(text, text, text) TO app_runtime;

-- ── 9. platform.rpc_improvement_proposal_reject_and_reset_capability ───
-- Site: capability-audit-service.ts's rejectImprovementProposal(), ~line
-- 714-727, which today issues TWO separate service-role calls via
-- Promise.all -- merged here for the same atomicity reason as functions 2
-- and 8. status precondition (open or dispatched) matches
-- capability-audit-service.ts:718-720's own existing 409 guard exactly.
-- capability_id is read from the proposal row, never caller-supplied.
CREATE OR REPLACE FUNCTION platform.rpc_improvement_proposal_reject_and_reset_capability(
  p_proposal_id text, p_reason text
)
RETURNS void
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = platform, compliance, pg_catalog, pg_temp
AS $$
DECLARE
  v_rows integer;
  v_capability_id text;
BEGIN
  UPDATE platform.capability_improvement_proposals
  SET status = 'rejected', rejection_reason = p_reason, updated_at = now()
  WHERE id = p_proposal_id AND status IN ('open', 'dispatched')
  RETURNING capability_id INTO v_capability_id;

  GET DIAGNOSTICS v_rows = ROW_COUNT;
  IF v_rows = 0 THEN
    RAISE EXCEPTION 'rpc_improvement_proposal_reject_and_reset_capability: no open/dispatched proposal for id %', p_proposal_id;
  END IF;

  UPDATE platform.task_capabilities
  SET needs_improvement = 'no', updated_at = now()
  WHERE id = v_capability_id AND org_id IS NULL;

  GET DIAGNOSTICS v_rows = ROW_COUNT;
  IF v_rows = 0 THEN
    RAISE EXCEPTION 'rpc_improvement_proposal_reject_and_reset_capability: no matching platform-wide capability for id %', v_capability_id;
  END IF;
END;
$$;

ALTER FUNCTION platform.rpc_improvement_proposal_reject_and_reset_capability(text, text) OWNER TO postgres;
REVOKE ALL ON FUNCTION platform.rpc_improvement_proposal_reject_and_reset_capability(text, text) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION platform.rpc_improvement_proposal_reject_and_reset_capability(text, text) TO app_runtime;
