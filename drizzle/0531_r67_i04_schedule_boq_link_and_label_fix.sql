-- R67 lane I, item I-04 (R-127) -- schedule data fixes plus the
-- activity-to-BOQ link the other streams need.
--
-- Numbered 0531, the next free number after this lane's own 0530 (and
-- 0527_r65_parte_billing_contracts.sql on origin/main). Never renumbered once
-- applied. drizzle/*.sql line endings are already pinned to LF by
-- .gitattributes, which scripts/check-migration-integrity.mjs enforces.
--
-- Hand-written because parts (a) and (c) are jsonb/text UPDATEs that
-- drizzle-kit never emits. Part (b) IS declared in src/lib/db/schema.ts
-- (pmsIssueBoqLinks, pmsIssues.completionSource, pmsIssues.completedFromEntryId),
-- so the Migration Schema Drift gate sees it once applied and `bun run
-- db:generate` produces no further diff. Nothing here is under platform.*, so
-- nothing here is invisible to that gate.
--
-- POST-APPLY VERIFICATION SQL (for the PR description):
--   SELECT function_id, columns->0->>'label'
--     FROM compliance.screen_definitions WHERE columns::text ILIKE '%TEST%';
--   -- MUST return zero rows (also enforced from now on by the CI job
--   -- scripts/check-screen-definition-labels.mjs, added with drizzle/0528)
--
--   SELECT column_name FROM information_schema.columns
--    WHERE table_schema = 'compliance' AND table_name = 'pms_issues'
--      AND column_name IN ('completion_source', 'completed_from_entry_id');
--   -- expect 2 rows
--
--   SELECT count(*) FROM compliance.pms_issue_boq_links;   -- expect 0 on first apply
--
--   SELECT title FROM compliance.pms_issues
--    WHERE title LIKE '%Cedar Heights Villa - Phase 1%';
--   -- expect zero rows

-- ---------------------------------------------------------------------------
-- (a) The leaked debug labels.
--
-- Two rows shipped with a debugging label baked into their `columns` jsonb.
-- The dashboard KPI row a018f269-8375-44a5-a9ed-1060bf4d3efc has org_id NULL,
-- i.e. it is the GLOBAL row M28's resolver falls back to for every tenant with
-- no override, so its debug text was served to every customer.
--
-- Both statements are idempotent: the WHERE matches only the un-migrated
-- value, so re-applying changes nothing and does not bump version a second
-- time. Neither statement can touch a row whose label is already correct.
UPDATE compliance.screen_definitions
   SET columns = jsonb_set(columns, '{0,label}', '"Activity"'::jsonb),
       version = version + 1
 WHERE function_id = 'schedule.timeline'
   AND columns->0->>'label' LIKE '%TEST%';

UPDATE compliance.screen_definitions
   SET columns = jsonb_set(columns, '{0,label}', '"Active Projects"'::jsonb),
       version = version + 1
 WHERE id = 'a018f269-8375-44a5-a9ed-1060bf4d3efc'
   AND columns->0->>'label' LIKE '%TEST%';

-- ---------------------------------------------------------------------------
-- (b) The schema the other streams need.
--
-- pms_issue_boq_links: which BOQ line(s) a schedule activity actually
-- delivers. A JOIN TABLE, not a column on pms_issues -- one activity routinely
-- covers several BOQ lines and one line can be delivered by several
-- activities. `weight` splits a line across the activities delivering it;
-- default 1 = "this activity delivers the whole line", the common case, so a
-- single-link row is correct with nothing to configure.
--
-- boq_line_item_id carries NO database-level FK, matching
-- construction_work_progress_entries.boq_line_item_id's own posture on the
-- same link: a deleted BOQ line must not block the delete or cascade into
-- schedule data. issue_id DOES cascade -- a link to a deleted activity is
-- meaningless, not history.
CREATE TABLE IF NOT EXISTS compliance.pms_issue_boq_links (
  id text PRIMARY KEY DEFAULT gen_random_uuid()::text,
  org_id text NOT NULL,
  issue_id text NOT NULL REFERENCES compliance.pms_issues(id) ON DELETE CASCADE,
  boq_line_item_id text NOT NULL,
  weight numeric NOT NULL DEFAULT 1,
  created_at timestamp NOT NULL DEFAULT now()
);

-- One link per (activity, line): linking the same pair twice would
-- double-count that line's value in every roll-up built on this table.
CREATE UNIQUE INDEX IF NOT EXISTS pms_issue_boq_links_issue_line_unique
  ON compliance.pms_issue_boq_links (issue_id, boq_line_item_id);
CREATE INDEX IF NOT EXISTS pms_issue_boq_links_org_line_idx
  ON compliance.pms_issue_boq_links (org_id, boq_line_item_id);

-- RLS, matching pms_issues' own policy shape (drizzle/0021) exactly: org_id is
-- carried on this row, so the direct `org_id = current_org_id()` form applies
-- here rather than the EXISTS-through-the-parent form used by
-- pms_issue_assignees/pms_issue_labels (which carry no org_id of their own).
ALTER TABLE compliance.pms_issue_boq_links ENABLE ROW LEVEL SECURITY;
DO $$ BEGIN CREATE POLICY app_runtime_org_scoped ON compliance.pms_issue_boq_links FOR ALL TO app_runtime USING (org_id = compliance.current_org_id()); EXCEPTION WHEN duplicate_object THEN NULL; END $$;
DO $$ BEGIN CREATE POLICY service_role_bypass_pms_issue_boq_links ON compliance.pms_issue_boq_links FOR ALL TO service_role USING (true); EXCEPTION WHEN duplicate_object THEN NULL; END $$;

-- Where a completion percentage came from. Defaults to 'manual', which is the
-- literal truth for every pre-existing row (the service layer set them by
-- hand), so nothing is retroactively reclassified as something it was not.
ALTER TABLE compliance.pms_issues ADD COLUMN IF NOT EXISTS completion_source text NOT NULL DEFAULT 'manual';
ALTER TABLE compliance.pms_issues ADD COLUMN IF NOT EXISTS completed_from_entry_id text;

-- ---------------------------------------------------------------------------
-- (c) Demo data only: the three demo schedule activities read
-- "<activity> - Cedar Heights Villa - Phase 1", so every Gantt bar's label is
-- three-quarters project name. Strips exactly that one suffix, leaving the
-- activity itself, so the bars read as activities.
--
-- Bounded on purpose: only titles that literally END with that exact string
-- are touched, only in the demo org, and rtrim collapses the space left
-- behind. A title that merely mentions the project mid-sentence is untouched.
-- Idempotent -- after the first run no title ends with the suffix any more.
UPDATE compliance.pms_issues i
   SET title = rtrim(left(i.title, length(i.title) - length(' - Cedar Heights Villa - Phase 1'))),
       updated_at = now()
  FROM compliance.users u
 WHERE u.email = 'democeo@projexa-ai.com'
   AND u.org_id IS NOT NULL
   AND i.org_id = u.org_id
   AND i.title LIKE '% - Cedar Heights Villa - Phase 1'
   AND length(i.title) > length(' - Cedar Heights Villa - Phase 1');
