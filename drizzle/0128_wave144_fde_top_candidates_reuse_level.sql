-- Wave 144: VERI FDE top-K candidates + explicit reuse level, per the joint
-- VERIDIAN.docx implementation plan (Phase 1 items 5-6, both independent
-- studies flagged FDE discarded every candidate but #1 and never made the
-- chosen reuse tier explicit/auditable). Both additive/nullable.

ALTER TABLE compliance.fde_requests ADD COLUMN IF NOT EXISTS top_candidates jsonb;
ALTER TABLE compliance.fde_requests ADD COLUMN IF NOT EXISTS reuse_level text;
