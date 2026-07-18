# PROGRESS -- task-20260718-084003-calculation-engine--calculation-governan

Task: VERIDIAN Review Framework gap closure for 5 findings scoped to the
VCEL calculation-engine module: Calculation Explainability, Calculation
Version Control, Calculation Auditability, Formula Testing Framework, AI
Suggested Calculations. One coherent PR (they share the same module).

## Pre-work fact-check (per task instructions: verify gaps against real code, not the finding descriptions)

Read `ai-os/boss/ACTIVE-CLAIMS.yaml` (no overlapping claim), then did a full
research pass over `src/lib/engines/**`, `src/lib/db/schema.ts`
(`computationEngines`), `src/lib/task-execution-engine.ts`
(`dispatchEngine`/`executeEngineDispatch`),
`src/lib/services/capability-tree-service.ts`, the VERI Chat composer UI,
and `docs/master/CAPABILITY_COVERAGE.md`/`CRITICAL_GAPS.md`/`MODULE_MAP.md`
before writing any code. Findings:

- **The "26 of 211 wired" / "12.3% coverage" figure the task's own finding
  descriptions cite is a stale 2026-07-09/10 doc snapshot**, not current
  code. `capability-tree-service.ts`'s `WIRED_ENGINE_INPUT_FIELDS` and
  `task-execution-engine.ts`'s `dispatchEngine()` switch (last touched
  2026-07-14, 5 days after the doc) actually wire ~160-170 distinct
  engineKeys across ~22 categories -- later waves (167+) wired
  Payroll/Inventory/HR/Accounting/Banking/Procurement/Security/Audit/
  Compliance/Analytics/Logistics/Marketing/PM/CRM/Sales/Fixed
  Asset/Data Quality/Costing and never came back to update
  `CAPABILITY_COVERAGE.md`. Flagged this with a staleness banner at the top
  of that doc rather than silently trusting or silently ignoring it.
  `CRITICAL_GAPS.md`/`MODULE_MAP.md` repeat the same stale figure in their
  own historical narrative entries -- left those two alone (editing a dated
  audit-trail entry felt like the wrong fix; the banner on
  `CAPABILITY_COVERAGE.md`, the actual source these numbers derive from,
  is the one-place fix).
- **None of the 5 findings were already resolved** -- confirmed real gaps
  for all 5 (no version column, no dedicated audit table for engine
  dispatch, zero test files under `src/lib/engines/**`, zero breakdown/
  explainability data in any engine output, no calculator-suggestion UI).
- The "185 unwired engines called directly from service code" framing
  (Auditability finding) doesn't match what's actually in the codebase: a
  repo-wide grep for direct imports of `src/lib/engines/**` outside
  `task-execution-engine.ts` found only format/threshold validators
  (`isValidGstinChecksum`, `isValidEmail`, `isValidPanFormat`,
  `stateCodeFromGstin`, etc.) and 3 GRC read-derivation helpers
  (`computeVendorRiskScore`, `computeSlaStatus`, `computePoshInquiryDeadline`)
  used by routes that already call `logActivity()` for their own parent
  record. None of these are catalogued `computationEngines` rows invoked
  outside the dispatcher -- the real, current shape of the gap is "the
  dispatcher itself has no guaranteed audit trail", which is what got
  fixed (see below). Left the validator/GRC call sites untouched --
  auditing a boolean format check or a read-only SLA-status derivation
  the same way as a statutory tax calculation would be noise, not
  governance.

## Completed
- [x] Read `ai-os/boss/ACTIVE-CLAIMS.yaml`, registered this session's claim
      (calculation-engine module scope), committed + pushed it on its own
      before starting real work, per that file's own protocol.
- [x] **Calculation Version Control** (High): added `engineVersion` (text,
      default `'1.0.0'`), `effectiveFrom`, `effectiveTo` to
      `computationEngines` (`src/lib/db/schema.ts`,
      `drizzle/0225_calculation_engine_governance.sql`). The row still
      holds only the CURRENT version per `engineKey` (not a history
      table) -- the actual "snapshot the version used at calculation time
      on the calling record" requirement is satisfied by
      `calculationInvocations.engineVersion`, written per-invocation (see
      below), so a later version bump never rewrites what an
      already-completed calculation says it used.
- [x] **Calculation Auditability** (Medium): new `calculation_invocations`
      table (org-scoped, FORCE RLS, same posture as
      `crm_accounts`/other Wave-A tables) + `src/lib/engines/
      engine-invocation.ts`'s `invokeEngine()` -- a thin wrapper that
      snapshots the engine's current `engineVersion` and writes a
      success/failure audit row regardless of call path. Wired into
      `task-execution-engine.ts`'s `executeEngineDispatch()`, the single
      real call path for every Chain-Selector-dispatched engine (now
      ~160-170 engines, not the stale 26) -- this closes the audit gap at
      the invocation-layer root, per the finding's own recommended
      approach, rather than re-adding logging call-by-call at every
      dispatch case. Registered the new table in
      `ai-os/registry/asset-registry-coverage.yaml` as exempted (pure
      operational/audit log, same class as the already-exempted
      `prompt_cache_metrics` -- no display-name column, not a discoverable
      platform asset).
