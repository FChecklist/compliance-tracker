# PROJEXA orchestra-layer scoping — recommendation

Follow-up to [PROJEXA_LOAD_TEST_RESULTS.md](./PROJEXA_LOAD_TEST_RESULTS.md) §4.5's finding: only 1 of the 7 registered orchestra layers (`task_oa`) is currently reachable by PROJEXA. This note answers the open question raised there — should `page_agent_oa`, `global_intelligence_oa`, and `meta_oa` be built out for PROJEXA specifically?

## `page_agent_oa` — build only after PROJEXA has a UI, not before

This layer is real client-side DOM-control (`/api/page-agent/proxy`) — it has nothing to attach to until PROJEXA has actual pages. Building this out now, ahead of a UI, would mean designing a DOM-control surface for pages that don't exist yet — pure speculation. **Recommendation: revisit this once/if PROJEXA gets a dedicated frontend, not before.** The VERIDIAN full-platform load test (2026-07-10) deliberately scoped this layer out for the same reason and instead validated it's architecturally reachable in principle (a real route exists) without exercising it.

## `global_intelligence_oa` — has zero call sites anywhere, not just for PROJEXA

This isn't a PROJEXA-specific gap — grepping the full codebase turns up no consumer of this layer for *any* product. It's designed (cross-tenant, anonymized/aggregate pattern recognition feeding the global worker-agent tier) but never implemented. **Recommendation: this is a platform-wide backlog item, not something to build PROJEXA-first.** If/when it's built, PROJEXA's construction-specific worker agents (`get_construction_budget_status`, `list_over_budget_projects`, etc.) would be natural early consumers — cross-project budget-risk patterns are exactly the kind of aggregate signal this layer was designed for — but that's a reason to prioritize it in a future platform-wide wave, not to special-case PROJEXA today.

## `meta_oa` — correctly platform-internal, should stay that way

This is the self-improvement loop supervisor overseeing the other 4 layers (`loop-engineering-audit.ts`). It was never meant to be a per-task, per-product path — it's infrastructure watching infrastructure. **Recommendation: no change needed.** Nothing about PROJEXA specifically should route through this; it already implicitly covers PROJEXA's `task_oa` usage as part of overseeing `task_oa` platform-wide.

## Bottom line

Of the 3 layers PROJEXA doesn't currently reach, only `page_agent_oa` has a plausible near-term path to PROJEXA-specific use, and that's gated on PROJEXA getting a UI — not a load-testing or orchestra-wiring gap. The other 2 are platform-wide backlog items where PROJEXA is, at most, a good future early adopter. **The original "5 loops" framing in earlier discussion should be retired** in favor of the accurate 7-layer inventory in `PROJEXA_LOAD_TEST_RESULTS.md` §4.5 — most products, PROJEXA included, are correctly served by a smaller working subset, not all 7.
