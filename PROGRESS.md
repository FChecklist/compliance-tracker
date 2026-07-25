# PROGRESS -- task-20260725-231836-phase2-prompt-compiler-pipeline-core-non

VERIDIAN_Architecture_v2.0 phase_2_compiler_pipeline_intelligence_engines.
Extends scripts/prompt_gateway/engine/{classifier,prompt_engine,context_engine}.py
into compliance-tracker's own src/lib/prompt-compiler/ TypeScript module.

## Completed
- [x] Read governance docs (ACTIVE-CLAIMS, CONSTITUTION, phase plan, gap analysis, owner directive)
- [x] Confirmed OWNER_DECISIONS_NEEDED_2026-07-23.yaml veridian-architecture-v2-target-repo-anchor is `approved`
- [x] Read scripts/prompt_gateway/engine/{classifier,prompt_engine,context_engine}.py in full
- [x] Read phase_1 deliverables (prompt-os-service.ts, schema.ts promptVersions) + existing real prior art (embeddings.ts, capability-registry-service.ts prompt_pattern precedent, prompt-eval-service.ts, prompt-normalizer.ts, llm-client.ts cost functions)
- [x] Registered ACTIVE-CLAIMS entry + closed phase_1's entry to recently_completed (pushed)

## Remaining
- [ ] src/lib/prompt-compiler/types.ts -- shared types
- [ ] entity-variable-extraction.ts (engine-entity, engine-variable)
- [ ] intent-classifier.ts (engine-intent deepen: multi-level primary/secondary/implicit)
- [ ] context-assembly.ts (pipeline-context-assembly deepen: session history + business + user context)
- [ ] prompt-construction.ts (engine-prompt-compiler deepen + pipeline-prompt-construction deepen: noise removal reuse, compression, hash/fingerprint, semantic-cache lookup, writes compiled contract to prompt_versions)
- [ ] prompt-optimizer-expansion.ts (engine-prompt-optimizer, engine-prompt-expansion)
- [ ] capability-registry-service.ts: add `prompt_version` entity type + indexPromptVersion/findSimilarPromptVersions
- [ ] prompt-similarity.ts (engine-prompt-similarity, wraps the above)
- [ ] prompt-ranking-recommendation.ts (engine-prompt-ranking, engine-prompt-recommendation)
- [ ] confidence-engine.ts (engine-confidence deepen: multi-signal)
- [ ] verification-pipeline.ts (pipeline-verification: business/workflow/capability/permission + cost + model selection)
- [ ] prompt-portability.ts (engine-prompt-portability)
- [ ] prompt-ab-testing.ts (engine-prompt-ab)
- [ ] prompt-testing-benchmark.ts (engine-prompt-testing deepen, engine-prompt-benchmark deepen -- shadow comparison, no new eval schema)
- [ ] pipeline.ts (Layer 2-5 orchestrator with per-stage latency vs 15/25/30/30ms budgets)
- [ ] index.ts barrel export
- [ ] Colocated *.test.ts for every pure/deterministic function (bun test)
- [ ] scripts/prompt-compiler-smoke-test.ts (this phase's SUCCESS_CRITERIA command)
- [ ] bunx tsc --noEmit clean, bun test clean, eslint clean
- [ ] Register knowledge_engine entry ("veridian_v2_compiler_pipeline", domain:veridian_architecture_v2) via /opt/veridian/scripts/superboss-register.py
- [ ] Update claude-control's VERIDIAN_ARCHITECTURE_V2_PHASE_PLAN_2026-07-25.yaml phase_2 status -> done with evidence
- [ ] Commit + push, open PR