- [x] **Calculation Explainability** (Medium): added an optional
      `breakdown: CalculationBreakdown` field (`src/lib/engines/
      breakdown.ts` -- `{ steps: { label, formula?, value }[] }`) to 4
      representative statutory engines spanning the domains the finding
      itself names (income tax, GST, EPF/gratuity) plus TDS:
      `calculateIncomeTax` (per-slab + rebate + cess steps),
      `splitGst` (CGST/SGST vs IGST derivation),
      `calculateGratuity` (Sec 4(2) rounding + formula + cap),
      `computeTdsForSection` (threshold check + Sec 206AA override + amount).
      Deliberately additive/optional -- every other engine's output is
      unaffected. `executeEngineDispatch()` now emits a structured
      `"calculation"` message (new type in `structured-message.ts`,
      rendered by `StructuredMessageContent.tsx`) instead of a raw JSON
      blob whenever the dispatched output carries a `breakdown`; every
      other engine keeps the pre-existing plain `Result: {...}` message,
      unchanged.
- [x] **Formula Testing Framework** (Medium): `src/lib/engines/
      golden-values.test.ts` -- a data-driven golden-value regression
      suite (16 fixtures across Income Tax/GST/Gratuity/TDS/EPS), each a
      real, hand-computed statutory result checked against the actual
      engine function via `toMatchObject`. Adding coverage for another
      engine is a new fixture entry, not new test boilerplate -- this is
      the reusable "framework" the finding asked for, not a one-off
      per-engine test retrofit (which would be a much larger, separately
      scoped effort across all ~211 "implemented" engines; this PR
      establishes the extensible mechanism and seeds it with the 3
      statutory domains + TDS the findings explicitly named).
- [x] **AI Suggested Calculations** (Low): the finding's own recommended
      approach was "consider after Chain Selector wiring improves
      discoverability generally; low value while only 12.3% of engines are
      reachable" -- that premise no longer holds (see fact-check above,
      ~75%+ of implemented engines are now wired). Implemented a minimal,
      real version: `findCalculatorSuggestions()`
      (`ChainSelector.tsx`) walks the already-fetched capability tree for
      deterministic `engineKey` leaves matching the user's in-progress
      chain-picker search text, and `VeriComposer.tsx` renders up to 4 as
      clickable suggestion chips that jump straight to that calculator's
      input form -- reuses the existing search box and tree data, no new
      endpoint or second source of truth.
- [x] Flagged `docs/master/CAPABILITY_COVERAGE.md`'s stale wiring numbers
      with a banner pointing at the real current count (see fact-check
      above) -- did not attempt a full re-count/regeneration of that doc
      (needs a live DB query per its own header; out of scope for this PR).
- [x] Verification: installed `bun` (not present in this environment) and
      ran the full local gate: `bunx tsc --noEmit` (0 errors), `bun run
      lint` (0 errors, same 3 pre-existing unrelated warnings), `bun test`
      (1437 pass / 0 fail, includes the 16 new golden-value tests),
      `bun run build` (succeeded), Guardrail Presence Check (88/88),
      Migration Collision Check (clean), Asset Registry Coverage Check
      (432/432 -- 138 registered, 295 exempted, including the new table),
      Metadata Index Coverage Check (30/30), Doc Quarantine Banner Check
      (44/44), Doc Cross-Reference Check (339/339).

## Remaining
- [ ] Not committed/pushed/PR'd yet (Rule 6 requires branch + PR + green
      CI before merge to main; this session has not opened that PR).
- [ ] Live DB migration (`drizzle/0225_calculation_engine_governance.sql`)
      has not been applied to any real Supabase instance by this session
      -- per AGENTS.md, this worker session doesn't have Supabase MCP
      access; the migration file is ready for whoever runs `db:push`/
      applies migrations for this branch.
- [ ] Formula Testing Framework currently covers 16 golden-value fixtures
      across 4 engine files (Income Tax, GST, Gratuity, TDS/TCS, EPS) --
      the other ~205 "implemented" engines have no golden-value coverage
      yet. The framework itself (fixture array + data-driven runner) is
      complete and extensible; expanding coverage engine-by-engine is
      follow-on work, same scoping logic `GAP_CLOSURE_LOG.md` already used
      for the Chain Selector wiring itself (explicitly rejected doing all
      ~211 in one pass as unreviewable).
  - [ ] Calculation Explainability breakdown is similarly seeded on 4
      representative engines, not all ~160-170 dispatched ones -- the
      mechanism (optional `breakdown` field + structured-message
      rendering) is real and complete; extending it to more engines is
      additive follow-on work per engine, not a blocker.
