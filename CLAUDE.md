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

## High-Risk Files (Apply Extra Caution)
Review Framework gap-closure, "AI Modification Readiness": this repo has no single per-file readiness score (and building a real one is out of scope for a lightweight fix) — what follows is a cheap, honest proxy instead: files that are both **large** (≥400 lines — more context an agent has to hold at once to change safely) and **untested** (no colocated `*.test.ts`/`*.test.tsx`). A file below has the least safety net if a change to it is wrong; read it fully before modifying, and prefer adding a colocated test alongside your change over editing blind. This is a snapshot, not a live query — regenerate it with `node scripts/report-high-risk-files.mjs` (see that script's own header for what it does and doesn't measure) after a wave that adds tests or splits a large file, and update this list if it changed.

- `src/lib/db/schema.ts` (~10,200 lines) — the single biggest blast radius in the repo: every table for every module. A wrong migration or type change here is repo-wide, not local.
- `src/lib/supabase/auth-guard.ts` (~460 lines) — `requireAuth()` backs every API route (CLAUDE.md's own "All API routes MUST call `requireAuth()`" rule); a subtle bug here is a security regression, not just a bug.
- ERP service cluster, each ~450–700 lines, no colocated tests: `src/lib/services/erp-invoicing-service.ts`, `erp-accounting-service.ts`, `erp-selling-service.ts`, `erp-payroll-service.ts`, `erp-contract-service.ts`, `erp-financial-report-service.ts`, `erp-procurement-workflow-service.ts`.
- Other untested large services: `src/lib/services/compliance-service.ts`, `activity-log-service.ts`, `veri-reward-service.ts`, `workspace-memory-service.ts`, `crm-service.ts`.
- Large untested UI components: `src/components/veri-chat/VeriChatPanel.tsx`, `VeriComposer.tsx`, `src/components/AppSidebar.tsx`, `search-command.tsx`, `DocumentUploadSection.tsx`, `InviteUserModal.tsx`, `CustomReportsSection.tsx`, `WebhookSection.tsx`, `AiConfigSection.tsx` — plus `src/components/ui/sidebar.tsx`, which is vendored shadcn/ui, not hand-authored; prefer regenerating/upgrading it via shadcn's CLI over hand-editing.
- `src/app/api/mcp/route.ts` (~590 lines) — the MCP tool-call surface; untested and large, same "read the whole thing first" caution applies.

This list is not exhaustive (25 files matched at the time this was written — see the script for the current full set) and the ≥400-line/no-test-file bar is a heuristic, not a verdict: a short file with gnarly multi-tenant RLS logic can be riskier than a long mechanical one, and a file can have real indirect coverage this purely-textual check can't see.

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
