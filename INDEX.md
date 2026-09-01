# Root documentation index

This repo has ~39 top-level `.md`/`.yaml`/`.html` files. None of them was a
map of the others until this one (added 2026-09-01, R66 code-quality
inspection). Classified by what's actually current authority vs.
historical/narrative context.

## Read first (current authority)
- **`CLAUDE.md`** — the real entry point. Its "Read Before Starting Work"
  list names the live governance docs (`ai-os/boss/ACTIVE-CLAIMS.yaml`,
  `ai-os/CONSTITUTION.yaml`, `ai-os/OS.yaml`, `ai-os/BRAIN.md`,
  `ai-os/MASTER-TRACKER.yaml`, `ai-os/SOFTWARE_TEAM.md`,
  `ai-os/DOMAIN_OWNERSHIP.yaml`) and the Commands section.
- **`ai-os/CONSTITUTION.yaml`** — the single, machine-readable constitution;
  authoritative over every narrative doc below on any conflict.
- **`AGENTS.md`** — authorization/governance rules for AI agents working in
  this repo.

## Narrative/historical context (superseded on conflict by `ai-os/CONSTITUTION.yaml`)
- `VERIDIAN_AI_CONSTITUTION.md`, `MASTER_AI_OS_ARCHITECTURE.md`,
  `VERIDIAN_TASK_GOVERNANCE_CONSTITUTION.md`,
  `VERIDIAN_AUDIT_ORGANIZATION.md`, `VERIDIAN_DMP_DCF_CONSTITUTION.md`,
  `VERI_CHAT_GOVERNANCE.md`, `SENTINEL.md` — detailed reasoning and
  file:line evidence for how each rule in the constitution came to be.
  See `VERIDIAN_DMP_DCF_CONSTITUTION.md`'s "Relationship to the other
  constitutional documents" table for how these six relate to each other.
- `AI_OS_CERTIFICATION.md` — first certification pass (2026-07-04), now
  stale; see `AI_OS_MASTER_PROMPT_GAP_ANALYSIS.md` for the more current
  evaluation.
- `MCP_PROTOCOL.md` — MCP Server 1 is real and live; MCP Server 2 sections
  are `[NOT BUILT]` design spec, marked inline.
- `TEST_LOG.md` — Wave 100+ testing pass, coverage window noted at top.

## Strategy / planning (not governance)
- `PLATFORM_STRATEGY.md` — platform strategy direction, scoped explicitly
  to strategy rather than operating rules.
- `VAIOS_ARCHITECTURE_STRATEGY.md`, `COMPARISON_CSV_3_GAP_ANALYSIS.md`,
  `ERP_BENCHMARK_COMPARISON.md`, `comparison_csv_2_full_benchmark.csv`,
  `comparison_csv_3_ai_platform_benchmark.csv` — competitive/benchmark
  research.

## Process logs (volatile, not stable references)
- `CHANGELOG.md` — seeded R46 P9 forward (2026-08-24/25); for earlier
  history see `TEST_LOG.md` or `git log` directly.
- `PROGRESS.md` — in-flight task scratchpad, overwritten per task; see
  `progress/` (plural directory) for durable per-task records.
- `FOLLOWUPS.md`, `CRR_FILES.md`, `AI_OS_MASTER_PROMPT_GAP_ANALYSIS.md`

## Point-in-time wave/R-numbered reports (historical, not maintained)
`PROGRESS_AIROUTER01.md`, `R48_FUNCTION_CATALOG.md`, `R48_PROGRESS.md`,
`R64_MASTER_CHECKLIST.md`, `WAVE_111_MULTI_COMPANY_AI_OS_TEST_REPORT.md`,
`WAVE_114_DETERMINISTIC_DISPATCH.md`, `VERI_CHAT_MOCKUP_TO_PRODUCTION_SPEC_2026-08-01.md`,
`evaluation_by_ca.md`, `features_to_be_added_claude.md`,
`functional_testing.md`, `main_dashboard_user.md`, `orchestra_changes.md`,
`Study_by_Claude.md`, `Study_by_zaizlm5.2.md`,
`veridian-scope-selector-in-home.html` — read for historical context on a
specific wave/round; don't treat as current state. Not individually
triaged/relocated in this pass (a larger reorg into subdirectories like
`docs/research/` is a separate, still-open follow-up — see
`public.code_quality_inspection_findings`, Supabase project
`pcrjmlpuqsbocqfwoxod`, for the full inventory).

## Other
- `UNIVERSAL_TASK_WRAPPER_DESIGN.md`, `MCP_PROTOCOL.md`,
  `VERIDIAN_HUMAN_INPUT_OUTPUT_TAXONOMY.md`, `VERI_CHAT_COMPOSER_DESIGN.md`
  — design docs for specific subsystems, referenced from `ai-os/` where
  relevant.
