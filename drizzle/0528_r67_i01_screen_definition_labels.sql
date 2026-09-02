-- R67 lane I, item I-01 -- compliance.screen_definitions DATA corrections.
--
-- WHY THIS IS HAND-WRITTEN AND NOT `bun run db:generate` OUTPUT: every
-- statement below is an UPDATE against a jsonb column, not DDL. drizzle-kit
-- only ever emits schema changes, so it produces nothing for this file, and
-- scripts/check-migration-schema-drift.mjs (which parses CREATE TABLE /
-- ALTER TABLE ADD COLUMN out of migration files) correctly sees no expected
-- table or column here. Numbered 0528, the next free number after
-- drizzle/0527_r65_parte_billing_contracts.sql -- counted with PowerShell
-- Get-ChildItem, because Git Bash's `ls` on this laptop under-reported the
-- directory as ending at 0325 (a known local tooling fault, see the R67 lane
-- I claim in ai-os/boss/ACTIVE-CLAIMS.yaml). The number is re-checked against
-- origin/main by scripts/check-migration-collision.mjs immediately before
-- merge and is NEVER renumbered afterwards.
--
-- EVERY STATEMENT IS IDEMPOTENT. The PM applies this through the Supabase MCP
-- after merge and re-runs the verification SELECTs below, so a second
-- application must be a no-op: each WHERE clause matches only the
-- un-migrated value.
--
-- VERIFICATION SQL (run after applying):
--   SELECT columns->0->>'label' AS label
--     FROM compliance.screen_definitions
--    WHERE id = '4b1ff3d4-6877-4a10-89cc-ceb4d6f90ca1';
--   -- expect exactly: Active Projects
--
--   SELECT jsonb_array_elements(columns)->>'label' AS label
--     FROM compliance.screen_definitions WHERE function_id = 'permits.list';
--   -- expect 'End date' present and 'Expiry date' absent
--
--   SELECT jsonb_array_elements(columns)->>'label' AS label
--     FROM compliance.screen_definitions WHERE function_id = 'drawings.list';
--   -- expect 'Drawing No.', 'Rev' and 'Status' present, exactly once each
--
--   SELECT function_id, columns->0->>'label'
--     FROM compliance.screen_definitions WHERE columns::text ILIKE '%TEST%';
--   -- expect zero rows (also enforced from now on by the new CI job,
--   -- scripts/check-screen-definition-labels.mjs)

-- (1) The dashboard KPI column that shipped with a debugging label. This row's
-- org_id is NULL, i.e. it is the GLOBAL row M28's resolver falls back to for
-- every tenant that has no override, so the debug text was served to every
-- customer. Needed by C01-02.
UPDATE compliance.screen_definitions
   SET columns = jsonb_set(columns, '{0,label}', '"Active Projects"'::jsonb),
       version = version + 1
 WHERE id = '4b1ff3d4-6877-4a10-89cc-ceb4d6f90ca1'
   AND columns->0->>'label' IS DISTINCT FROM 'Active Projects';

-- (2) permits.list: 'Expiry date' -> 'End date'. Needed by C01-11, whose page
-- prefers the registry columns over its own local constant, so renaming here
-- is what actually changes the header the customer reads.
--
-- Rewrites the whole array rather than jsonb_set on a fixed index: the column
-- is not guaranteed to sit at index 0 in every row (an org override may order
-- its columns differently), and WITH ORDINALITY + jsonb_agg(... ORDER BY ord)
-- preserves the original order exactly. Guarded by an EXISTS so a row that
-- already says 'End date' is untouched and its version is not bumped again.
UPDATE compliance.screen_definitions sd
   SET columns = (
         SELECT jsonb_agg(
                  CASE WHEN elem->>'label' = 'Expiry date'
                       THEN jsonb_set(elem, '{label}', '"End date"'::jsonb)
                       ELSE elem
                  END
                  ORDER BY ord
                )
           FROM jsonb_array_elements(sd.columns) WITH ORDINALITY AS t(elem, ord)
       ),
       version = sd.version + 1
 WHERE sd.function_id = 'permits.list'
   AND EXISTS (
         SELECT 1 FROM jsonb_array_elements(sd.columns) AS e
          WHERE e->>'label' = 'Expiry date'
       );

-- (3) drawings.list gains Drawing No. / Rev / Status. Needed by C01-21.
-- Appended (jsonb `||`) so the four existing columns (Name | Kind |
-- Discipline | Added) keep their order and their meaning. Field names match
-- the camelCase keys the resolver and PROJEXA's DrawingsClient already read
-- (`label`, `field`, `type`, `importance` -- see
-- src/lib/screens/resolve-definition.ts's ScreenColumn). The NOT EXISTS guard
-- keys on the first of the three, so re-applying appends nothing.
UPDATE compliance.screen_definitions sd
   SET columns = sd.columns || jsonb_build_array(
         jsonb_build_object('label', 'Drawing No.', 'field', 'drawingNumber', 'type', 'text', 'importance', 'High'),
         jsonb_build_object('label', 'Rev',         'field', 'revision',      'type', 'text', 'importance', 'Medium'),
         jsonb_build_object('label', 'Status',      'field', 'status',        'type', 'text', 'importance', 'High')
       ),
       version = sd.version + 1
 WHERE sd.function_id = 'drawings.list'
   AND jsonb_typeof(sd.columns) = 'array'
   AND NOT EXISTS (
         SELECT 1 FROM jsonb_array_elements(sd.columns) AS e
          WHERE e->>'label' = 'Drawing No.'
       );
