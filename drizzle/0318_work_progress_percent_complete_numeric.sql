ALTER TABLE compliance.construction_work_progress_entries ALTER COLUMN percent_complete TYPE numeric USING percent_complete::numeric;
-- integer -> numeric IS a widening cast. Every existing integer value survives exactly.
-- This is the ONE permitted exception to AR-11 (never ALTER TYPE): widening integer to numeric
-- cannot lose data and cannot fail on existing rows. State that in the migration comment.
