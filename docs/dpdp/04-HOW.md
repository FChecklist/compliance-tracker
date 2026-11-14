# HOW to run, test, deploy, switch and roll back

## 1. Run it locally in mock mode (no database, no real data)

`VITE_MOCK=1` swaps Supabase for an in-browser engine (`src/lib/mock-client.ts`, plus `icp-mock.ts` and `icp-prove-mock.ts` for the weekly cycle). Everything is made-up data held in the browser.

```bash
cd dpdp-app
bun install
VITE_MOCK=1 bunx vite --port 4173 --host 127.0.0.1
```

Open `http://127.0.0.1:4173/app/?mock=<scenario>`. Scenarios: `visitor` (sign-in), `owner` (first visit), `owner-live` (the weekly page, already set up), `client-owner`, `partner`, `manager`, `go`, `coord`, `staff`, `hr`, `member`, `member2`, `member3`. The tests set the browser value `dpdp.view=full` to show the full view.

On Windows, stop the server with `powershell -File scripts/windows-dev-process-guard.ps1 -StopPort 4173` (from the repository root) so no child process is left holding memory. Building or type-checking needs a large heap (`NODE_OPTIONS=--max-old-space-size=6144`).

## 2. Tests

| What | Command (from the stated folder) |
|---|---|
| dpdp-app unit tests | `cd dpdp-app && bun test --isolate ./src` (always `--isolate`, as CI does) |
| Type check and lint | `cd dpdp-app && bun run typecheck && bunx eslint src` |
| Database tests (real Postgres as WebAssembly, no server) | `bun test --isolate src/lib/services/dpdp-icp-identify-classify.pglite.test.ts src/lib/services/dpdp-icp-prove.pglite.test.ts src/lib/services/dpdp-icp-monday-block.pglite.test.ts src/lib/services/dpdp-icp-email-block.test.ts` (repository root) |
| Full app build gate | `cd dpdp-app && bun run build` (type check, public-facts check, build, sitemap, public-surface, claims and two-doors checks) |
| Browser tests | `cd dpdp-app && VITE_MOCK=1 bun run build && bunx playwright test e2e/icp-week.spec.ts` (needs a lot of free memory; CI is the proof surface) |

A good habit used here: after fixing something, plant the break again and confirm the test fails, then restore.

## 3. The deploy order, and why it was changed

Merging to `main` auto-deploys the app to Cloudflare Pages (`dpdp-app-deploy.yml`). If the app went live first, people would meet new screens whose database functions do not exist yet. So the order used on 14 November was:

1. Confirm CI is fully green on the pull request head.
2. **Record the rollback ids first** (section 5) and tell the boss.
3. **Apply `0761`, `0762`, `0763` to the live database, in that order, checking each** (they are additive; the old app ignores them).
4. Merge the pull request (REST merge call; the app deploys itself).
5. Deploy the edge function `dpdp-monday-email` with the block switch already set to `0`.
6. Check: tables exist with row security on and no anonymous access; the append-only trigger; the new public functions; the Prove stage has seven steps on a real organisation; the weekly e-mail function runs read-only for real organisations and writes nothing; the edge function answers 401 without the bearer secret; the app host answers 200.

The original plan in `dpdp-app/docs/icp/OWNER-NOTE.md` treated "deploy the app" as a separate step after the migrations and the edge function. In fact the merge itself is the app deploy, so the migrations had to come before the merge, and the edge function was deployed after it with the block switch already off.

How the migrations are applied: the Supabase Management API `database/migrations` endpoint (or the Supabase MCP `apply_migration`), one file per call, named after the file. `db-migrate.yml` is manual only and is not used for these.

How the edge function is deployed: the Management API `functions/deploy?slug=dpdp-monday-email` multipart upload with the entry point `index.ts` and every local file it imports (`icp-block.ts`, `render.ts`, and the shared files they reach).

## 4. Turn the Monday e-mail block on or off

The switch is the edge function secret `DPDP_EMAIL_ICP_ENABLED`.

- **Off** (now): set it to exactly `0`. The block is added to no e-mail and nothing is written to the weekly record.
- **On**: delete the secret or set it to any other value (for example `1`).

Before turning it on, do a real dry run: POST `{"job":"monday","orgId":"<test org>","dryRun":true}` to the function with the timer secret (the cron reads it from the database vault); read the e-mail; confirm each recipient sees only their own clients. This dry run has **not** been done yet (the person who deployed does not hold the timer secret). When switched on, the first real Monday run writes the first weekly snapshot rows.

## 5. Roll back

Order, fastest first:

1. **Hide the e-mail block:** set `DPDP_EMAIL_ICP_ENABLED=0` (already so).
2. **App:** redeploy the previous Cloudflare Pages deployment (`45d0135d-9926-4471-ab9e-fdf38f431855`, commit `710abfd8`, 7 November) or the previous `main` commit `58edc3b67961f42eb8d0f86bde82819ba33cd8fe`.
3. **Edge function:** redeploy the previous source (version 39 = the function as in `main` at `58edc3b6`).
4. **Database** (only if it must go back): run the down files in the order **0763, then 0762, then 0761**. Cost: 0761's down deletes the register lines and weekly records written since; 0762's down deletes evidence and erasure rows (breach, request and grievance rows stay, History events stay); 0763's down removes only the e-mail function, helper and unique index. The database state before: 768 migrations, last `dpdp_extra_client_price_rs50_0756`. No Supabase branch or backup was available through the tool at the time.

Ids recorded before the change: previous `main` `58edc3b6…`; Cloudflare deployment `45d0135d-…`; edge function previous version 39; database last migration `dpdp_extra_client_price_rs50_0756`.
