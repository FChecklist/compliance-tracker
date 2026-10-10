-- PROJEXA-BUILD-002 WP-15 (register row AW-902; PMD-43, PMD-40, COST_BUDGET X-02): the three SQL functions that let the projexa-document-extract Edge function keep its
-- spend cap in compliance.token_usage_ledger WITHOUT holding a database client. The function calls them through the service-role REST client
-- (like ai-work-link), so the Edge function still reads no table and writes no other row: it can only sum the feature's rows, add a reservation row for
-- the feature, and settle a row of the feature.
--
-- WHAT
--   NEW  public.projexa_extract_ledger_total(p_feature text) -> numeric
--     the sum of estimated_cost_usd of every row of layer_key = p_feature, reservations included (budget.ts BudgetLedger.readRecordedTotalUsd).
--   NEW  public.projexa_extract_ledger_reserve(...) -> text
--     inserts ONE row (scope product_orchestra, layer_key = the feature, task_id = the request id, provider_cost_type METERED_API) and returns its id
--     (BudgetLedger.insertReservation). Refuses a feature other than projexa_document_extract, so this function cannot write any other spend row.
--   NEW  public.projexa_extract_ledger_settle(...) -> void
--     replaces the tokens, cost and outcome of a row of the feature (BudgetLedger.finalizeReservation). It changes only a row whose layer_key is the
--     feature, so it cannot rewrite another feature's spend.
--
-- WHO MAY CALL: service_role only (REVOKEd from PUBLIC, anon, authenticated and app_runtime). SECURITY DEFINER with a pinned search_path.
-- DATA LOSS: none; three functions are added. ROLLBACK: drop the three functions (the down file does), which makes the Edge function fail closed (a
-- ledger that cannot be read refuses every call).
BEGIN;

CREATE OR REPLACE FUNCTION public.projexa_extract_ledger_total(p_feature text)
RETURNS numeric
LANGUAGE sql STABLE SECURITY DEFINER
SET search_path = pg_catalog, pg_temp
AS $fn$
  SELECT coalesce(sum(estimated_cost_usd), 0)::numeric FROM compliance.token_usage_ledger WHERE layer_key = p_feature
$fn$;

CREATE OR REPLACE FUNCTION public.projexa_extract_ledger_reserve(
  p_org_id text, p_user_id text, p_task_id text, p_feature text, p_provider text, p_model text,
  p_prompt_tokens integer, p_completion_tokens integer, p_estimated_cost_usd numeric
)
RETURNS text
LANGUAGE plpgsql SECURITY DEFINER
SET search_path = pg_catalog, pg_temp
AS $fn$
DECLARE v_id text;
BEGIN
  IF p_feature IS DISTINCT FROM 'projexa_document_extract' THEN
    RAISE EXCEPTION 'EXTRACT_LEDGER_REFUSED: only the projexa_document_extract feature may be recorded here' USING ERRCODE = 'AW500';
  END IF;
  INSERT INTO compliance.token_usage_ledger
    (scope, org_id, user_id, layer_key, task_id, provider, model, prompt_tokens, completion_tokens, estimated_cost_usd, provider_cost_type, success, task_summary)
  VALUES
    ('product_orchestra', p_org_id, p_user_id, p_feature, p_task_id, p_provider, p_model, greatest(p_prompt_tokens, 0), greatest(p_completion_tokens, 0),
     greatest(p_estimated_cost_usd, 0), 'METERED_API', true, 'document extraction (reservation)')
  RETURNING id INTO v_id;
  RETURN v_id;
END
$fn$;

CREATE OR REPLACE FUNCTION public.projexa_extract_ledger_settle(
  p_id text, p_prompt_tokens integer, p_completion_tokens integer, p_estimated_cost_usd numeric, p_success boolean, p_failure_reason text
)
RETURNS void
LANGUAGE sql SECURITY DEFINER
SET search_path = pg_catalog, pg_temp
AS $fn$
  UPDATE compliance.token_usage_ledger
     SET prompt_tokens = greatest(p_prompt_tokens, 0), completion_tokens = greatest(p_completion_tokens, 0),
         estimated_cost_usd = greatest(p_estimated_cost_usd, 0), success = p_success, failure_reason = left(p_failure_reason, 200),
         task_summary = 'document extraction'
   WHERE id = p_id AND layer_key = 'projexa_document_extract'
$fn$;

REVOKE ALL ON FUNCTION public.projexa_extract_ledger_total(text) FROM PUBLIC, anon, authenticated, app_runtime;
REVOKE ALL ON FUNCTION public.projexa_extract_ledger_reserve(text, text, text, text, text, text, integer, integer, numeric) FROM PUBLIC, anon, authenticated, app_runtime;
REVOKE ALL ON FUNCTION public.projexa_extract_ledger_settle(text, integer, integer, numeric, boolean, text) FROM PUBLIC, anon, authenticated, app_runtime;
GRANT EXECUTE ON FUNCTION public.projexa_extract_ledger_total(text) TO service_role;
GRANT EXECUTE ON FUNCTION public.projexa_extract_ledger_reserve(text, text, text, text, text, text, integer, integer, numeric) TO service_role;
GRANT EXECUTE ON FUNCTION public.projexa_extract_ledger_settle(text, integer, integer, numeric, boolean, text) TO service_role;

COMMIT;
