# Configuration vs. Hardcoding -- the trade-off pattern

VERIDIAN Review Framework gap-closure (task-20260718-115004-retry-1--
ai-engineering-quality--logic), **[Medium] Configuration Over Hardcoding**:
"Mixed configuration posture -- some deliberate hardcoding." Recommended
approach (the finding's own words): "Leave as-is unless a real per-org
tuning need emerges; document the trade-off pattern for consistency."

This doc is that documentation. It does not change any code -- the finding's
own recommendation is to leave the current mix as-is. What follows is the
criteria this codebase already applies (implicitly, across many waves) for
choosing configuration over hardcoding, written down explicitly so future
work makes the same call consistently instead of re-deriving it ad hoc.

## The standing policy this operationalizes

`ai-os/AI_ENGINEERING_POLICY.yaml`'s `always_prefer` list states `metadata:
over hardcoding` and `configuration: over programming` as defaults, and its
`continuous_optimization_checklist` asks "can this be configuration?" while
building anything. That's the default direction. This doc is the other
half: the real, recurring reasons this codebase has knowingly chosen
hardcoding *over* that default, so a future reviewer can tell "mixed
posture" apart from "inconsistent posture."

## When this codebase configures (the default)

Configure via DB-backed, admin-editable rules when:

- **The value changes on a schedule this codebase doesn't control.**
  `erp_statutory_rules` (Wave 56) holds India's PF/ESI/Professional-Tax
  rates/ceilings/slabs as admin-editable master data specifically because
  they change via periodic government notification -- hardcoding a rate
  that the government revises would silently go stale.
- **Different orgs/projects/clients legitimately need different behavior
  for the same module.** `module-rules-resolver.ts`'s `resolveModuleRule()`
  (Wave 21) generalizes `orchestra-model-resolver.ts`'s
  `resolveModelConfig()` "most-specific-scope-wins" pattern (`user -> client
  -> project -> org -> productBranch -> platform`) across module behavior,
  so an org/client/project can override a threshold or trigger condition
  via data, never a code fork. Proven on 3 modules (risk severity matrix,
  incident regulatory-notify trigger, POSH complaint classification
  ceiling); deliberately not rolled out to the other ~37 GRC modules yet
  (see "When leaving something hardcoded is still correct" below).
- **The value is genuinely platform-wide catalog data, not code.**
  `module_registry` / `product_branches` (no `org_id` column, by design) are
  DB rows a migration seeds, not a hardcoded array in a `.ts` file --
  because the catalog itself needs to be queryable and grow without a
  deploy.
- **A prompt is content, not logic.** Every LLM-facing prompt lives in
  `promptTemplates`/`promptVersions` (Wave 22-23's Prompt Operating
  System) with `production`/`staging` labels, replacing what used to be
  hardcoded prompt strings across 5 files/8 template keys -- prompt text
  changes far more often than the code that calls it, and needs review/
  rollback independent of a deploy.

## When this codebase deliberately hardcodes anyway

Hardcoding is the deliberate, sanctioned choice -- not oversight -- when:

- **The set is small, curated, and meant to stay fixed by design.**
  `src/lib/ai-team/roster.ts`'s 198-role `AI_TEAM_ROSTER` is, per its own
  header, "a deliberately fixed template backbone... explicitly not meant
  to grow per-task." This is VERIDIAN's own internal org chart, not a
  customer-facing catalog -- making it admin-editable configuration would
  invite per-task role sprawl the design intentionally avoids.
- **Automating the value carries real correctness/compliance risk without
  a domain expert's sign-off.** TDS (Tax Deducted at Source) in the Indian
  statutory-payroll engine is explicitly *not* auto-computed, even though
  its PF/ESI/PT siblings are fully configurable -- correct TDS depends on
  regime choice, exemptions, and annual slab projection, and getting it
  wrong is an incorrect statutory deduction with real legal exposure. The
  payslip has a manually-entered TDS line instead. This is a named,
  deliberate scope boundary (`ERP_BENCHMARK_COMPARISON.md`), not a gap to
  close by force.
- **No real per-org tuning need has actually emerged yet.** The ~37 GRC
  modules `module-rules-resolver.ts` hasn't been wired into yet still use
  their original hardcoded thresholds -- named explicitly in
  `PLATFORM_STRATEGY.md` as "deliberate scope discipline... not oversight."
  Building configurability for a need nobody has asked for yet is its own
  cost (more surface to test, more places behavior can silently diverge
  per org) with no offsetting benefit until a real org actually needs a
  different value. This finding's own recommendation ("leave as-is unless
  a real per-org tuning need emerges") is this exact rule, restated for one
  more area.
- **A value is genuinely infrastructure, not business behavior.** Provider
  identifiers and pricing tables in `MODEL_PRICING`
  (`src/lib/llm-client.ts`) are literal constants, not per-org
  configuration -- they describe what a provider's API actually costs, a
  fact about the world, not a policy choice a customer org should be able
  to override.

## The actual rule, stated once

> Configure when the value legitimately varies **per org/client/project**,
> or changes on a schedule this codebase doesn't control (regulatory
> notification, provider pricing). Hardcode when the set is small and
> meant to stay fixed by design, when automating it needs a domain
> expert's sign-off this codebase can't manufacture, or when no real
> per-org need for variability exists yet. Don't build configurability
> speculatively -- that's its own maintenance cost, not a free safety
> margin.

This is a restatement of the finding's own recommended approach, made
concrete with the codebase's own real precedents so the next module that
faces this choice doesn't have to re-derive the reasoning, or the specific
prior examples, from scratch.
