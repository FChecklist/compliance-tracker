-- Wave 165 (tree4-unified/50-completion-plan U-D12.B4.S3 finding): the
-- dispatch route (src/app/api/ai/team/dispatch/route.ts) already sets
-- activity_log.lifecycle_stage = 'reviewing' when detectLowConfidenceResponse()
-- flags a low-confidence AI Team output -- but nothing ever read that back.
-- The HTTP response still said status:"completed" unconditionally, no
-- independent reviewer was ever required, and no comments became a
-- permanent record. All 4 columns nullable and additive -- existing rows
-- are unaffected; this only gates NEW dispatches that land in 'reviewing'.

ALTER TABLE compliance.activity_log ADD COLUMN IF NOT EXISTS self_assessment jsonb;
ALTER TABLE compliance.activity_log ADD COLUMN IF NOT EXISTS reviewed_by text;
ALTER TABLE compliance.activity_log ADD COLUMN IF NOT EXISTS review_notes text;
ALTER TABLE compliance.activity_log ADD COLUMN IF NOT EXISTS review_decision text; -- 'approved' | 'rejected', null until reviewed
