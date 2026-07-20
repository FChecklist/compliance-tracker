# PROGRESS -- task-20260720-022700-superboss-v2-plan--finish-the-uae-countr

## Completed
- [x] Read governance (ACTIVE-CLAIMS, CONSTITUTION, SUPERBOSS v2 plan §1.1/§2/§4 V2-1)
- [x] Collision check: no active claim touches UAE engines / compliance-engine-registry.ts / erp-einvoice-service.ts / statutory-rule enum
- [x] Map existing country-config architecture (finding: scaffolded-but-unwired — see note below)
- [x] Register ACTIVE-CLAIMS claim + push on its own commit

## Remaining
- [ ] Build UAE engines (`src/lib/engines/ae/vat-engine.ts` + `corporate-tax-engine.ts`) — real FTA statute logic
- [ ] Register UAE (`ae`) in `compliance-engine-registry.ts`
- [ ] Add country-config e-invoice FORMAT path in `erp-einvoice-service.ts` (UAE FTA JSON alongside India IRP JSON, chosen on `organisations.country`)
- [ ] Statutory-rule + tax-slab seed for both India and UAE
- [ ] Shared country-config test suite (both countries resolve through `getComplianceEngine()`, no India hardcoding)
- [ ] tsc/lint/test clean; open PR with done-criteria evidence

## Architecture note (starting point)
The "existing country-config abstraction" V2-1 builds "behind" is thin:
`getComplianceEngine()` (`src/lib/engines/compliance-engine-registry.ts`) has
**zero production callers** (only a schema comment references it); only the `in/`
(India) engines are registered; `organisations.country` is unused by the
e-invoice path; `erp-einvoice-service.ts` is hardcoded to India's IRP schema
(`TaxSch:"GST"`, GSTIN, HSN, `gstin.slice(0,2)` state code, `GstRt: 0` per-line
— the V2-21 gap). No UAE/TRN/AE code and no statutory-rule seed exist in this
repo. The plan's "UAE tax-field work already started in Priority 19 Part 2" was
done in the **projexa** repo (Workstream C gated GSTIN/GST/income-tax-slab UI
fields on `country==='IN'`), not here — so the compliance-tracker half is
genuinely unbuilt. Real V2-1 build = UAE engines + registry registration +
country-config e-invoice format + seed + shared tests.
