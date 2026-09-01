# Changelog — compliance-tracker

Per `docs/DOCUMENTATION_STANDARDS.md` (R46 P9 seq36): this file is seeded
from **R46 P9 forward (2026-08-24/25)**, the first point this repo had a
written CHANGELOG at all. It is not a reconstruction of every PR in this
repo's history — that would be a large, separate retrofit job (see the
standards doc's own scope note). Newest entry first, grouped by queue seq.

> **Pre-2026-08-24 history** (added 2026-09-01, R66 code-quality
> inspection): for real work before this changelog existed (this repo's
> commit history goes back to at least 2026-06-28), see `TEST_LOG.md`'s
> Wave-numbered entries, the many wave/R-numbered report docs at repo
> root, or `git log` directly — there is no single index for that earlier
> period.

## R46 P9 seq36 -- documentation standards + this CHANGELOG (this PR, 2026-08-25)
`docs/DOCUMENTATION_STANDARDS.md` (new) + this file (new). Docs-only.

## R46 P9 seq35 -- merge Part C + Part D into docs/AI_WORKFLOW_RAG.md (PR #1371, 2026-08-25)
Merges the six-guardrail audit (seq30) and the L0-L3 flow into one
cross-referenced doc; honestly reports the RAG corpus (Part D) as not yet
built rather than fabricating it. Docs-only.

## R46 P9 seq34 -- real, timestamped end-to-end trace against live production (PR #1370, 2026-08-25)
`architecture/END_TO_END_TRACE.md` (new): 6 real submissions traced through
`projexa-ai.com/api/assistant` -> live `compliance-tracker` backend, with
every DB row re-SELECTed. Found and documented 2 real gaps live:
`reuse_cache` is schema-only (never wired), and a compound `"X and Y"` input
silently drops its second clause with zero `gap_log` entry. Docs-only.

## R46 P9 seq33 -- L2 report_definition artifacts become real, runnable rows (PR #1367, 2026-08-25)
`src/lib/ai/batch/analyse.ts` / `analyse.test.ts`: `runL2Batch()`'s
`report_definition` artifacts are now persisted as real
`compliance.report_definitions` rows (via the existing, already-built
`createReportDefinition()`) when they resolve to a whitelisted
`deterministic_aggregation` shape, instead of only reaching a JSON response
field that the cron route discarded. 12/12 tests pass. 0 new TypeScript
errors (full `tsc --noEmit` run).

## R46 P9 seq44 -- R1-R45 open-items inventory, sourced from live DB queries (PR #1365, 2026-08-25)
`audit/R1_R45_OPEN_ITEMS.md` (new). Cross-confirms this run's own seq35
finding that the RAG corpus (and the rest of the P3-AI phase) was, as of
this date, PENDING with zero attempts. Docs-only. (Not authored by this
session -- listed here because seq35 above cites it as corroborating
evidence and this CHANGELOG's own standard is to record every real R46 P9
change, not only this session's own.)

## R46 P9 seq43 -- document verified MCP/CLI readiness (Vercel, Supabase, GitHub) (PR #1362, 2026-08-25)
Docs-only. (Not authored by this session -- listed for the same reason as
seq44 above.)

## R46 P9 seq30 -- document real L1 guardrail state (2/6 wired, 4 gap) (PR #1363, 2026-08-25)
`ai-os/R46_P9_SEQ30_L1_GUARDRAILS_GAP_ANALYSIS.md` (new). This run's seq35
merges this document's content verbatim into `docs/AI_WORKFLOW_RAG.md`'s
Part C. Docs-only. (Not authored by this session -- listed for the same
reason as seq44/seq43 above.)
