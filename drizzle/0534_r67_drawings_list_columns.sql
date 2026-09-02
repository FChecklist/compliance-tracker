-- R67 D-12 (audit R-034): the drawings register gains Drawing No., Rev and
-- Status, so it can answer "is this the one I build from?".
--
-- *** APPLY THIS AFTER drizzle/0528_r67_i01_screen_definition_labels.sql. ***
--
-- RELATIONSHIP TO 0528 (R67 lane I, item I-01), which is already on main.
-- That migration's section (3) also touches drawings.list: it APPENDS three
-- columns to every drawings.list row using the field names `drawingNumber` and
-- `revision`. Lane D1's API and PROJEXA client emit `drawingNo` and `rev`
-- (src/lib/drawings-register.ts toDrawingDto -> DrawingsClient renderCell), so
-- against 0528's field names those two columns render blank on every screen.
-- The two lanes were written in parallel from the same audit finding and only
-- met at merge; this file is the reconciliation, and it deliberately
-- supersedes 0528 section (3). 0528 stays as it is -- re-applying it after
-- this file is a no-op, because its NOT EXISTS guard keys on the LABEL
-- 'Drawing No.', which this file preserves on every row it touches.
--
-- WHY THIS IS HAND-WRITTEN, and not `bun run db:generate` output: there is no
-- DDL here. compliance.screen_definitions already exists (0295) and the four
-- new drawing fields live inside a documents row's metadata jsonb, so no
-- column is added anywhere. What changes is DATA -- the registry rows that
-- decide which columns the drawings list renders -- and drizzle-kit never
-- generates data. DrawingsClient prefers the registry row over its own
-- hardcoded COLUMNS fallback, so without these rows the three new columns
-- would be invisible on any database where a drawings.list row exists.
--
-- Numbered 0534, the next free number after
-- drizzle/0533_r67_pipeline_task_error_codes.sql (lane B), read from
-- `git ls-tree origin/main -- drizzle/` at rebase time (origin/main 41391e87);
-- journal idx 356, appended after lane B's 355. This file has now been
-- renumbered TWICE by merging lanes -- it was drafted as 0528 (collided with
-- lane I) and then 0533 (collided with lane B) -- so re-read origin/main's
-- drizzle/ listing before merging rather than trusting this header. Do NOT
-- trust a local Git Bash `ls` of this directory either: it under-reports on
-- this laptop, which is how the first collision happened.
--
-- Statement (1) is field-name repair and runs against EVERY drawings.list row,
-- including per-org overrides -- an org that took 0528's append would
-- otherwise keep two permanently blank columns that no API response can fill.
-- Statement (2) writes the canonical column set, and only on the GLOBAL row
-- (org_id IS NULL), because the column ORDER on an org override is that org's
-- own presentation choice and is not this lane's to overwrite; after (1) its
-- columns resolve correctly whatever order they sit in.
--
-- Both statements are idempotent: (1) only matches a row that still carries an
-- old field name, (2) only writes when the array is not already identical.

-- (1) Rename lane I 0528 section (3)'s field names to the ones the API really
-- returns, preserving each row's existing column order exactly
-- (WITH ORDINALITY + jsonb_agg(... ORDER BY ord), the same technique 0528
-- section (2) uses for the permits rename). Labels are untouched.
UPDATE "compliance"."screen_definitions" sd
   SET columns = (
         SELECT jsonb_agg(
                  CASE
                    WHEN elem->>'field' = 'drawingNumber' THEN jsonb_set(elem, '{field}', '"drawingNo"'::jsonb)
                    WHEN elem->>'field' = 'revision'      THEN jsonb_set(elem, '{field}', '"rev"'::jsonb)
                    ELSE elem
                  END
                  ORDER BY ord
                )
           FROM jsonb_array_elements(sd.columns) WITH ORDINALITY AS t(elem, ord)
       ),
       version = sd.version + 1
 WHERE sd.function_id = 'drawings.list'
   AND jsonb_typeof(sd.columns) = 'array'
   AND EXISTS (
         SELECT 1 FROM jsonb_array_elements(sd.columns) AS e
          WHERE e->>'field' IN ('drawingNumber', 'revision')
       );

-- (2) The global row carries the canonical set, in the item's order:
--   Name | Drawing No. | Rev | Kind | Discipline | Status | Added
-- Seven High columns, which is the M28 cap ListScreen enforces -- the two
-- affordance columns the screen adds (File, Open) are deliberately NOT here,
-- because they are not data the registry describes. This is exactly what
-- src/components/DrawingsClient.tsx renders and what
-- src/lib/drawings-register.ts exports.
DO $$
DECLARE
  updated_rows int;
  drawings_columns jsonb := '[
    {"label": "Name",        "field": "name",       "type": "text", "importance": "High"},
    {"label": "Drawing No.", "field": "drawingNo",  "type": "text", "importance": "High"},
    {"label": "Rev",         "field": "rev",        "type": "text", "importance": "High"},
    {"label": "Kind",        "field": "kind",       "type": "text", "importance": "High"},
    {"label": "Discipline",  "field": "discipline", "type": "text", "importance": "High"},
    {"label": "Status",      "field": "status",     "type": "text", "importance": "High"},
    {"label": "Added",       "field": "createdAt",  "type": "date", "importance": "High"}
  ]'::jsonb;
BEGIN
  UPDATE "compliance"."screen_definitions"
     SET columns = drawings_columns,
         version = version + 1
   WHERE function_id = 'drawings.list'
     AND org_id IS NULL
     AND columns IS DISTINCT FROM drawings_columns;
  GET DIAGNOSTICS updated_rows = ROW_COUNT;

  IF updated_rows = 0
     AND NOT EXISTS (
       SELECT 1 FROM "compliance"."screen_definitions"
        WHERE function_id = 'drawings.list' AND org_id IS NULL
     )
  THEN
    INSERT INTO "compliance"."screen_definitions"
      (id, org_id, function_id, archetype, data_source, columns, drill_to, breadcrumb_template, version)
    VALUES
      ('scrdef_r67_drawings_list', NULL, 'drawings.list', 'LIST', 'projexa_drawings',
       drawings_columns, 'drawings.object', 'Drawings & 3D', 1);
  END IF;
END $$;

-- VERIFICATION SQL (run after applying, as the PM does for every hand-written
-- data migration in this programme):
--
--   -- no drawings.list row anywhere still carries a field name the API never returns
--   SELECT count(*) FROM compliance.screen_definitions sd
--    WHERE sd.function_id = 'drawings.list'
--      AND EXISTS (SELECT 1 FROM jsonb_array_elements(sd.columns) e
--                   WHERE e->>'field' IN ('drawingNumber','revision'));
--   -- expect 0
--
--   -- the global row reads in the item's order
--   SELECT jsonb_array_elements(columns)->>'label' AS label
--     FROM compliance.screen_definitions
--    WHERE function_id = 'drawings.list' AND org_id IS NULL;
--   -- expect: Name, Drawing No., Rev, Kind, Discipline, Status, Added
