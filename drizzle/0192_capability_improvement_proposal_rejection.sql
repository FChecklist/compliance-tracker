-- Priority 12 (OPEN-07 point 5): capability_improvement_proposals.status has
-- allowed 'rejected' since its very first migration (0156's CHECK
-- constraint), but no code anywhere ever wrote it -- closeImprovementLoop()
-- (capability-audit-service.ts) only ever transitions a proposal to
-- 'resolved'. This migration adds the one column a real reject path needs:
-- rejection_reason, the human-facing counterpart to the existing pr_url
-- column (pr_url records WHY a 'resolved' row is closed; rejection_reason
-- records WHY a 'rejected' one is). Nullable, additive only -- no existing
-- row is affected, no new table, no new index (same posture as migration
-- 0158's existing_asset_match addition: read/written only by a single
-- proposal-row lookup, never filtered/queried on its own).

ALTER TABLE compliance.capability_improvement_proposals
  ADD COLUMN IF NOT EXISTS rejection_reason text;

COMMENT ON COLUMN compliance.capability_improvement_proposals.rejection_reason IS
  'Priority 12 (OPEN-07 point 5): human-entered reason a veridian_admin rejected this proposal via rejectImprovementProposal() / POST /api/ai/team/capability-improvements/[id]. Null until rejected. The counterpart to pr_url, which records why a resolved proposal was closed instead.';
