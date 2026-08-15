@AGENTS.md

## Read Before Starting Work

Before doing anything nontrivial in this repo, read these in order — they are the real source-of-truth governance docs and are not optional context:

1. `ai-os/boss/ACTIVE-CLAIMS.yaml` — **read this FIRST, before picking any gap/task**: a real-time registry of what other parallel sessions are actively working on right now, so you don't duplicate or collide with in-flight work. Added 2026-07-14 after the Owner confirmed 4 parallel Claude sessions were running across this codebase simultaneously with no way to see each other's current work. Register your own claim here before starting, per that file's own protocol.
2. `ai-os/CONSTITUTION.yaml` — **read this SECOND, and treat it as THE authority**: as of v2.0 (2026-07-14) this is the single, sole, machine-readable constitution for VERIDIAN AI OS -- every rule, guardrail, and status a prior version of this doc scattered across 9 separate "constitutional" documents now lives here with a stable ID. Those 9 documents (`VERIDIAN_AI_CONSTITUTION.md`, `VERIDIAN_TASK_GOVERNANCE_CONSTITUTION.md`, `VERIDIAN_AUDIT_ORGANIZATION.md`, `VERIDIAN_DMP_DCF_CONSTITUTION.md`, `VERI_CHAT_GOVERNANCE.md`, `MASTER_AI_OS_ARCHITECTURE.md`, `SENTINEL.md`, `ai-os/sentinel/SENTINEL.yaml`, `VAIOS_ARCHITECTURE_STRATEGY.md`) still exist with full narrative reasoning and file:line evidence, each carrying an AUTHORITY NOTE pointing back here -- read them for WHY, read this file for the RULE.
3. `ai-os/OS.yaml` — governance-file index: the one place that lists every other tracking/governance document and what it's actually for.
4. `ai-os/BRAIN.md` — plain-language explainer of what VERIDIAN AI OS is and how it works, grounded in cited files.
5. `ai-os/MASTER-TRACKER.yaml` — the live gap-analysis / open-work tracker (see corrected "AI-OS Rules" note below).

# Veridian AI — Agent Context

**Brand:** VERIDIAN AI | **Product:** Veridian AI | **Tagline:** One Portal. One Truth.
**Runtime:** Bun | Next.js 16 App Router | TypeScript strict | Tailwind CSS 4 | shadcn/ui
**Database:** Drizzle ORM + postgres.js → Supabase PostgreSQL (`compliance` schema)
**Auth:** Supabase Auth SSR (`@supabase/ssr`) — middleware-protected app routes

## Structure
- `src/app/(app)/` — authenticated pages (dashboard, compliance, checklists, tasks, reports, penalties, departments, users, audit, settings, team)
- `src/app/api/` — Drizzle-backed API routes (all require auth via `requireAuth()`)
- `src/components/` — UI components (AppSidebar, AppTopbar, DashboardCard, ComplianceChart, DataTable, StatusBadge, SearchCommand)
- `src/lib/db/` — Drizzle schema (hundreds of tables as of 2026-07-14; growing every wave -- do not cite a specific count, check schema.ts directly) + db client
- `src/lib/supabase/` — Supabase client helpers (client.ts, server.ts, auth-guard.ts)
- `public/` — Logo SVGs (logo.svg, logo-dark.svg, logo-mark.svg, logo-compact.svg)
- `ai-os/` — AI-OS governance: `CONSTITUTION.yaml` (the constitution), `MASTER-TRACKER.yaml` (open work), `boss/` (ACTIVE-CLAIMS/COMPLETED/BOARD-stale), `sentinel/`, `registry/`, `audit-tree/`, `system-tree/`, `tree4-unified/`, `engines/` -- see `ai-os/OS.yaml` for what each covers, do not assume this is a small directory
- `drizzle/` — Migration files

## High-Risk Files (large + untested) — apply extra caution here

Review Framework gap-closure, AI Modification Readiness (Medium): there is no single automated "AI modification readiness score" for this repo — readiness genuinely depends on which file. Rather than build a scoring system, this is a point-in-time list (computed 2026-08-15 by `git ls-files` line counts + presence/absence of a co-located `*.test.ts`) of the largest business-logic files with **zero** test coverage — the files where an agent is most likely to introduce a regression it can't catch itself before a human/CI does. This list will drift as files change size or gain tests; if you're about to make a nontrivial change to a file not listed here, don't assume it's safe purely because it's absent — re-check size and test coverage yourself (`wc -l <file>` and whether `<file>.test.ts` exists) rather than trusting this list as current.

