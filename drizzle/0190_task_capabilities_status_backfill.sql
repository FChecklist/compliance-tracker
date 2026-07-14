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
-- 'full_software'; >=60% novel -> 'ai_only'; otherwise 'partial').
--
-- AUDIT FIX (Super Boss, 2026-07-14): the original version of this file used
-- a naive integer cross-multiplication (`full*100 >= 80*total`) that claimed
-- to match deriveCapabilityStatus() exactly but did not -- that function
-- compares Math.round((full/total)*100) to 80, which is satisfied by any
-- raw percentage >= 79.5, not just >= 80.0. Brute-force verified against
-- every (full, package, novel) combination up to total=500: the naive
-- version disagreed with the live TS function at raw percentages in
-- [79.5, 80) and [59.5, 60) (e.g. full=35/44=79.545% rounds to 80 in TS ->
-- 'full_software', but 35*100 >= 80*44 is false -> naive SQL said
-- 'partial'). Fixed by scaling to one decimal place (*1000 vs *795/*595)
-- so the SQL integer comparison lands on the exact same rounding boundary
-- Math.round() produces -- re-verified with zero mismatches across the
-- same brute-force sweep after this fix.
update compliance.task_capabilities
set status = case
  when (full_software_count + package_available_count + novel_count) < 5 then 'ai_only'
  when full_software_count * 1000 >= 795 * (full_software_count + package_available_count + novel_count) then 'full_software'
  when novel_count * 1000 >= 595 * (full_software_count + package_available_count + novel_count) then 'ai_only'
  else 'partial'
end;
