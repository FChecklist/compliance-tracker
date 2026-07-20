# PROGRESS -- task-20260720-022700-superboss-v2-plan--finish-the-uae-countr

## Completed
- [x] Read governance (ACTIVE-CLAIMS, CONSTITUTION, SUPERBOSS v2 plan §1.1/§2/§4 V2-1)
- [x] Collision check: no active claim touches UAE engines / compliance-engine-registry.ts / erp-einvoice-service.ts / statutory-rule enum
- [x] Map existing country-config architecture (finding: scaffolded-but-unwired — see note below)
- [x] Register ACTIVE-CLAIMS claim + push on its own commit (3810ef9f)
- [x] Build UAE VAT engine (`src/lib/engines/ae/vat-engine.ts`) — real FTA Decree-Law No. 8/2017 logic (5% standard, zero-rated vs exempt distinction, input-tax recovery apportionment, reverse charge, TRN validation, late-payment penalty, return validation)
- [x] Build UAE corporate-tax engine (`src/lib/engines/ae/corporate-tax-engine.ts`) — FTA Decree-Law No. 47/2022 (0% ≤ AED 375k, 9% above, 9% on QFZP non-qualifying slice, Pillar Two 15% top-up for MNEs ≥ EUR 750M)
- [x] Register UAE (`ae`) in `compliance-engine-registry.ts` (wire `getComplianceEngine('AE')`) — per-country slots, not a forced uniform shape
- [x] Add country-config e-invoice FORMAT path in `erp-einvoice-service.ts` + new `einvoice-format.ts` (UAE FTA Peppol UBL alongside India IRP JSON, chosen on `organisations.country`) + fix the V2-21 per-line `GstRt: 0` gap (real tax-template rate per line)
- [x] Shared country-config test suite (`country-config.test.ts`) — both IN + AE resolve through `getComplianceEngine()` with no India hardcoding; unregistered country throws
- [x] E-invoice country-config test suite (`einvoice-format.test.ts`) — both IN + AE resolve through `buildEInvoicePayload`; no IRP schema leaks into AE payload; V2-21 GstRt fix asserted
- [x] tsc clean / lint clean / guardrail-presence 88 markers / full suite 1842 pass 0 fail / `next build` exit 0
- [x] Commit + push + open PR (#492)
- [x] Resume pass: merge `origin/main` (moved since branch point) — PR was CONFLICTING, now MERGEABLE. Conflict was only in governance/tracking files (PROGRESS.md rotating per-task file — kept this branch's V2-1 content; the V2-6 task's progress is in COMPLETED.yaml, not lost). One mechanical indentation fix to the V2-6 entry's `scope_note` key in ACTIVE-CLAIMS.yaml (came in malformed on main via PR #491: `scope_note` at col 2 with no list-marker broke the YAML sequence; indented to col 4 to nest as a fourth key in the V2-6 list item). No V2-1 code files touched by the merge. Re-ran full gauntlet green: tsc 0 / lint 0 err (3 pre-existing warnings) / guardrail 88 / metadata-index 39 / 1842 pass 0 fail / build exit 0.

## Remaining
- [ ] Statutory-rule + tax-slab seed for both India and UAE — **DEFERRED, see STATUS note** (Tier2: per-org master-data tables, no country column; not a V2-1 code task)

## STATUS — DONE CRITERION met
The V2-1 DONE CRITERION ("UAE + India both pass the same country-config
test suite") **is met**: both countries resolve through one
`getComplianceEngine()` path (and one `buildEInvoicePayload()` path for
e-invoicing), each exposes its own real statute slots (no forced uniform
shape), and an unregistered country still throws rather than silently
defaulting to India. 28 V2-1 tests green; the full 1842-test suite green;
tsc/lint/build/guardrail-presence all green.

(A prior resume checkpoint's STATUS said this was WIP with only the VAT
engine landed — that was stale. The corporate-tax engine, registry wiring,
e-invoice format module, and both test suites were already built; this
resume pass fixed one real bug the suite caught — the UAE `schemeID`
attribute was a sibling of `CompanyID` instead of on it (UBL wants it as an
attribute of the identifier) — cleaned a malformed JSDoc line, and ran the
full CI gauntlet to confirm green.)

## Why the statutory-rule/tax-slab seed is deferred
`erp_statutory_rules` and `erp_income_tax_slabs` are **per-org master data**
(`orgId NOT NULL`, no `country` column) that the schema comments explicitly
state must **NEVER be hardcoded in code** ("rates come from a periodic
government notification … an org must set these up, admin-editable"). The
existing `src/db/seed.ts` is a one-org demo-data seed and does not seed
either table today — by design, not by oversight. Seeding India + UAE
statutory rules would require either a second demo org to attach UAE rows
to, or a schema change (add a `country`/global-seed column) — both are
**Tier2** (schema touched), which the task constraints say "always holds
for Owner sign-off, no exceptions, regardless of audit verdict." The
genuinely-multi-country code (engines + registry + e-invoice format) is
the V2-1 work; the per-org statutory master data is a separate tranche.

## Architecture note (starting point, now resolved)
The "existing country-config abstraction" V2-1 builds "behind" was thin
and is now wired: `getComplianceEngine()` (`compliance-engine-registry.ts`)
binds BOTH India (incomeTax/tds/gst) and UAE (vat/corporateTax) with
per-country slots; `erp-einvoice-service.ts` routes on
`organisations.country` through `buildEInvoicePayload()` (India IRP JSON
vs UAE FTA Peppol UBL); the per-line `GstRt` now carries the resolved
tax-template rate (V2-21 fix). No India hardcoding remains in the service
path. Production callers of `getComplianceEngine()` remain zero (the
registry is the abstraction layer for future country packs, not yet
called from an API route) — wiring a caller is a separate task, not V2-1's
"prove the architecture generalizes" scope.
