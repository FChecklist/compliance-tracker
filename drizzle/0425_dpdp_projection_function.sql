-- WO-DPDP-004 Section 2.2, corrected per WO-DPDP-006 Section 2: this MUST
-- be a real Postgres SQL function, not app code, because the personal-data
-- exclusion is a security boundary enforced by the query itself -- no
-- future route, refactor or careless change can leak a principal's name,
-- phone or email through it, because those columns are never referenced
-- in the function body at all (SECURITY DEFINER means it runs with the
-- function owner's privileges and bypasses RLS entirely -- which is
-- exactly why this function must be hand-audited to touch nothing
-- personal-data-shaped, since RLS cannot be relied on to protect it).
--
-- p_org is `text`, not `uuid` -- this schema's organisation.id is a cuid2
-- text value (createId(), matching every other id in dpdp.*), not a native
-- Postgres uuid. The WO's own abbreviated signature assumed uuid PKs;
-- adapted to the real column type rather than casting or changing the PK
-- type project-wide.
CREATE OR REPLACE FUNCTION dpdp.projection(p_org text, p_asof timestamptz DEFAULT now())
RETURNS text
LANGUAGE sql STABLE SECURITY DEFINER
SET search_path = 'dpdp', 'pg_temp'
AS $$
  WITH org AS (
    SELECT name FROM dpdp.organisation WHERE id = p_org
  ),
  duties AS (
    SELECT
      count(*) AS total,
      count(*) FILTER (WHERE state = 'closed') AS done,
      count(*) FILTER (WHERE state = 'open' AND due_on < p_asof::date) AS late
    FROM dpdp.obligation WHERE org_id = p_org
  ),
  cats AS (
    SELECT count(*) AS total FROM dpdp.data_category WHERE org_id = p_org
  ),
  located AS (
    SELECT count(DISTINCT dc.id) AS n
    FROM dpdp.data_category dc
    JOIN dpdp.data_location dl ON dl.category_id = dc.id AND dl.state = 'confirmed'
    WHERE dc.org_id = p_org
  ),
  rels AS (
    SELECT count(*) AS total, count(*) FILTER (WHERE agreement_signed_at IS NOT NULL) AS signed
    FROM dpdp.relationship WHERE from_org = p_org
  ),
  rights AS (
    -- Count only -- "no row from consent_token or rights_request beyond a
    -- reference number" (WO 2.2); this doesn't even select the reference.
    SELECT count(*) AS n FROM dpdp.rights_request
    WHERE org_id = p_org AND answered_at IS NULL AND received_at <= p_asof
  ),
  griev AS (
    SELECT count(*) AS n FROM dpdp.grievance WHERE org_id = p_org
  )
  SELECT string_agg(line, E'\n') FROM (
    VALUES
      (1, 'VERIDIAN · DPDP position for ' || coalesce((SELECT name FROM org), 'this organisation')),
      (2, 'Snapshot ' || to_char(p_asof, 'YYYY-MM-DD') || ' · read-only · no personal data'),
      (3, ''),
      (4, 'DUTIES  ' || (SELECT total FROM duties) || ' total · ' || (SELECT done FROM duties) || ' done · ' || (SELECT late FROM duties) || ' late'),
      (5, 'DATA MAP  ' || (SELECT total FROM cats) || ' categories · ' || (SELECT n FROM located) || ' located · ' || ((SELECT total FROM cats) - (SELECT n FROM located)) || ' unknown'),
      (6, 'OUTSIDE FIRMS  ' || (SELECT total FROM rels) || ' · agreements signed ' || (SELECT signed FROM rels)),
      (7, 'OPEN REQUESTS  ' || (SELECT n FROM rights)),
      (8, 'COMPLAINTS  ' || (SELECT n FROM griev)),
      (9, ''),
      (10, 'HOW TO REPLY'),
      (11, '  Output a VERIDIAN-INSTRUCTIONS block: one JSON array of'),
      (12, '  proposed lines, each { verb, targetKey, payload }.'),
      (13, '  verb is one of: ASSIGN, SET_DUE, NOTE, MARK_NA (reason required), DRAFT.'),
      (14, '  targetKey must be a real duty reference already in this snapshot.'),
      (15, '  Nothing else parses. The person pastes this back and approves'),
      (16, '  each line themselves before anything moves.')
  ) AS t(ord, line)
  ORDER BY ord;
$$;
--> statement-breakpoint
-- SECURITY DEFINER functions default to EXECUTE granted to PUBLIC in
-- Postgres -- revoke that and grant only to the roles that actually call
-- it, so no other role can invoke a function running with elevated
-- privileges "for free."
REVOKE ALL ON FUNCTION dpdp.projection(text, timestamptz) FROM PUBLIC;--> statement-breakpoint
GRANT EXECUTE ON FUNCTION dpdp.projection(text, timestamptz) TO app_runtime, service_role;
