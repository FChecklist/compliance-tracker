# AUDIT_wave152b_zai_items.md

**Auditor:** Claude Code Sonnet Desktop | **Date:** 2026-07-09
**Scope:** Wave 152's Wisdom + Innovation Engines slice (Phase4_Implementation_Plan.md item 7), implemented by z.ai (dispatched via `ai-team-workforce.yml`, `senior_backend_engineer` role). Per the mandatory cross-audit rule, I audit this because I did not implement it. (Wave 152's third piece, the Prediction Engine, was implemented by me — audited separately by z.ai per the usual pattern, PR #87.)

---

## Item 1: Wisdom Engine (`wisdom-engine-service.ts`) — PASS

- `summarizeGatedReplyReasons()` matches the brief exactly: reads `orchestra_executions` scoped to `orgId` and `status = 'gated'`, groups by the `output.reason` jsonb field, returns `{ reason, count }[]` sorted descending.
- Malformed-row handling verified by reading the type-guard directly: `typeof row.output === "object" && row.output !== null && typeof (...).reason === "string"` — a null/non-object/missing-reason row falls back to `"unknown"` rather than throwing. No unsafe cast reaches production data without this guard.
- Zero LLM calls, zero writes — read-only aggregation, matching the "Wisdom" framing (surfacing real patterns, not fabricating insight).
- Ran `bun x tsc --noEmit` myself after merging (z.ai flagged it lacked exec access) — clean.

## Item 2: Innovation Engine (`innovation-engine-service.ts`) — PASS

- `detectRecurringTaskPatterns()` correctly normalizes titles (`trim().toLowerCase()`), skips empty titles, and only counts patterns at `MIN_OCCURRENCES = 3`, matching the brief's floor.
- Correctly reuses `proposeLoopImprovement()` (the Wave 146 shared helper) rather than writing to `loopImprovements` directly — confirmed the import and call shape match every other caller of that helper in the codebase.
- `afterState: null` is deliberate and correctly justified in the header comment (the engine can detect a pattern but can't safely infer a real `automation_rules` trigger/action config) — this is the same "don't guess, propose for human review instead" discipline `tier-integrity-audit.ts` established, applied consistently here, not just claimed.
- Confirmed `isDeployed` cannot be influenced by this file — `proposeLoopImprovement()`'s own signature has no such parameter, so this engine has no path to autonomously apply anything, matching every other loop's posture.
- Added a nice touch beyond the brief: deterministic secondary sort (`localeCompare` tiebreak) so output ordering doesn't depend on `Map` iteration order — a real correctness improvement, not just cosmetic.
- `bun x tsc --noEmit` clean (verified myself).

## Cross-cutting

- No API routes added (correctly out of scope per the brief — follow-up work).
- No test files (consistent with this codebase's established convention: DB-touching service functions aren't unit tested without a live database — same convention my own Wave 152 Prediction Engine piece follows).
- No security concern in either file: both are read-scoped by `orgId` via `withTenantContext`, no client input reaches either function directly (both take a trusted `ctx.orgId`), no injection surface (Drizzle-parameterized queries only).

## Overall verdict: APPROVE
