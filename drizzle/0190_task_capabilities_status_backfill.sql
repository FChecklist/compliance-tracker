-- Priority 12 (OPEN-07 point 6, 2026-07-14): one-time backfill of
-- task_capabilities.status for every row that already accumulated rolling
-- classification history (fullSoftwareCount/packageAvailableCount/
-- novelCount) BEFORE this wave wired real writes to the column. Without
-- this, a capability that happens not to be invoked again after this
-- deploy would sit on its stale 'ai_only' schema default forever --
-- recordExecutionOutcome() (capability-learning-service.ts) only
-- recomputes status on its NEXT write, and this backfill is what makes
-- already-accumulated history correct immediately instead of waiting on
-- that next call.
--
-- Mirrors deriveCapabilityStatus()'s exact thresholds (minimum 5 observed
-- executions before transitioning off 'ai_only'; >=80% full-software ->
-- 'full_software'; >=60% novel -> 'ai_only'; otherwise 'partial') as plain
-- integer cross-multiplication rather than percent/round() -- avoids any
-- floating-point rounding mismatch with computeCoverageStats()'s
-- Math.round() while landing on the identical yes/no answer at every real
-- threshold boundary. Source of truth for the thresholds themselves is
-- deriveCapabilityStatus() in src/lib/services/capability-learning-service.ts
-- -- if those constants ever change, this one-time backfill does NOT need
-- to be re-run to stay honest, since every future recordExecutionOutcome()
-- call already recomputes status fresh from the live TS function.
update compliance.task_capabilities
set status = case
  when (full_software_count + package_available_count + novel_count) < 5 then 'ai_only'
  when full_software_count * 100 >= 80 * (full_software_count + package_available_count + novel_count) then 'full_software'
  when novel_count * 100 >= 60 * (full_software_count + package_available_count + novel_count) then 'ai_only'
  else 'partial'
end;
