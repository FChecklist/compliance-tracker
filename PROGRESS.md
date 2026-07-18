# PROGRESS -- Cost estimate: 5 orgs x 10 users (50 total), all modules

Task: produce docs/analysis/cost-estimate-5org-50user.md, a guesstimate of
monthly infra + AI cost to run VERIDIAN AI OS / compliance-tracker / PROJEXA
at 5 orgs x 10 users = 50 users, using all real modules found in the repo.
Analysis-only deliverable -- no application code changes.

## Completed
- [x] Read governance docs (AGENTS.md, CLAUDE.md, ai-os/CONSTITUTION.yaml
      pointers) and ai-os/boss/ACTIVE-CLAIMS.yaml -- no existing claim
      overlaps this analysis-only task; registered this task's own claim.
- [x] Enumerated real module/feature scope: 84 top-level `(app)/*` feature
      areas (138 page.tsx), 129 top-level `api/*` route groups (878
      route.ts), 431 DB tables (schema.ts), 198-role AI worker-agent roster
      (roster.ts), PROJEXA confirmed as an alias layer over the same
      compliance-tracker engines (api/v1/projexa/* = 164 route.ts files),
      construction/interior verticals real in schema+API but with no
      dedicated `(app)/` UI yet (noted as a scope caveat).
- [x] Found and read the real Token Usage Ledger
      (src/lib/services/token-usage-service.ts, schema.ts's
      `tokenUsageLedger`) and cost-guard.ts (opt-in per-org monthly cap,
      no default cap set).
- [x] Found and read real recorded usage data:
      docs/testing/PROJEXA_LOAD_TEST_RESULTS.md -- 499 real production
      `task_oa` calls, actual prompt/completion token counts and cost,
      3.4% escalation rate floor-tier -> GLM-5.2. Used as the grounding
      anchor for per-interaction token-size assumptions instead of
      guessing from scratch.
- [x] Read src/lib/llm-client.ts (MODEL_PRICING table, provider dispatch,
      prompt-cache wiring -- Anthropic-only, Phase 1) and
      src/lib/orchestra-model-resolver.ts (Groq floor tier default,
      Cerebras same-model failover, GLM-5.2 OpenRouter escalation, 3 real
      orchestra layers actually reachable: task_oa, user_assistant_oa,
      customer_account_oa).
- [x] Checked ai-os/MASTER-TRACKER.yaml / CONSTITUTION.yaml for prior cost
      governance decisions (cost-cap enforcement default-true finding,
      no AI_COST_GOVERNANCE-named entry exists by that literal name;
      ai-os/CONTROLLER.yaml does not exist in this repo/workspace -- only
      the separate claude-control meta-repo's CONTROLLER.yaml, checked for
      the CACHE-01 prompt-caching framework context instead).
- [x] Web-verified CURRENT real pricing (2026-07-18) for every wired
      provider/model: Groq gpt-oss-120b, Cerebras gpt-oss-120b, OpenRouter
      GLM-5.2, Groq llama-4-scout (vision), Anthropic Claude Sonnet 5,
      Vercel Pro, Supabase Pro + compute tiers. Found and flagged a real
      discrepancy: the codebase's own MODEL_PRICING entry for Groq's
      floor-tier model understates real current Groq pricing by
      roughly 3.3-4x (verified independently against groq.com/pricing).
- [x] Built the per-user monthly interaction-volume model (Low/Mid/High
      usage scenarios) grounded in the real load-test token sizes, and the
      infra sizing (Vercel + Supabase tier recommendation) for 50 users /
      431 tables.
- [x] Wrote docs/analysis/cost-estimate-5org-50user.md with full reasoning,
      sources, math, and a stated confidence range (not a single false-
      precision number).

- [x] Quality-gate follow-up: a "quality gate checks failed" instruction
      arrived with an empty gate-output body (no failing check names/errors
      included). Ran every mechanical gate this repo actually defines
      against a fresh `bun install`, to check for a real, reproducible
      problem rather than guessing: `bun run lint` (0 errors, 3 pre-existing
      unrelated warnings), `bunx tsc --noEmit` (0 errors), `bun run build`
      (succeeded), `bun test` (1388 pass / 0 fail), Guardrail Presence Check
      (88/88), Asset Registry Coverage Check (431/431 tables), Metadata
      Index Coverage Check (30/30), Doc Quarantine Banner Check (44/44),
      Doc Cross-Reference Check (339/339 references resolved), and manual
      YAML-parse validation of the one file this task hand-edited
      (ai-os/boss/ACTIVE-CLAIMS.yaml). All pass cleanly -- nothing to fix
      was found. Asked the user for the actual failing-check output before
      changing anything further, rather than silencing or guess-patching a
      check that isn't actually failing here.

## Remaining
- [ ] Awaiting the actual quality-gate failure output from the user (the
      message that triggered this follow-up arrived with no gate output
      attached) -- nothing else outstanding. Once real failing checks are
      identified, fix the underlying issue they point to (not just the
      checker). Deliverable itself (docs/analysis/cost-estimate-5org-50user.md)
      remains complete and unchanged since the last full pass.
- [ ] Not committed/pushed/PR'd yet (Rule 6 still requires branch + PR +
      green CI before merge to main; this session has not opened that PR).