For any of these: read the whole file before editing (don't rely on a partial grep match), make the smallest coherent change, and prefer adding a test alongside the change over editing blind.

| File | Lines | Why it's high-risk |
|---|---|---|
| `src/lib/db/schema.ts` | ~10,200 | The entire Drizzle schema for every table in the app, in one file — a single typo'd column/relation can break unrelated features far from your change. No test file (schema correctness is enforced by `db:generate`/`db:push` + the app failing to build, not a unit test). |
| `src/lib/services/erp-invoicing-service.ts` | ~700 | Core ERP invoicing business logic (money-handling), no test file. |
| `src/app/api/mcp/route.ts` | ~590 | Single route handling every MCP tool call — a mistake here can break tool access repo-wide, no test file. |
| `src/lib/services/erp-accounting-service.ts` | ~560 | Core ERP accounting logic (money-handling), no test file. |
| `src/lib/services/erp-selling-service.ts` | ~540 | Core ERP selling/order logic, no test file. |
| `src/lib/services/erp-payroll-service.ts` | ~510 | Payroll calculation logic (money + compliance-sensitive), no test file. |
| `src/lib/services/compliance-service.ts` | ~510 | Core compliance-tracking logic — this app's namesake domain, no test file. |
| `src/lib/activity-log-service.ts` | ~500 | Cross-cutting audit-log writer used by many other services — a silent regression here weakens traceability everywhere else, no test file. |
| `src/lib/supabase/auth-guard.ts` | ~460 | `requireAuth()` lives here and every API route depends on it (see AI-OS Rules below) — a mistake is a security regression, not just a bug, no test file. |
| `src/lib/services/erp-financial-report-service.ts` | ~460 | Financial reporting/aggregation logic, no test file. |
| `src/lib/services/erp-contract-service.ts` | ~460 | ERP contract lifecycle logic, no test file. |

Note: `src/lib/services/permission-service.ts` (RBAC's `ERP_ACTION_ROLES` table) is **not** on this list — it already has a co-located `permission-service.test.ts`, and per this file's own in-flight-work conventions its shared table structure should only ever be extended additively (new keys), not restructured, regardless of this list.

## Design Tokens
- Navy: #1C2B3A | Saffron: #F5820A | Teal: #0E7C6E | Cream: #FFFDF9
- Fonts: DM Serif Display (headings) + Inter (body)

## Commands
- `bun install` — install dependencies
- `bun run dev` — start dev server (port 3000)
- `bun run build` — production build
- `bun run db:generate` — generate Drizzle migration
- `bun run db:push` — push schema to Supabase
- `bun run db:seed` — seed database (src/db/seed.ts)

## Env Vars Required
- `DATABASE_URL` — PostgreSQL connection string (Supabase pooler preferred)
- `NEXT_PUBLIC_SUPABASE_URL` — Supabase project URL
- `NEXT_PUBLIC_SUPABASE_ANON_KEY` — Supabase anon key
- `SUPABASE_SERVICE_ROLE_KEY` — Supabase service role (server-side only)

## AI-OS Rules
- Open tasks/gaps tracked in `ai-os/MASTER-TRACKER.yaml`; closed work logged in `ai-os/boss/COMPLETED.yaml`. `ai-os/boss/BOARD.yaml` is stale (stopped 2026-06-29, self-declared "resume using COMPLETED.yaml instead") — do not use it.
- `ai-os/CONSTITUTION.yaml` is supreme — never bypass a rule in it without the owner's explicit written instruction (see its own `amendment_rule`)
- Dispatch tasks via `repository_dispatch` with event_type: `zai-task` or `claude-task`
- **Corrected 2026-07-14** (this blanket rule was contradicted by this codebase's own established, sanctioned practice — `ai-os/` is edited and merged in nearly every wave, including the PR that shipped this correction): DO NOT edit `.claude/` (session/tooling config, not project content). Edit `CLAUDE.md`/`AGENTS.md`/`SENTINEL.md`/`ai-os/` freely when the task genuinely calls for it (as most gap-closure and governance work does) — the real protections that matter are `AGENTS.md` Operating Rule 9 (no guardrail weakened without explicit owner sign-off + a manifest update) and Rule 6 (no direct push to `main`, PR/CI gate applies to every file in this repo, no exceptions for these paths).
- DO NOT commit `.env` files
- All API routes MUST use Drizzle — zero Prisma imports
- All API routes MUST call `requireAuth()` from `@/lib/supabase/auth-guard`
