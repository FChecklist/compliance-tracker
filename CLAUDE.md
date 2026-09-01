@AGENTS.md

## Read Before Starting Work

Before doing anything nontrivial in this repo, read these in order — they are the real source-of-truth governance docs and are not optional context:

1. `ai-os/boss/ACTIVE-CLAIMS.yaml` — **read this FIRST, before picking any gap/task**: a real-time registry of what other parallel sessions are actively working on right now, so you don't duplicate or collide with in-flight work. Added 2026-07-14 after the Owner confirmed 4 parallel Claude sessions were running across this codebase simultaneously with no way to see each other's current work. Register your own claim here before starting, per that file's own protocol.
2. `ai-os/CONSTITUTION.yaml` — **read this SECOND, and treat it as THE authority**: as of v2.0 (2026-07-14) this is the single, sole, machine-readable constitution for VERIDIAN AI OS -- every rule, guardrail, and status a prior version of this doc scattered across 9 separate "constitutional" documents now lives here with a stable ID. Those 9 documents (`VERIDIAN_AI_CONSTITUTION.md`, `VERIDIAN_TASK_GOVERNANCE_CONSTITUTION.md`, `VERIDIAN_AUDIT_ORGANIZATION.md`, `VERIDIAN_DMP_DCF_CONSTITUTION.md`, `VERI_CHAT_GOVERNANCE.md`, `MASTER_AI_OS_ARCHITECTURE.md`, `SENTINEL.md`, `ai-os/sentinel/SENTINEL.yaml`, `VAIOS_ARCHITECTURE_STRATEGY.md`) still exist with full narrative reasoning and file:line evidence, each carrying an AUTHORITY NOTE pointing back here -- read them for WHY, read this file for the RULE.
3. `ai-os/OS.yaml` — governance-file index: the one place that lists every other tracking/governance document and what it's actually for.
4. `ai-os/BRAIN.md` — plain-language explainer of what VERIDIAN AI OS is and how it works, grounded in cited files.
5. `ai-os/MASTER-TRACKER.yaml` — the live gap-analysis / open-work tracker (see corrected "AI-OS Rules" note below).
6. `ai-os/SOFTWARE_TEAM.md` — plain-language explainer of the Software Team L0-L5 execution ladder (AIROUTER-01 Phase 2): real dispatch wiring on top of the Mother Router (`src/lib/ai-router/mother-router.ts`), the Instruction Contract/Execution Report task register, and the capability-based routing matrix. Read this before touching `/api/ai/team/dispatch`'s `softwareTeamLevel` path or `src/lib/ai-router/*`. See `ai-os/AI_ORCHESTRA_HIERARCHY.md` for the underlying 4-domain L0-L5 spec this implements Table 1 of, and `ai-os/AIROUTER_SOFTWARE_TEAM_AUDIT_LOG.md` for its 3-round independent-audit record.
7. `ai-os/DOMAIN_OWNERSHIP.yaml` — **read this BEFORE touching any custom domain in the Vercel dashboard or API/CLI, for ANY reason**: the single canonical record of which Vercel project each production domain currently belongs to. Added 2026-08-16 after `projexa-ai.com`/`www.projexa-ai.com` were found reassigned from the `projexa` project to `veridian-compliance-ai` twice (2026-07-27, 2026-08-16) with zero code cause found anywhere on the box — every occurrence was a manual live infra action by a different session with no persisted canonical record to check first. `.github/workflows/domain-drift-check.yml` polls the real Vercel API every 15 minutes and fails fast (Actions tab) the moment live state stops matching this file — it cannot prevent a manual change, but it makes recurrence visible in minutes instead of days.

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
- `bun test --isolate` — run the test suite. **Always pass `--isolate`, matching `.github/workflows/ci.yml`** — 27+ route.test.ts files mock `@/lib/supabase/auth-guard` via `mock.module()` without restoring it, which (confirmed via a real repro during the R1-R64 recheck, 2026-08-30) leaks a stale/incomplete mock across files in a bare `bun test` run, causing spurious role-gate test failures that look exactly like a live RBAC bug but aren't (module-chain/route.test.ts's own header comment documents the same root cause independently). `--isolate` gives every test file a fresh module graph, eliminating the leak — bare `bun test` is not a reliable signal on this repo and should not be used to diagnose failures.
- `bun run db:generate` — generate Drizzle migration. Use this for any real schema change bound for production; only covers the `compliance` schema (see drizzle.config.ts's own comment — `platform` schema tables need a hand-written migration).
- `bun run db:push` — push schema to Supabase directly, no migration file. Ad-hoc/local dev only — this codebase has documented real production drift from schema changes applied out-of-band (`drizzle/0245`'s own migration header: "Hand-authored SQL, applied out-of-band via the Supabase MCP"), so a change meant to ship should go through `db:generate` + a committed, reviewed migration instead.
- `bun run db:seed` — seed database (src/db/seed.ts)

## Env Vars Required
- `DATABASE_URL` — PostgreSQL connection string (Supabase pooler preferred). **This app uses TWO separate Supabase projects, confirmed live 2026-08-29 — don't assume one project's ref covers both:**
  - `pcrjmlpuqsbocqfwoxod` ("verdian-ai") — the app's own business schema (`platform.*`/`compliance.*`), what `DATABASE_URL`/`APP_RUNTIME_DATABASE_URL` point at.
  - `evpckeuxgvahguwsaeul` ("projexa") — the actual auth/identity backend, what `NEXT_PUBLIC_SUPABASE_URL`/`NEXT_PUBLIC_SUPABASE_ANON_KEY` point at (confirmed via real login network requests hitting `evpckeuxgvahguwsaeul.supabase.co/auth/v1/token`). An older note pointing both vars at `pcrjmlpuqsbocqfwoxod` was stale/wrong.
- `NEXT_PUBLIC_SUPABASE_URL` — Supabase project URL (auth backend — `evpckeuxgvahguwsaeul`, see above)
- `NEXT_PUBLIC_SUPABASE_ANON_KEY` — Supabase anon key (same project as above)
- `SUPABASE_SERVICE_ROLE_KEY` — Supabase service role (server-side only)

## Local Dev on Windows — 2 real gotchas (2026-08-29)
- **`bun run dev` fails** (`bun: command not found: tee`) — the script pipes through `tee dev.log`, which bun's Windows script runner doesn't support. Run the underlying command directly instead: `node scripts/generate-protected-routes.mjs && bunx next dev -p 3000`.
- **Turbopack panics with `path length ... exceeds max length of filesystem`** if the clone lives at a long/deeply-nested path (e.g. under a deep temp/scratchpad directory). Clone to a short path instead (e.g. `C:\ct\ct`) for any local dev/build work on Windows.

## High-Risk Files (Large + Untested)

VERIDIAN Review Framework gap-closure, AI Modification Readiness ([Medium], 2026-07-18): there is no single AI-modification-readiness score for this repo — readiness genuinely depends on which file you're touching. Rather than a fake aggregate number, this section names the concrete heuristic and the current files it flags, so an agent knows to slow down and read more context before editing them, not because a linter is watching but because a mistake here is expensive to catch.

**Heuristic:** a file is high-risk if it is large (roughly 500+ lines) AND has no sibling `*.test.ts`/`*.test.tsx` covering it. Size alone means more surface area to misread; no tests means a bad edit has no automated way to surface itself before a human/agent reviewer notices in a PR diff. Re-derive this list yourself if it looks stale — `git ls-files 'src/**/*.ts' 'src/**/*.tsx'`, sort by line count, check for a same-directory `*.test.ts`/`*.test.tsx` — rather than trusting it blindly; it will drift as the codebase grows.

As of 2026-08-15, the highest-risk files by this heuristic:
- `src/lib/db/schema.ts` (11,500+ lines, untested by nature — it's schema, not logic) — every table in this repo lives in one file; a bad edit here doesn't just break the table you meant to touch, it can silently break Drizzle's generated types for everything downstream, or collide with another in-flight worker's migration number (see `scripts/check-migration-collision.mjs` / the CI job of the same name). Always run `bun run db:generate` and inspect the generated migration before assuming an edit here is safe, and never renumber an existing migration file.
- `src/app/api/mcp/route.ts` (~590 lines, untested) — the MCP protocol entry point (see `MCP_PROTOCOL.md`); a change here can silently break every external MCP client integration at once, not just one API route.
- `src/lib/services/erp-accounting-service.ts` (~590 lines, untested) and `src/lib/services/compliance-service.ts` (~580 lines, untested) — the largest untested files under `src/lib/services/`, the directory most business logic in this repo lives in (see the header-comment convention enforced by `scripts/check-service-header-comments.mjs`); read the file's own header comment and any adjacent smaller, tested sibling service before assuming you understand its invariants.
- `src/lib/activity-log-service.ts` (~510 lines, untested) — feeds the audit trail multiple compliance features depend on being accurate; a silent logic change here doesn't fail loudly, it just makes the audit log quietly wrong.

This list is illustrative, not exhaustive — dozens of large untested `page.tsx`/component files also exist (this repo currently has zero real Playwright E2E coverage, `ci.yml`'s `e2e` job passes with `--pass-with-no-tests`), but front-end pages fail visibly when broken, which is a materially different risk profile than the backend/schema files above failing silently. When in doubt about whether a file you're about to edit qualifies, check line count and test coverage yourself rather than assuming it's safe because it isn't on this list.

## AI-OS Rules
- Open tasks/gaps tracked in `ai-os/MASTER-TRACKER.yaml`; closed work logged in `ai-os/boss/COMPLETED.yaml`. `ai-os/boss/BOARD.yaml` is stale (stopped 2026-06-29, self-declared "resume using COMPLETED.yaml instead") — do not use it.
- `ai-os/CONSTITUTION.yaml` is supreme — never bypass a rule in it without the owner's explicit written instruction (see its own `amendment_rule`)
- Dispatch tasks via `repository_dispatch` with event_type: `zai-task` or `claude-task`
- **Corrected 2026-07-14** (this blanket rule was contradicted by this codebase's own established, sanctioned practice — `ai-os/` is edited and merged in nearly every wave, including the PR that shipped this correction): DO NOT edit `.claude/` (session/tooling config, not project content). Edit `CLAUDE.md`/`AGENTS.md`/`SENTINEL.md`/`ai-os/` freely when the task genuinely calls for it (as most gap-closure and governance work does) — the real protections that matter are `AGENTS.md` Operating Rule 9 (no guardrail weakened without explicit owner sign-off + a manifest update) and Rule 6 (no direct push to `main`, PR/CI gate applies to every file in this repo, no exceptions for these paths).
- DO NOT commit `.env` files
- All API routes MUST use Drizzle — zero Prisma imports
- All API routes MUST call `requireAuth()` from `@/lib/supabase/auth-guard`
