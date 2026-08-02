# VERIDIAN Master AI OS — Architecture, Rules & Guardrails

> **AUTHORITY NOTE (2026-07-14):** `ai-os/CONSTITUTION.yaml` is now the single, machine-readable constitution for VERIDIAN AI OS and is authoritative over this document on any conflict (see its `architecture_rules` section, IDs ARCH-01 through ARCH-09). This document remains as detailed narrative evidence and reasoning -- read it for full context and worked examples, not to determine current status.

**Version 1.0 -- 2026-07-06. Governs every current and future product branch under VERIDIAN AI OS.**

This document is not aspirational. Where a rule is marked **[ENFORCED]**, a real, running mechanism verifies it, cited by file:line. Where a rule is marked **[POLICY ONLY]**, it is a governance decision not yet backed by code -- named honestly as a gap, not glossed over, consistent with `VERIDIAN_AI_CONSTITUTION.md` and `AI_OS_CERTIFICATION.md`'s own discipline.

---

## 1. Purpose and Scope

VERIDIAN AI OS is the **master platform**: one tenant, one identity, one AI Orchestra, one knowledge graph. Distinct branded products -- "VERI OFFICE AI OS," "VERI EASY AI OS," "VERI MANUFACTURING AI OS," and every future "VERI X AI OS" -- are not separate applications. They are **product branches** an org can enable, disable, and combine freely on top of the same tenancy, AI resolution, and data model.

This document governs *product/branch/schema architecture*: how a new vertical registers itself, what it may and may not duplicate, and what every new table/AI surface must carry from day one. It does not govern AI behavior -- that is `VERIDIAN_AI_CONSTITUTION.md`'s job. The two documents do not overlap: this one answers "how does a new vertical get built correctly," that one answers "what is any AI model allowed to do."

## 2. Branch-Key Naming Rule

**[ENFORCED via unique constraint on `product_branches.branch_key`, `src/lib/db/schema.ts`]** -- no two branches can share a key; this has been true since Wave 20.

**[POLICY]** -- a `branchKey` is lowercase snake_case and matches the vertical's internal name, never its marketing name (`ecommerce`, not `veri_easy`). The marketing name lives in `displayName`/`tagline` only. Checked at PR review / seed-migration-authoring time, not by any running code.

## 3. Module-Reuse-Not-Duplication Rule

