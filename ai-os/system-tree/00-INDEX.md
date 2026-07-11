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
- `11-compliance-tracker-api.yaml` -- all 614 API routes, grouped into ~45 domains, with auth posture, purpose, and workflow per domain.
- `12-compliance-tracker-database.yaml` -- all 377 tables / 106 enums, grouped by domain, with the schema-wide architectural findings (CUID2 PKs, near-total absence of DB-level FK constraints, `complianceSchemaDB.table()` wrapper).
- `13-compliance-tracker-ui.yaml` -- ~130 authenticated pages and ~65 custom components.
- `20-projexa.yaml` -- full tree: architecture (thin client, owns no construction DB), pages, API routes (VERIDIAN-proxy + local-DB), components, business logic, construction-domain concepts, and the significant gap found (12+ sidebar-linked modules with no page yet).
- `30-veda-advisors.yaml` -- full tree: the static marketing site, the real Next.js app (`code-by-zai/`), the ported governance layer, the Stage 0 lead-capture funnel (the one real interactive business flow), and a flagged security finding (plaintext credentials committed in several markdown files).
- `40-veridian-brain.yaml` -- one-line placeholder entry (confirmed empty scaffold).

**The "3rd tree" (optimized/deduplicated copy of the 2nd tree, built through a 2-round dedup+audit process):**
- `50-merged-tree.yaml` -- all 94 domains from the 2nd tree, merged into one file, reorganized by repo instead of by source-file, with 2 confirmed duplications removed and 11 domains given newly-explicit guardrail content. This is the tree to read if you want one file instead of seven; the 2nd tree's 7 files remain the source of record for provenance.
- `SYSTEM-AUDIT-ROUND-1.md`, `SYSTEM-AUDIT-ROUND-2.md` -- the audit findings from each round (standalone, not checked against the live codebase -- that already happened when the 2nd tree was built). Round 1: 2 duplications found+fixed, plus the real gap identified (62% of domains had empty `guardrails`). Round 2: verified Round 1's fixes, added guardrail content to a judged subset of 11 domains (down to 51% empty), added a missing reverse cross-reference, and honestly reported what's still open (51% empty guardrails, 33% empty workflow) rather than claiming completion.

## Honesty notes carried over from the research passes (apply platform-wide)

- **compliance-tracker's own `CLAUDE.md` understates its schema by two orders of magnitude** ("9 tables, 6 enums" vs. the actual 377 tables / 106 enums) -- stale documentation, not a discrepancy in the tree.
- **Database relationships are almost entirely enforced in application code, not by Postgres.** Only 11 explicit `.references()` foreign-key constraints exist across all 377 tables; every other relationship (org scoping, client scoping, the entire PMS/ERP/governance graph) relies on naming convention (`xxxId` columns) plus service-layer discipline. This is a real, structural, cross-cutting fact about the whole platform's data-integrity model, not a per-table detail.
- **veda-advisors has committed plaintext secrets** (Supabase service-role key + DB password in `memory-notes/progress.md`; a GitHub PAT in `MASTER_IMPLEMENTATION_PROMPT.md`; a Composio API key in `Linkedin.md`) -- flagged in `30-veda-advisors.yaml`, not fixed by this tree (out of scope for a tree-building task; surfaced to the Owner separately).
- **projexa's sidebar links to 7+ modules that have no page implementation yet** (Scope of Work/BOQ, Work Progress, Site Diary, Documents, Manpower & Attendance, Materials, Vendors, Budgets, Expenses, KPIs, Reports, AI Copilot) -- middleware protects the routes, nav links exist, but visiting them 404s. Flagged in `20-projexa.yaml`.
- **`fm_*` (Facilities Management) tables exist in compliance-tracker's schema with no corresponding API routes found** -- schema-only, not yet wired to any route surface.
