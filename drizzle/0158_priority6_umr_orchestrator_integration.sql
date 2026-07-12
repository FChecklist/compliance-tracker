-- Priority 6 (UMR <-> Software Orchestrator integration): the Universal
-- Metadata Registry (compliance.platform_assets, Priority 3-4) and the
-- Software Orchestrator's Auditor -> Higher AI loop
-- (compliance.capability_improvement_proposals, Priority 5) were built in
-- adjacent, disconnected priorities and never talked to each other. This
-- migration adds the one new column the integration needs:
-- existing_asset_match on capability_improvement_proposals, nullable jsonb,
-- populated by capability-audit-service.ts's findExistingUmrCandidate()
-- before a proposal is dispatched to Higher AI, when a UMR keyword search
-- turns up a plausible existing platform_assets row (most commonly an
-- already-implemented computation_engine that simply isn't wired into
-- task-execution-engine.ts's dispatchEngine() switch yet). Null is the
-- expected common case -- most gaps genuinely have no existing asset to
-- reuse.
--
-- No new table, no new index: this column is read/written only inside a
-- single proposal row lookup (by primary key), never queried/filtered on
-- its own, so no additional index is warranted.

ALTER TABLE compliance.capability_improvement_proposals
  ADD COLUMN IF NOT EXISTS existing_asset_match jsonb;

COMMENT ON COLUMN compliance.capability_improvement_proposals.existing_asset_match IS
  'Priority 6: {assetId, name, sourceTable, sourceId, assetType} of a platform_assets row the Auditor''s UMR keyword search found as a plausible existing match before dispatching to Higher AI. Null when no strong match was found. Never blocks dispatch -- Higher AI is still asked to close the gap, but the TightTask notes the candidate so wiring/reuse is considered before a from-scratch build; closeImprovementLoop() also reads this to decide whether to update the existing UMR row instead of registering a new one.';