**[ENFORCED via `product_branch_modules`' many-to-many shape]** -- a `moduleKey` is never copy-pasted into a second `moduleRegistry` row for a second branch that needs the same underlying table. `productBranchModules` links one `moduleKey` to as many `productBranchId` rows as needed; there is no uniqueness constraint preventing this (`src/lib/db/schema.ts:910-916`). The enforced read path is `listEnabledModulesForBranch()` in `module-registry-service.ts`.

**Worked example (already in this wave's migration):** the `procurement` branch (Wave 106) reuses the exact same `moduleKey` rows the `erp` branch already registered for RFQ/Purchase Orders/Vendor Master/GRN -- zero new `moduleRegistry` rows, zero new tables, one new `productBranches` catalog entry.

## 4. RLS-Is-Mandatory Rule

**[ENFORCED, but only by discipline -- there is no automated CI check yet]** -- every new org-scoped table for every new vertical ships with the `app_runtime_org_scoped` + `service_role_bypass_<table>` policy pair, in the *same migration* that creates the table, never a follow-up. Verbatim template:

```sql
ALTER TABLE compliance.<table> ENABLE ROW LEVEL SECURITY;
DO $$ BEGIN
  CREATE POLICY app_runtime_org_scoped ON compliance.<table> FOR ALL TO app_runtime
    USING (org_id = compliance.current_org_id());
EXCEPTION WHEN duplicate_object THEN NULL; END $$;
DO $$ BEGIN
  CREATE POLICY service_role_bypass_<table> ON compliance.<table> FOR ALL TO service_role USING (true);
EXCEPTION WHEN duplicate_object THEN NULL; END $$;
GRANT SELECT, INSERT, UPDATE, DELETE ON compliance.<table> TO app_runtime;
GRANT SELECT, INSERT, UPDATE, DELETE ON compliance.<table> TO service_role;
```

(copied verbatim from `drizzle/0016_wave19_code_change_requests_and_products.sql`.) No new vertical table ships without both policies present. `get_advisors` (security) is run after every migration precisely to catch a lapse here.

## 5. `layerKey` Namespacing Rule

**[POLICY, lint-enforced via `assertValidLayerKey()`, `src/lib/services/product-branch-service.ts`]** -- `orchestraLayers.layerKey` is free text with no schema-level uniqueness or format constraint (`src/lib/orchestra-model-resolver.ts` does an exact-string match; nothing joins on a branch relationship). A real FK column was considered and rejected for this wave -- it would require migrating every existing seed row and deciding what platform-global layers like `orchestrate`/`page_agent_oa` belong to, for zero behavioral gain, since the resolver never needs to join on it.

Instead: every **new** orchestra layer introduced by a vertical is named `{branchKey}_{agent}_oa` (e.g. `ecommerce_catalog_oa`, `manufacturing_bom_oa`), continuing the existing `_oa` suffix convention. Pre-existing flat-string layers (`orchestrate`) are grandfathered, never renamed. **Correction 2026-07-14**: `page_agent_oa` was a 2nd grandfathered flat-string layer until PageAgent's removal from VERIDIAN that day (see `ai-os/CONSTITUTION.yaml`'s `browser_client_architecture.BROWSER-01`) -- the layer-key naming convention itself is unaffected by that removal. `assertValidLayerKey(branchKey, layerKey)` is the one central helper any future seed script/service should call to check this before inserting a new layer row.

## 6. Purpose-Bound-AI Domain-Per-Vertical Rule

**[ENFORCED]** -- every branch that ships *any* AI tool surface must add its own key to `DOMAIN_ALLOWED_TOOLS` (`src/lib/purpose-bound-ai.ts`) on day one, even if the initial `Set` is empty. This matches the existing precedent: `project_management: new Set([])` and `erp: new Set([])` were added the moment those branches existed, before either had a real AI tool. A branch with live AI features and no `DOMAIN_ALLOWED_TOOLS` entry is a shipping bug, not a gap to fix later -- `isToolAllowedForDomain()` denies by default for any unknown domain.

## 7. License Discipline Rule

**[POLICY]** -- carried over from this session's E-Commerce AI OS discussion, generalized to every future vertical. Study and adapt open-source *architecture and features* the way `PLATFORM_STRATEGY.md` §13/§15 already document doing for Huly, OpenProject, Plane, and other studied repos -- never copy their source code, never depend on or vendor AGPL/BUSL/SSPL-licensed code into VERIDIAN's proprietary codebase. Every future vertical's research pass must produce the same per-repo license-plus-verdict table `PLATFORM_STRATEGY.md` §13.1/§15.1 already model, before any code is written against a studied project's ideas.

Known risk list from the E-Commerce research pass, applicable to any vertical drawing on the same tools: NocoDB, Appsmith, Twenty CRM, Plane, and Docmost are AGPL (copying their source into a hosted SaaS product legally obligates releasing modifications); Directus is BUSL (not OSI open source, restricts competing-service use); ERPNext and Odoo mix GPL/LGPL/proprietary licensing. Medusa, Saleor core, Vendure, Bagisto, Shopware core, Spree, and Chatwoot core are MIT/BSD -- safe to literally reuse code from, if that's ever faster than adapting.

## 8. Data-Consent / Knowledge-Graph Anonymization Rule

**[POLICY ONLY -- no knowledge graph exists yet]** -- `VERIDIAN_AI_CONSTITUTION.md` §8 already states the principle in the abstract (no leaking between companies "except explicitly-designed and anonymized platform-wide Worker Agent learning"). This section makes it concrete for the specific future capability discussed in the Master AI OS strategy conversation: a knowledge graph correlating patterns across tenants (which product images convert, which campaign structures perform, which pricing strategies work) to benefit new sellers/customers.

Before that capability is ever built, three conditions must hold: (a) cross-tenant learning is opt-in per org, never default-on; (b) any signal used to improve a shared/platform-tier model or Worker Agent is stripped of org-identifying and entity-level identifiers before use; (c) the transformation is never reversible back to a source org. This is a precondition for that future build, not a retrofit to apply after the fact.

## 9. Product Catalog Governance

**[ENFORCED by convention, matching `moduleRegistry`'s existing posture]** -- `product_branches` rows are inserted/updated only by migration, never by any application route. The same posture already documented for `moduleRegistry` (`src/lib/db/schema.ts:860-864`: "catalog mutation is a migration-only, Layer-1 action") now applies explicitly to the catalog table this wave upgraded.

The catalog's new `build_tier` column (`'repackage' | 'moderate_build' | 'ground_up'`) is the platform's real, queryable roadmap -- not a separate document that can drift out of sync. As of Wave 106:

| Tier | Meaning | Current members |
|---|---|---|
| `repackage` | Modules already fully built; work is a catalog row + module linkage + nav grouping | `office`, `procurement`, `cs_firm`, `hr`, `sales` (plus `grc`/`erp`/`pms` already live) |
| `moderate_build` | Real new schema, but on strong existing primitives (multi-entity, multi-currency, warehouses, HSN-SAC, e-invoicing, batch/serial, the client hierarchy, CLM, the webhook dispatcher) | `law_firm`, `distribution`, `export_import`, `pharma_distribution`, `franchise` |
| `ground_up` | Little to no schema overlap; genuinely new core domain entities | `ecommerce`, `manufacturing`, `construction`, `logistics`, `facilities_management`, `healthcare`, `school`, `hotel`, `restaurant` |

## 10. Explicit Corrections to Prior Assumptions

Recorded here so neither silently re-enters as assumed fact in a future planning pass:

- **VERI FM (Facilities Management + security guard services) is NOT built.** A grep for `facilities|security_guard|fm_asset` across `schema.ts` returns zero matches. It is registered in this wave's catalog as `status='planned'`, `build_tier='ground_up'` -- the most ground-up of every planned vertical, not "already part of build."
- **`clients.branchId` is not a product-branch reference.** It foreign-keys the unrelated `branches` table (`src/lib/db/schema.ts:62`) -- an org's own physical office/location (e.g. "Mumbai branch"), not `productBranches`. CA Firm / Law Firm's "one firm, many client companies, each possibly on a different vertical" need is genuinely unbuilt: the `clients` → `clientEntities` → `userClientAccess` hierarchy is reusable in shape (generalized, not compliance-specific), but nothing today links a client to a product branch.
- **VERI PROCUREMENT genuinely is already built** -- RFQ (reverse auction, weighted scoring, Wave 83), Purchase Orders, Vendor Master (KYC/banking/sanction screening, Wave 80), and GRN three-way-match (Wave 85) all exist inside ERP today. Registered `status='live'` in this wave's catalog.
- **VERI LAW FIRM and VERI CS FIRM are further along than a from-scratch build**, but not yet "live": Legal Matter Management + Arbitration + Legal Spend (Wave 90) and CLM (Wave 71/88) exist for Law; Company Secretarial's Statutory Registers/Cap Table/Charges/Secretarial Audit/MCA e-Filing (Wave 28) exist for CS. Both registered `status='planned'`, `build_tier='moderate_build'` -- the remaining work (wiring the client hierarchy as the primary interaction model, for Law specifically) is real, not zero.
- **The `erp` and `office` branches have no enablement UI.** `erp` has existed as a real catalog row since Wave 49 but was never wired to an admin toggle or `AppSidebar` gating -- its nav section is unconditionally shown. This wave adds `office` as a catalog row with a **mandatory enablement backfill** (every existing org gets an explicit `isEnabled=true` row) precisely so the catalog is complete, but deliberately does **not** add UI gating for either `erp` or `office` in this wave. Building a toggle with no way to ever flip it to "off" for any real org would hide working pages for zero behavioral benefit -- the same reasoning `AppSidebar.tsx`'s own comment already gives for `erp`. Tracked here as a named, open gap, not silently left inconsistent.

## 11. How this differs from the user's original proposal

Adopted near-verbatim: the "one master OS, many branded verticals" structure; all 19 named verticals (VERI EASY through VERI RESTAURANT), registered in the catalog exactly as named; the instruction to build rules/guardrails/schema/architecture before any single vertical's business logic.

Adapted: two claims in the original proposal were corrected against the actual codebase rather than taken at face value -- VERI FM is not built (the user believed it was), and the CA Firm/Law Firm client hierarchy is reusable in shape but does not already link a client to a product branch. The 19 verticals were also re-sorted into a grounded 3-tier build-classification (repackage / moderate build / ground-up) rather than treated as a flat, equally-sized list, since the actual effort behind each varies by an order of magnitude and the user's own request for "rules, guardrails, schema, architecture" implied wanting an honest foundation, not just a name registry.

Deferred, not rejected: `erp`/`office` enablement UI (open gap, §10); the actual e-commerce catalog schema and every other vertical's business-domain build (separate future waves, one per vertical); a real billing/entitlement layer gating which orgs can even see which catalog rows (out of scope until a vertical is closer to `status='live'`).
