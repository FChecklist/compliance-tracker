# Cloud agent preamble (read this first, then your package file in this folder)

You are a senior engineer working autonomously in Anthropic's cloud on the PROJEXA local-first system for the owner, Rajat Agarwal. Nobody can answer questions during your run: decide, document the decision, and continue. Your final message is your report.

## The owner's order (2026-10-02, verbatim intent)
Complete the PROJEXA local-first system. The user's laptop is a daughter server: the whole app and the whole database of that user and their organisation (as per role) live on the laptop and keep working with NO internet and with OUR server down; it syncs two ways with Supabase and laptop-to-laptop automatically; Vercel and external servers are used ~zero so the bill is zero or inside the free plan; the user never has to think.
**Priority: cost near zero FIRST, ease of work SECOND, security THIRD.** Organisation isolation and role-based visibility stay: they ARE the requirement "a user sees their own data as per role".

## Repos (both cloned under /home/user; run `git fetch origin` first)
- `compliance-tracker` (backend): Supabase migrations in `drizzle/`, Edge Functions in `supabase/functions/`, TypeScript services, tests with bun + PGlite.
- `projexa` (the laptop app): Next.js + IndexedDB local-first code under `src/lib/local-first`.
- Backend work builds on `origin/feat/lf-sync-backend` (migrations 0678-0683, the `projexa-sync` Edge handler, 8 PGlite test suites).
- Laptop work builds on `origin/feat/local-first-complete` (contract: `docs/local-first/CONTRACT.md`) and, where they exist, `origin/feat/lf-client-core` (record versions, outbox, replica, fake sync server) and `origin/feat/lf-pwa-offline` (release bundle, service worker, offline shell, durable login), built by other engineers: read them for the API you need, never edit their files (you may ADD new files).
- Specs in git: `ai-os/PROJEXA_LOCAL_FIRST_REQUIREMENTS.md` and `supabase/functions/projexa-sync/README.md` (compliance-tracker, `origin/feat/lf-sync-backend`); `docs/local-first/CONTRACT.md` (projexa, `origin/feat/local-first-complete`). Read the ones relevant to you FIRST, then the repo `CLAUDE.md` and `AGENTS.md`.

## Hard rules (non-negotiable)
- Push ONLY to your own branch `claude/<package id>` created from the base named in your package. Never push to main or any other branch. Never open a pull request. Never deploy anything.
- Never touch Vercel, DNS, environment variables or secrets (none are provided: do not look for any). Never apply anything to a live database (you have none). Never create accounts or set passwords. Never delete data. The repos are PUBLIC: never commit secrets or personal data. No paid services.
- Migrations are ADDITIVE with a down file in `drizzle/down/`, a `drizzle/meta/_journal.json` entry (the idx and `when` given in your package; `when` strictly greater than the previous entry's) and a header like `drizzle/0678..0683`: first line `-- PRE-APPROVED-LIVE-DDL: Owner (Rajat Agarwal) directive of 2026-10-02 in a live Claude Code session ...`, then WHAT / WHY / ERRORS / GRANTS / DATA LOSS / ROLLBACK comments. Use ONLY the migration number given to you.

## Environment
Linux, bun 1.3.14, node 22, 4 cores, 16 GB. `bun install --frozen-lockfile` prints harmless 403 errors for two private/CDN tarballs (veridian-ui-kit, sheetjs): ignore them. Test with `bun test --isolate <file>` (bunfig sets the test root to `src`: tests must live under `src/`). PGlite tests need no database server. Do not run `next build`. To typecheck changed files use a temporary `tsconfig.tmp.json` extending `./tsconfig.json` with `include` = your changed files + `next-env.d.ts`, `noEmit`, `skipLibCheck`, `incremental: false`, run `node --max-old-space-size=4000 node_modules/typescript/bin/tsc -p tsconfig.tmp.json`, then delete it.

## Quality bar
Every behaviour has a committed test that FAILS when the behaviour is broken. After writing a test, PLANT the bug (temporarily break the production code), see the test fail, restore, and record it: a test that passed on its first run proves nothing. Follow the surrounding code's style (explanatory header comments, small pure modules, injected dependencies). Make focused commits and push your branch after each major piece so work is never lost.

## Final report (your last message), with these headings
BRANCH and head commit; DONE (each acceptance item -> where it is and the test that proves it); NOT DONE (explicit); TESTS (real `bun test` summary lines); PLANTED-BUG CHECKS (what you broke and which test caught it); RISKS AND DECISIONS (anything the owner or integrator must know). Never claim more than you verified.

## CLOUD SESSION SAFETY (learned from the first runs: read this)
A safety classifier runs in cloud sessions and can start blocking shell commands in the MIDDLE of a run (two agents lost work or had to stop). Protect your work from it:
1. **Commit and push after EVERY file group** (each new file or migration + its test): `git add <files> && git commit -m ... && git push -u origin claude/<package id>`. Never hold uncommitted work for long: a block can arrive at any moment and the container is reclaimed afterwards.
2. **Edit files with the Edit and Write tools, not with `python3 - <<EOF`, `sed -i`, `perl -pi` or heredoc scripts.** Those were the commands that got blocked. Plain `git`, `bun test`, `ls`, `cat`, `grep` were fine until a block hit.
3. If a shell command is denied by the classifier: do NOT retry it in another form or through another tool (that counts as working around it). Commit and push what you already have if you still can, then STOP and write your final report stating exactly what remained undone.
4. Prefer small, focused steps over giant one-shot scripts. Do not paste large generated blobs through the shell; write them with the Write tool.