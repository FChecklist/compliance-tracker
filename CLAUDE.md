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
8. **R72 state (2026-09-04) — supersedes the R71 state below it used to list (R71's own findings are folded in, not lost). Check this before relying on the memory/graph store, editing `.env.local`, or planning a deploy:**
   - **All 13 `r67/*`/`r70/*` Part-A branches merged into `main` (R71)**, 112 conflicts individually resolved and justified per-commit, zero regressions (A/B tested against `git tag r71-premerge-main`). `memory_records` DELETE gap FIXED (0551); a real, more severe pre-existing bug in the append-only guard (`search_vector` reads `NULL` in `NEW` inside `BEFORE UPDATE` because it's a `GENERATED` column) found and fixed (0554) — every legitimate `app_runtime` update, including the one supersede path the guard exists to allow, was silently rejected from this guard's creation at R68 Phase 1 until this fix. Dedup constraint + 3 new axes added to `memory_records` (0555, 0557); 143 legacy embeddings quarantined (0559). `connector_accounts` Composio coupling unchanged. Full detail: `platform.claude_log` id 187 (close) / 188 (self-report).
   - **`.env.local`'s `NEXT_PUBLIC_SUPABASE_URL`/`NEXT_PUBLIC_SUPABASE_ANON_KEY` were pointed at the WRONG Supabase project** (`evpckeuxgvahguwsaeul`, PROJEXA's own) **— found and fixed in R72 Phase 5.** See the corrected "Env Vars Required" section below; the note that used to live there (added 2026-08-29, claiming the opposite) was itself wrong — see `platform.claude_log` id 197 for the FK-join proof that settled it (392/414 real `auth.users` rows on `pcrjmlpuqsbocqfwoxod` resolve to real `compliance.users` rows).
   - **`vercel.json`'s `git.deploymentEnabled.main` is now `false`** (R72 Phase 6, was `true`) — pushing to `main` no longer auto-deploys anything, at all. This was a real, live gap: the R72 Phase 5 commit itself triggered a real `target:"production"` deployment attempt on push, harmless only because the project is paused. Any real deploy now requires the explicit, deliberate procedure in `R72_DEPLOY_RITUAL.md` (pre-deploy gate script `scripts/pre-deploy-gate.mjs`, then `vercel deploy`/`vercel deploy --prod`, then post-deploy checks, with a rollback procedure). `main` also gained basic GitHub branch protection this same phase (no force-push, no deletion) — it previously had none at all.
   - **No local database is possible on this machine** (Docker, WSL, and native PostgreSQL are all absent — R72 Phase 4, STOP-PHASE per that phase's own gate). Every DB-touching check in the R65–R72 series has run directly against the live Supabase project. See `R72_PARITY_GAP_REGISTER.md` for this and 9 other documented local-vs-production differences (local build OOMs under Node's default heap and needs `NODE_OPTIONS=--max-old-space-size=6144`; the repo's own `start` script is broken locally because `next.config.ts` never sets `output:'standalone'`; no Sentry telemetry locally; no CI gate exists at all — anywhere — the only enforcement has ever been a human or an AI session choosing to run these checks by hand).
   - `src/lib/db/schema.ts` has real, self-caused drift from R71's own raw-SQL migrations (R72 Phase 2/V2-04): `memoryRecords` is missing all 3 new axis columns and has 4 columns still typed as timezone-naive `timestamp()` when they were converted live to `timestamptz`; `embeddings` is missing the `quarantined` column; `compliance.engagements` and `compliance.tenant_memory_profile` have ZERO Drizzle declaration at all (unreachable from typed queries, raw SQL only). Reported, not yet fixed — do not assume schema.ts is authoritative for these tables/columns until it is.
   - `drizzle/meta/_journal.json` was already 5 migrations behind the real files (0546–0550 unregistered) before R71 touched it — still not fixed.
   - Owner decisions open: 34 from R71 (`platform.img_spec where blocked_on_human`, register in `claude_log` id 185) plus R72's own (Docker/WSL/native-Postgres install authorization for local dev; Vercel Deploy Hooks audit, outside this session's tool reach; Dependabot auto-merge exposure once main auto-deploy is eventually re-enabled).

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

## PROJEXA is a SEPARATE repository — do not confuse it with this one

**Added 2026-09-01, after a real multi-hour session confused these two apps and wasted a
full debugging cycle chasing the wrong codebase's UI.** If a task mentions PROJEXA,
PROJEXA-AI.COM, or "Sumeet's requirement", stop and check which repo you actually need
before touching anything here:

- **PROJEXA is its own independent Next.js application, `FChecklist/projexa`** — a
  separate git repo, separate Vercel project (`projexa`, not `veridian-compliance-ai`),
  separate local dev port (**3100**, `bun run dev` in that repo — this repo's dev server
  is 3000 and will NOT show you PROJEXA's UI no matter how it's configured).
- PROJEXA is **not a thin re-skin of this app's pages**. It has its own screens, its own
  component usage, and its own independent UI work-stream (construction/interior-design
  PM screens, "real-screen conversion" waves, etc.) built on top of the shared
  `@fchecklist/veridian-ui-kit` package. Bumping that shared kit's version in THIS repo
  only changes the shared shell components (`AppSidebar`/`AppHeader`) — it does **not**
  retrofit PROJEXA's product-specific screens, and it does not make this repo "become"
  PROJEXA. To see PROJEXA's real, current UI you must clone and run
  `FChecklist/projexa` itself.
- PROJEXA carries no construction/interior-design domain data of its own — that data is
  proxied through this repo's `/api/v1/projexa/*` surface (see PROJEXA's own
  `src/lib/veridian-client.ts`). That data-proxy relationship is real, but it does **not**
  mean the two apps share a frontend or a Supabase project.
