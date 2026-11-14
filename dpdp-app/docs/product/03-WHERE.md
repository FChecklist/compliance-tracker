# WHERE everything is

All paths are in `FChecklist/compliance-tracker`.

## Database (Supabase Postgres, schema `dpdp`, public functions in `public`)

| Thing | Where |
|---|---|
| Migrations | `drizzle/0761_dpdp_icp_identify_classify.sql`, `drizzle/0762_dpdp_icp_prove.sql`, `drizzle/0763_dpdp_icp_monday_block.sql` |
| Down (undo) files | `drizzle/down/0761_…down.sql`, `0762_…down.sql`, `0763_…down.sql` (each carries a pre-approved-live-DDL citation line) |
| Tables | `dpdp.icp_item` (register), `dpdp.icp_run` (append-only weekly record), `dpdp.icp_evidence` (append-only), `dpdp.icp_erasure`; reused: `dpdp.breach`, `dpdp.rights_request`, `dpdp.grievance`, `dpdp.event` (hash-chained History) |
| Key functions | status and register: `dpdp_icp_status`, `dpdp_icp_apply_rules`; Prove: evidence add/withdraw, breach log/update, request log/close, erasure log/close, `dpdp_icp_prove_overview`, `dpdp_icp_evidence_pack`; internal: `dpdp.icp_chain_check`, `dpdp.icp_clients_of(identity, excluded org)`, `dpdp.icp_not_contact` (free-text guard) |
| E-mail function | `public.dpdp_timer_icp_weekly(org, now, record)`, service role only; returns the stages, carry-over, the members who may see it and `clientsByViewer` (keyed by membership; the top-level client list is always empty) |
| Append event | `dpdp__append_event` (0761 adds an advisory lock around the chain write) |

## App (`dpdp-app/`, Vite + React)

| Thing | Where |
|---|---|
| Weekly page | `src/components/IcpWeek.tsx`; Prove panels `src/components/ProvePanel.tsx` |
| Logic and tests | `src/lib/icp.ts`, `icp-prove.ts` (+ `.test.ts`) |
| Offline mock engine | `src/lib/icp-mock.ts`, `icp-prove-mock.ts`, `src/lib/mock-client.ts` |
| Wiring | `src/App.tsx` (the organisation hint `?org=` is used once, then removed), `src/lib/api.ts`, `src/lib/device-copy/page-copy.ts` |
| Public wording | `data/veridian-facts.yaml` (source of the generated public pages), `data/claims-register.yaml` (`CLM-004`) |
| E2E spec | `e2e/icp-week.spec.ts` |
| Docs | `docs/icp/` (plan, gaps, round log, owner note), `docs/product/` (these pages), `DEPLOY.md`, `OPERATIONS.md` |

## Edge function

`supabase/functions/dpdp-monday-email/` — `index.ts` (per-organisation fetch, attaches each recipient's own clients only, records only on a real send, the switch), `icp-block.ts` (pure renderer), `render.ts` (places the block before "Your controls"), `README.md`. Supabase function name `dpdp-monday-email`. Scheduling: pg_cron `dpdp-monday-digest` (Monday 00:30 UTC) with retries; see `dpdp-app/OPERATIONS.md`.

## Tests

`src/lib/services/dpdp-icp-identify-classify.pglite.test.ts` (23), `dpdp-icp-prove.pglite.test.ts` (26), `dpdp-icp-monday-block.pglite.test.ts` (14), `dpdp-icp-email-block.test.ts` (14); `dpdp-app` unit tests (840 in total with `bun test --isolate ./src`); e2e as above.

## Hosting and workflows

| Thing | Where |
|---|---|
| App host | Cloudflare Pages project `veridian-dpdp-app`, served at `app.veridian-aios.com` |
| App deploy | `.github/workflows/dpdp-app-deploy.yml`: runs on push to `main` when a path under `dpdp-app/**` (or the workflow file) changes, and on manual dispatch. **Docs under `dpdp-app/docs/` also match that filter**, so a docs-only change there triggers a (harmless, identical) rebuild and redeploy |
| App CI | `.github/workflows/dpdp-app-ci.yml` |
| Database migration | `.github/workflows/db-migrate.yml` (manual only) |
| Live check | `.github/workflows/dpdp-live-smoke.yml` (daily 05:15 UTC), `dpdp-site-health.yml` |
| Vercel | `deploy-prebuilt.yml` runs only when the repository variable `PREBUILT_DEPLOY_ON_PUSH` is `"true"`; it is unset, so no Vercel deploy happens |

## Secrets and settings (names only)

Edge function secret `DPDP_EMAIL_ICP_ENABLED` (the e-mail block switch); the timer secret read from the database vault by the Monday cron (name `dpdp_timer_secret`); Cloudflare deploy credentials as repository secrets. Values are never recorded here.
