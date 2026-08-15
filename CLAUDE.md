@AGENTS.md

## Read Before Starting Work

Before doing anything nontrivial in this repo, read these in order — they are the real source-of-truth governance docs and are not optional context:

1. `ai-os/boss/ACTIVE-CLAIMS.yaml` — **read this FIRST, before picking any gap/task**: a real-time registry of what other parallel sessions are actively working on right now, so you don't duplicate or collide with in-flight work. Added 2026-07-14 after the Owner confirmed 4 parallel Claude sessions were running across this codebase simultaneously with no way to see each other's current work. Register your own claim here before starting, per that file's own protocol.
2. `ai-os/CONSTITUTION.yaml` — **read this SECOND, and treat it as THE authority**: as of v2.0 (2026-07-14) this is the single, sole, machine-readable constitution for VERIDIAN AI OS -- every rule, guardrail, and status a prior version of this doc scattered across 9 separate "constitutional" documents now lives here with a stable ID. Those 9 documents (`VERIDIAN_AI_CONSTITUTION.md`, `VERIDIAN_TASK_GOVERNANCE_CONSTITUTION.md`, `VERIDIAN_AUDIT_ORGANIZATION.md`, `VERIDIAN_DMP_DCF_CONSTITUTION.md`, `VERI_CHAT_GOVERNANCE.md`, `MASTER_AI_OS_ARCHITECTURE.md`, `SENTINEL.md`, `ai-os/sentinel/SENTINEL.yaml`, `VAIOS_ARCHITECTURE_STRATEGY.md`) still exist with full narrative reasoning and file:line evidence, each carrying an AUTHORITY NOTE pointing back here -- read them for WHY, read this file for the RULE.
3. `ai-os/OS.yaml` — governance-file index: the one place that lists every other tracking/governance document and what it's actually for.
4. `ai-os/BRAIN.md` — plain-language explainer of what VERIDIAN AI OS is and how it works, grounded in cited files.
5. `ai-os/MASTER-TRACKER.yaml` — the live gap-analysis / open-work tracker (see corrected "AI-OS Rules" note below).
6. `ai-os/SOFTWARE_TEAM.md` — plain-language explainer of the Software Team L0-L5 execution ladder (AIROUTER-01 Phase 2): real dispatch wiring on top of the Mother Router (`src/lib/ai-router/mother-router.ts`), the Instruction Contract/Execution Report task register, and the capability-based routing matrix. Read this before touching `/api/ai/team/dispatch`'s `softwareTeamLevel` path or `src/lib/ai-router/*`. See `ai-os/AI_ORCHESTRA_HIERARCHY.md` for the underlying 4-domain L0-L5 spec this implements Table 1 of, and `ai-os/AIROUTER_SOFTWARE_TEAM_AUDIT_LOG.md` for its 3-round independent-audit record.

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

## High-Risk Files — Apply Extra Caution

VERIDIAN Review Framework gap-closure, "AI Modification Readiness" (Medium): there is no single readiness score for this codebase, and readiness depends heavily on which file you're touching. Rather than build a scoring system, this is a snapshot list of files that are both **large** (≥300 lines) and **untested** (no matching `*.test.ts`) as of 2026-08-15 — the two attributes that make a change hardest for an AI agent to get right and hardest to verify mechanically. A file on this list isn't necessarily broken; it just means the usual safety net (small diff, existing test suite catching a regression) is weaker here, so read the whole file before editing, make the smallest change that closes the gap, and consider adding a test alongside your change rather than after.

Regenerate this list yourself if it's gone stale: `git ls-files 'src/lib/**/*.ts' 'src/app/api/**/route.ts' | grep -v '\.test\.' | while read -r f; do t="${f%.ts}.test.ts"; l=$(wc -l < "$f"); [ "$l" -ge 300 ] && [ ! -f "$t" ] && echo "$l $f"; done | sort -rn` — this is a heuristic (line count is a crude proxy for complexity, and a missing same-name test file doesn't mean zero coverage if it's exercised via an integration/e2e test elsewhere), not a certified score. Extending this list is always fine; if you fix one (add real tests, or split it down under 300 lines), remove it in the same PR.

- `src/lib/db/schema.ts` (11,543 lines) — special case, not a normal "add tests" candidate: this is the single Drizzle schema for every table in the `compliance` schema. Its real safety net is `bun run db:generate` + a reviewed migration diff, not a unit test. Still the single highest-blast-radius file to hand-edit in this repo — a wrong column type or dropped constraint here can break every service that touches that table.
- `src/app/api/mcp/route.ts` (590 lines), `src/app/api/ai/orchestrate/route.ts` (404 lines) — the two largest untested API route handlers; both are AI/agent-facing entry points, not ordinary CRUD routes.
- ERP service layer (largest untested files, `src/lib/services/`): `erp-accounting-service.ts` (592), `erp-financial-report-service.ts` (456), `erp-procurement-workflow-service.ts` (452), `erp-goods-receipt-service.ts` (310).
- Other large untested services (`src/lib/services/`): `compliance-service.ts` (580), `veri-reward-service.ts` (461), `workspace-memory-service.ts` (445), `veri-meeting-service.ts` (434), `report-catalog-service.ts` (425), `sales-engine-service.ts` (396), `gst-reconciliation-service.ts` (378), `risk-register-service.ts` (373), `fm-register-digitization-service.ts` (309), `communication-drafting-service.ts` (301). Also `src/lib/ai-team/team-service.ts` (353).

## AI-OS Rules
- Open tasks/gaps tracked in `ai-os/MASTER-TRACKER.yaml`; closed work logged in `ai-os/boss/COMPLETED.yaml`. `ai-os/boss/BOARD.yaml` is stale (stopped 2026-06-29, self-declared "resume using COMPLETED.yaml instead") — do not use it.
- `ai-os/CONSTITUTION.yaml` is supreme — never bypass a rule in it without the owner's explicit written instruction (see its own `amendment_rule`)
- Dispatch tasks via `repository_dispatch` with event_type: `zai-task` or `claude-task`
- **Corrected 2026-07-14** (this blanket rule was contradicted by this codebase's own established, sanctioned practice — `ai-os/` is edited and merged in nearly every wave, including the PR that shipped this correction): DO NOT edit `.claude/` (session/tooling config, not project content). Edit `CLAUDE.md`/`AGENTS.md`/`SENTINEL.md`/`ai-os/` freely when the task genuinely calls for it (as most gap-closure and governance work does) — the real protections that matter are `AGENTS.md` Operating Rule 9 (no guardrail weakened without explicit owner sign-off + a manifest update) and Rule 6 (no direct push to `main`, PR/CI gate applies to every file in this repo, no exceptions for these paths).
- DO NOT commit `.env` files
- All API routes MUST use Drizzle — zero Prisma imports
- All API routes MUST call `requireAuth()` from `@/lib/supabase/auth-guard`
