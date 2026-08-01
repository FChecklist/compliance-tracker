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

## AI-OS Rules
- Open tasks/gaps tracked in `ai-os/MASTER-TRACKER.yaml`; closed work logged in `ai-os/boss/COMPLETED.yaml`. `ai-os/boss/BOARD.yaml` is stale (stopped 2026-06-29, self-declared "resume using COMPLETED.yaml instead") — do not use it.
- `ai-os/CONSTITUTION.yaml` is supreme — never bypass a rule in it without the owner's explicit written instruction (see its own `amendment_rule`)
- Dispatch tasks via `repository_dispatch` with event_type: `zai-task` or `claude-task`
- **Corrected 2026-07-14** (this blanket rule was contradicted by this codebase's own established, sanctioned practice — `ai-os/` is edited and merged in nearly every wave, including the PR that shipped this correction): DO NOT edit `.claude/` (session/tooling config, not project content). Edit `CLAUDE.md`/`AGENTS.md`/`SENTINEL.md`/`ai-os/` freely when the task genuinely calls for it (as most gap-closure and governance work does) — the real protections that matter are `AGENTS.md` Operating Rule 9 (no guardrail weakened without explicit owner sign-off + a manifest update) and Rule 6 (no direct push to `main`, PR/CI gate applies to every file in this repo, no exceptions for these paths).
- DO NOT commit `.env` files
- All API routes MUST use Drizzle — zero Prisma imports
- All API routes MUST call `requireAuth()` from `@/lib/supabase/auth-guard`

## High-Risk Files (AI Modification Caution)

VERIDIAN Review Framework gap-closure (2026-08-01), "AI Modification Readiness" -- Medium: "No single readiness score; depends heavily on which file." There is no automated per-file readiness score in this repo (and none is being added here — that's a bigger build than this gap calls for). What follows is a manual snapshot, criterion-based, not a live check: files under `src/lib/` and `src/lib/services/` at **≥400 lines with no dedicated `<file>.test.ts` sibling**, as of 2026-08-01 (re-run the one-liner below before trusting this list if it's been a while — it drifts as files change):

```
for f in src/lib/*.ts src/lib/services/*.ts; do
  [[ "$f" == *.test.ts ]] && continue
  lines=$(wc -l < "$f"); base="${f%.ts}"
  [[ ! -f "${base}.test.ts" && $lines -ge 400 ]] && echo "$lines $f"
done | sort -rn
```

| File | Lines | Note |
|---|---|---|
| `src/lib/services/erp-accounting-service.ts` | 592 | No dedicated test file; referenced by `tenant-isolation.test.ts` (RLS coverage only, not business-logic coverage) |
| `src/lib/services/compliance-service.ts` | 580 | No dedicated test file; referenced by 3 other test files (`exception-taxonomy.test.ts`, `connector-data-service.test.ts`, `erp-selling-service.test.ts`) — partial, not full coverage |
| `src/lib/activity-log-service.ts` | 509 | No dedicated test file. Load-bearing for governance — `scripts/check-guardrail-presence.mjs` names several of its exports as required guardrail markers |
| `src/lib/services/veri-reward-service.ts` | 461 | No dedicated test file; zero references in any `*.test.ts` |
| `src/lib/services/erp-financial-report-service.ts` | 456 | No dedicated test file; zero references in any `*.test.ts` |
| `src/lib/services/erp-procurement-workflow-service.ts` | 452 | No dedicated test file; referenced by one other test file, not its own |
| `src/lib/services/workspace-memory-service.ts` | 445 | No dedicated test file; zero references in any `*.test.ts` |
| `src/lib/services/veri-meeting-service.ts` | 434 | No dedicated test file; referenced by one other test file, not its own |

If a task requires modifying one of these files (or a file that later grows into this bracket): read the whole file first rather than patching blind from a search hit, prefer additive changes over restructuring, and add or extend test coverage for the function you touch as part of the same change rather than after — this list existing is not a substitute for that.
