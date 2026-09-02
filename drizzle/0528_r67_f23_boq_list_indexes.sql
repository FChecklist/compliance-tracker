-- R67 F-23 (audit recommendation R-239) -- indexes for the one-transaction
-- BOQ list.
--
-- listBoqs(..., { include: "lineItems,variation" }) replaces the old
-- Promise.all(boqs.map(getBoq)) fan-out with (a) one inArray read of every
-- revision's line items and (b) one CTE that groups
-- construction_boq_line_items by boq_id and joins each revision to its parent
-- through parent_boq_id. Both are keyed on construction_boq_line_items.boq_id,
-- which had NO index at all -- 0101_wave115_construction_boq_progress_diary.sql
-- created the table with only its primary key, and every read of a BOQ's lines
-- since has been a sequential scan.
--
-- The recommendation asked for "(project_id, superseded_at)". There is no
-- superseded_at column on compliance.construction_boqs: supersession is
-- recorded as status = 'superseded' (see createBoqRevision), and the predicate
-- listBoqs and the CTE's `revision` term actually filter on is
-- (org_id, project_id). That is the index created here; naming a column that
-- does not exist would have produced a migration that cannot run.
--
-- Hand-authored SQL with a journal entry, matching 0312-0315's convention for
-- index-only migrations (drizzle-kit generate only emits what schema.ts
-- declares, and these indexes are not declared there).
CREATE INDEX IF NOT EXISTS idx_construction_boq_line_items_boq_id
  ON compliance.construction_boq_line_items(boq_id);

CREATE INDEX IF NOT EXISTS idx_construction_boqs_org_project
  ON compliance.construction_boqs(org_id, project_id);

-- The CTE's parent join (totals p ON p.boq_id = r.parent_boq_id) walks
-- parent_boq_id. It is already UNIQUE (0323_construction_boq_parent_unique),
-- and a unique constraint carries its own index, so no third index is needed.
