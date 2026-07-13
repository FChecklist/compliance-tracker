@AGENTS.md

## Read Before Starting Work

Before doing anything nontrivial in this repo, read these in order — they are the real source-of-truth governance docs and are not optional context:

1. `ai-os/OS.yaml` — governance-file index: the one place that lists every other tracking/governance document and what it's actually for.
2. `ai-os/BRAIN.md` — plain-language explainer of what VERIDIAN AI OS is and how it works, grounded in cited files.
3. `VERIDIAN_TASK_GOVERNANCE_CONSTITUTION.md` — the standing constitution for task lifecycle, multi-agent orchestration, and mandatory guardrails; supersedes conflicting informal instructions.
4. `ai-os/MASTER-TRACKER.yaml` — the live gap-analysis / open-work tracker (see corrected "AI-OS Rules" note below).

# Veridian AI — Agent Context

**Brand:** VERIDIAN AI | **Product:** Veridian AI | **Tagline:** One Portal. One Truth.
**Runtime:** Bun | Next.js 16 App Router | TypeScript strict | Tailwind CSS 4 | shadcn/ui
**Database:** Drizzle ORM + postgres.js → Supabase PostgreSQL (`compliance` schema)
**Auth:** Supabase Auth SSR (`@supabase/ssr`) — middleware-protected app routes

## Structure
- `src/app/(app)/` — authenticated pages (dashboard, compliance, checklists, tasks, reports, penalties, departments, users, audit, settings, team)
- `src/app/api/` — Drizzle-backed API routes (all require auth via `requireAuth()`)
- `src/components/` — UI components (AppSidebar, AppTopbar, DashboardCard, ComplianceChart, DataTable, StatusBadge, SearchCommand)
- `src/lib/db/` — Drizzle schema (9 tables, 6 enums) + db client
- `src/lib/supabase/` — Supabase client helpers (client.ts, server.ts, auth-guard.ts)
- `public/` — Logo SVGs (logo.svg, logo-dark.svg, logo-mark.svg, logo-compact.svg)
- `ai-os/` — AI-OS governance (SENTINEL.yaml, BOARD.yaml, VEDABOSS)
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
- SENTINEL.yaml is supreme — never bypass
- Dispatch tasks via `repository_dispatch` with event_type: `zai-task` or `claude-task`
- DO NOT touch: `.claude/`, `CLAUDE.md`, `AGENTS.md`, `SENTINEL.md`, `ai-os/`
- DO NOT commit `.env` files
- All API routes MUST use Drizzle — zero Prisma imports
- All API routes MUST call `requireAuth()` from `@/lib/supabase/auth-guard`
