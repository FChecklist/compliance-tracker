# FChecklist System Tree

**Started 2026-07-11.** An extremely granular, git-tracked tree of everything that actually exists in the FChecklist GitHub org's live codebases -- every repository, every API domain, every database table, every page, every component, every service, every guardrail, every AI role. This is a system-of-record tree (what IS built), distinct from `ai-os/audit-tree/` (what the 9 requirement documents SAY should be built).

## Scope

Repos in the `FChecklist` org, per `gh repo list FChecklist`:

| Repo | Included? | Why |
|---|---|---|
| `compliance-tracker` (VERIDIAN AI OS) | Yes | Core platform |
| `projexa` (PROJEXA) | Yes | Construction Intelligence AI OS, thin client on VERIDIAN |
| `veda-advisors` | Yes | Rajat Agarwal's standalone advisory-business website |
| `veridian-brain` | Yes, minimal | Confirmed via GitHub API: just `README.md` + `package.json` + an empty `packages/` dir -- a scaffold, "not yet extracted from compliance-tracker." Given one line, not a full tree, since there is nothing to enumerate yet. |
| `global-revenue-engine` | **Excluded** | Explicitly "Sumeet project" per its own repo description |
| `sumeet-spec` | **Excluded** | Explicitly "Spec/memory doc for Sumeet's project" per its own repo description |

## Methodology

Built from 5 parallel, very-thorough Explore-agent passes over the actual local checkouts (not from memory, not from documentation claims taken at face value -- every agent was instructed to verify against source and flag where docs overstate reality). Findings were then synthesized into one consistent schema by domain:

```yaml
- id: <stable id>
  name: <domain name>
  objects: [<real route paths / table names / component names / file names, verbatim>]
  input: <what triggers/feeds this domain>
  output: <what it produces>
  rules: [<business rules found in code>]
  guardrails: [<enforcement mechanisms actually wired, or explicitly noted as absent>]
  workflow: [<ordered real flow, when one exists>]
```

Every node is grounded in code that was actually read this session, not assumed. Where documentation (CLAUDE.md, ARTIFACTS.yaml, etc.) was found to overstate what's real, that mismatch is called out explicitly rather than silently repeated -- the same honesty discipline used throughout the `audit-tree/` work.

## Structure

**The "2nd tree" (the direct replica of the live codebase, built first):**
- `10-compliance-tracker-governance.yaml` -- the AI-OS governance/platform core: guardrail engine, task-tightening, model-tier routing, the 57-role AI Dev Team roster, the 25-file/247-function VCEL computation-engine registry, the 11 audit "loops," activity log/approval-preferences/dynamic-chain, CI scripts.
- `11-compliance-tracker-api.yaml` -- 614 API routes as of this tree's build (now 991, see that file's own 2026-08-01 count-refresh note), grouped into ~45 domains, with auth posture, purpose, and workflow per domain.
- `12-compliance-tracker-database.yaml` -- 377 tables / 106 enums as of this tree's build (now 443 / 130, see that file's own 2026-08-01 count-refresh note), grouped by domain, with the schema-wide architectural findings (CUID2 PKs, near-total absence of DB-level FK constraints, `complianceSchemaDB.table()` wrapper).
- `13-compliance-tracker-ui.yaml` -- ~130 authenticated pages and ~65 custom components as of this tree's build (now 163 / 81, see that file's own 2026-08-01 count-refresh note).
- `20-projexa.yaml` -- full tree: architecture (thin client, owns no construction DB), pages, API routes (VERIDIAN-proxy + local-DB), components, business logic, construction-domain concepts, and the significant gap found (12+ sidebar-linked modules with no page yet).
- `30-veda-advisors.yaml` -- full tree: the static marketing site, the real Next.js app (`code-by-zai/`), the ported governance layer, the Stage 0 lead-capture funnel (the one real interactive business flow), and a flagged security finding (plaintext credentials committed in several markdown files).
- `40-veridian-brain.yaml` -- one-line placeholder entry (confirmed empty scaffold).

**The "3rd tree" (optimized/deduplicated copy of the 2nd tree, built through a 3-round dedup+audit process):**
- `50-merged-tree.yaml` -- all 94 domains from the 2nd tree, merged into one file, reorganized by repo instead of by source-file, with 2 confirmed duplications removed and 19 domains given newly-explicit guardrail content across Rounds 2-3. This is the tree to read if you want one file instead of seven; the 2nd tree's 7 files remain the source of record for provenance.
- `SYSTEM-AUDIT-ROUND-1.md`, `SYSTEM-AUDIT-ROUND-2.md`, `SYSTEM-AUDIT-ROUND-3.md` -- the audit findings from each round (standalone, not checked against the live codebase -- that already happened when the 2nd tree was built, and again independently for Round 3's 8 domains). Round 1: 2 duplications found+fixed, plus the real gap identified (62% of domains had empty `guardrails`). Round 2: verified Round 1's fixes, added guardrail content to a judged subset of 11 domains (down to 51% empty), added a missing reverse cross-reference. Round 3 (2026-08-01, triggered by a Review Framework Documentation Completeness/Synchronization finding): a fresh code-grounded research pass (not a relabeling of existing text) on the 8 highest-risk still-empty domains (ERP, legal, e-signature, compliance core, access review, admin/finance UI) -- down to 43% empty -- corrected one factual error found along the way (DB-07's legal-opinion generation was wrongly described as AI-drafted; it's template substitution), and surfaced a real, unfixed security gap (UI-07: any authenticated user, including `viewer` rank, can mint API keys/webhooks with no audit trail) plus a recommended audit cadence for future rounds. Honestly reported what's still open (43% empty guardrails, 33% empty workflow) rather than claiming completion.

## Honesty notes carried over from the research passes (apply platform-wide)

- **(Resolved 2026-08-01, verified this session)** compliance-tracker's own `CLAUDE.md` previously understated its schema by two orders of magnitude ("9 tables, 6 enums"). It has since been corrected to a deliberately count-free description ("hundreds of tables as of 2026-07-14; growing every wave -- do not cite a specific count, check schema.ts directly") -- confirmed still in place this session, not itself stale. Left here as a record of the earlier finding, not a current gap.
- **Database relationships are almost entirely enforced in application code, not by Postgres.** As of the 2026-08-01 count refresh, only 11 explicit `.references()` foreign-key constraints exist across all 443 tables (schema.ts has grown from 377 tables since this note was written, but the FK-constraint count was not independently re-verified this pass); every other relationship (org scoping, client scoping, the entire PMS/ERP/governance graph) relies on naming convention (`xxxId` columns) plus service-layer discipline. This is a real, structural, cross-cutting fact about the whole platform's data-integrity model, not a per-table detail.
- **veda-advisors has committed plaintext secrets** (Supabase service-role key + DB password in `memory-notes/progress.md`; a GitHub PAT in `MASTER_IMPLEMENTATION_PROMPT.md`; a Composio API key in `Linkedin.md`) -- flagged in `30-veda-advisors.yaml`, not fixed by this tree (out of scope for a tree-building task; surfaced to the Owner separately).
- **projexa's sidebar links to 7+ modules that have no page implementation yet** (Scope of Work/BOQ, Work Progress, Site Diary, Documents, Manpower & Attendance, Materials, Vendors, Budgets, Expenses, KPIs, Reports, AI Copilot) -- middleware protects the routes, nav links exist, but visiting them 404s. Flagged in `20-projexa.yaml`.
- **`fm_*` (Facilities Management) tables exist in compliance-tracker's schema with no corresponding API routes found** -- schema-only, not yet wired to any route surface.