- **Two different Supabase projects, easy to mix up:** this repo's `DATABASE_URL` points
  to project `pcrjmlpuqsbocqfwoxod` (named "verdian-ai" in Supabase). PROJEXA's own
  `NEXT_PUBLIC_SUPABASE_URL`/tenant-auth data lives in a **different** project,
  `evpckeuxgvahguwsaeul` (literally named "projexa" in Supabase, `ACTIVE_HEALTHY`) — do
  not assume one project's schema/data tells you anything about the other, and do not
  assume a migration applied to one project reached the other.
- If you're asked to screenshot, demo, or verify "the real UI/UX" for PROJEXA
  specifically: go run `FChecklist/projexa` locally (port 3100), not this repo — verify
  which repo you're actually looking at before reporting anything back.

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
- `bun run db:migrate` — apply migrations (`scripts/apply-migrations.mjs`). Does **not** use drizzle's own migrator, and the difference matters: drizzle-kit decides what to apply by comparing each journal entry's `when` against a single `max(created_at)` watermark, so any migration merged with a timestamp at or below that watermark is skipped *silently and permanently* (exit 0, no output). Three real migrations were dead in production for weeks this way — see `platform.r43_faults` fault_id `E74_MIGRATOR_CURSOR_ORPHANS_MIGRATIONS` and `scripts/migration-ledger.mjs`'s header for the annotated upstream source. This runner instead applies every journal entry that has no row in `drizzle.__drizzle_migrations`, in journal array order, in one transaction, writing the same ledger format drizzle reads. CI enforces the invariant from both sides via `scripts/check-migration-integrity.mjs`: no new migration may carry a backward `when`, and no journal entry may be orphaned.
- `bun run db:seed` — seed database (src/db/seed.ts)
- `bun run check:migration-replay` — replay the whole `drizzle/` folder against a genuinely empty Postgres (PGlite — real Postgres as WASM, no server or Docker) and report where it breaks. **Today it breaks badly and that is expected**: only 50 of 360 entries apply cleanly, first failure at array position 3, because 95 live tables and `compliance.current_org_id()` have no `CREATE TABLE`/`CREATE FUNCTION` anywhere in `drizzle/` — most of this schema was built with `db:push`, which writes nothing to the migration folder. So **the migration folder is not a from-empty build source and never has been**; do not plan a disaster-recovery or new-environment story around `db:migrate` alone until that changes. Tracked as fault_id `E103_MIGRATION_REPLAY_EMPTY_DB_BREAK`; this command is the instrument that makes progress on it measurable rather than arguable.
- `node scripts/pre-deploy-gate.mjs` — **run this before every deploy** (R72 Phase 7). Runs install/typecheck/lint/test/build in sequence, with `NODE_OPTIONS` raised to survive this machine's RAM constraint, and diffs the test run against `known-test-failures-baseline.json` (a real, deterministic, already-proven-pre-existing set of 69 failures — see `claude_log` ids 176/193/198) so a genuinely NEW failure blocks and a known one doesn't. Exit 0 = safe to proceed to `R72_DEPLOY_RITUAL.md`'s deploy step. See that file for the full procedure, including post-deploy checks and rollback.

