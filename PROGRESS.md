# PROGRESS -- task-20260727-122632-projexa-e2e--hierarchical-boq-breakdown

## Completed
- [x] Read ai-os/boss/ACTIVE-CLAIMS.yaml, confirmed no collision, registered claim

## Remaining
- [ ] Explore existing code: constructionBoqLineItems schema, construction-boq-service.ts, firm-billing-service.ts, spreadsheet-adapter.ts
- [ ] Schema migration: parentLineItemId + breakdownPercentage on constructionBoqLineItems
- [ ] construction-boq-service.ts: hierarchical amount computation + hierarchy-aware revision diff
- [ ] construction-valuation-service.ts: interim/RA billing + retention % + invoice emission
- [ ] Excel BoQ importer: service + API route
- [ ] Tests: hierarchy formula, interim-bill + retention, Excel import
- [ ] npx tsc --noEmit clean, bun test passing, get_advisors(security) clean
- [ ] Open PR