## Env Vars Required
- `DATABASE_URL` — PostgreSQL connection string (Supabase pooler preferred).
- `NEXT_PUBLIC_SUPABASE_URL` — Supabase project URL.
- `NEXT_PUBLIC_SUPABASE_ANON_KEY` — Supabase anon key.
- `SUPABASE_SERVICE_ROLE_KEY` — Supabase service role (server-side only).

**All four of the above point to the SAME project: `pcrjmlpuqsbocqfwoxod` ("verdian-ai").**
This repo does not have or need a second Supabase project of its own. **Corrected
2026-09-04 (R72 Phase 5/8) — an earlier version of this note (added 2026-08-29) claimed
`NEXT_PUBLIC_SUPABASE_URL`/`NEXT_PUBLIC_SUPABASE_ANON_KEY` should instead point at
`evpckeuxgvahguwsaeul` ("projexa"), citing "real login network requests" as proof. That
was wrong, and resolved decisively rather than just reasserted: `compliance.users`'s own
`auth_user_id` foreign key — this app's actual, self-consistent link from business data to
Supabase Auth — resolves 392 of 414 real `auth.users` rows on `pcrjmlpuqsbocqfwoxod`
itself to real `compliance.users` business rows (full proof:
`platform.claude_log` id 197). A 392-row match on random UUID primary keys is not
explainable any other way. Vercel's own configured Production/Preview/Development env vars
have said `pcrjmlpuqsbocqfwoxod` since this project was created, independent of anything
in this file. The most likely explanation for the 08-29 note: that session tested against
a LOCAL `.env.local` that already had this same `evpckeuxgvahguwsaeul` misconfiguration
(found live, still present, in R72 Phase 5 — see `R72_PARITY_GAP_REGISTER.md` item 2), and
mistook the observed local behavior for the app's real intended architecture without
cross-checking either Vercel's own config or the business schema's own foreign keys.**

**PROJEXA (`FChecklist/projexa`, a genuinely separate app — see the section above) is the
one that legitimately uses `evpckeuxgvahguwsaeul`.** If you are working in THIS repo and a
value points at `evpckeuxgvahguwsaeul`, that is a bug, not an intentional shared-backend
design — fix it back to `pcrjmlpuqsbocqfwoxod` rather than assuming a past session's note
justified it. `vercel env pull .env.local --environment=development` is the fastest way to
get back to Vercel's own authoritative values if `.env.local` ever drifts again.

## Local Dev on Windows — 4 real gotchas (2026-08-29, +2 added 2026-09-04 R72 Phase 3/7)
- **`bun run dev` fails** (`bun: command not found: tee`) — the script pipes through `tee dev.log`, which bun's Windows script runner doesn't support. Run the underlying command directly instead: `node scripts/generate-protected-routes.mjs && bunx next dev -p 3000`.
- **Turbopack panics with `path length ... exceeds max length of filesystem`** if the clone lives at a long/deeply-nested path (e.g. under a deep temp/scratchpad directory). Clone to a short path instead (e.g. `C:\ct\ct`) for any local dev/build work on Windows.
- **Both `bun run build` and `bun run typecheck` OOM under Node's default heap** (~2.1GB V8 old-space limit) on this laptop's 8GB total RAM — confirmed independently in R71 Phase 4 and again in R72 Phase 3/7 (the first draft of `scripts/pre-deploy-gate.mjs` only raised the heap for the build step and still OOM'd on `tsc --noEmit`). Set `NODE_OPTIONS=--max-old-space-size=6144` before running either — `scripts/pre-deploy-gate.mjs` does this automatically for both.
- **`bun run start` is broken** — it runs `bun .next/standalone/server.js`, but `next.config.ts` never sets `output: 'standalone'`, so that file never gets built ("Module not found"). Use `next start` directly instead (serves the same `.next` build fine) until someone decides whether to add `output:'standalone'` or fix the script. Filed, not fixed, in R72 Phase 3 (`claude_log` id 193).

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
