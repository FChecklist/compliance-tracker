# dpdp-app -- Cloudflare Pages: ready, not live (WO-DPDP-011 Step 7)

The DPDP app is static files. It is served by **Cloudflare Pages only**. Vercel is
never in the path (`vercel.json`'s `ignoreCommand` skips every Vercel build), and
nothing in this directory can deploy anywhere until the owner performs the
actions marked **OWNER** below.

## 1. What is deployed

| Path | What | Indexed? |
|---|---|---|
| `/` | root chooser (firm / institution) | yes |
| `/dpdp-firm/`, `/dpdp-institution/` | edition landing pages | yes |
| `/app/` | the signed-in one-page app (magic-link session in the `#fragment`) | **no** -- `noindex` meta + `X-Robots-Tag` via `public/_headers` |
| `/robots.txt`, `/sitemap.xml`, `/llms.txt`, `/llms-full.txt` | crawler files (WO-DPDP-012 §3) | -- |

Build: `bun run build` → `dist/`. The only build-time inputs are the **public**
Supabase URL and anon key. `scripts/scan-bundle.mjs` proves per build that
`service_role` never appears in `dist/`.

## 2. Two ways to connect -- pick one (OWNER)

### A. Pages Git integration (recommended: zero secrets in GitHub)
Cloudflare dashboard → Workers & Pages → Create → Pages → Connect to Git →
`FChecklist/compliance-tracker`:

| Setting | Value |
|---|---|
| Project name | `veridian-dpdp-app` |
| Production branch | `main` |
| Root directory | `dpdp-app` |
| Build command | `bun run build` |
| Build output directory | `dist` |
| Environment variables (Production + Preview) | `VITE_SUPABASE_URL=https://pcrjmlpuqsbocqfwoxod.supabase.co`, `VITE_SUPABASE_ANON_KEY=<anon key from Supabase → Project Settings → API>` |
| Preview deployments | on (every PR gets `<hash>.veridian-dpdp-app.pages.dev`) |

Pages detects `bun.lock` and installs with bun. `wrangler.toml` in this directory
pins the output directory.

### B. GitHub Actions deploy (`.github/workflows/dpdp-app-deploy.yml`)
Runs on every merge to `main` that touches `dpdp-app/**`. It is a **no-op until**
these exist in the repository settings:

| Kind | Name | Where from |
|---|---|---|
| Secret | `CLOUDFLARE_API_TOKEN` | Cloudflare → My Profile → API Tokens → template "Edit Cloudflare Workers" or custom with **Account → Cloudflare Pages → Edit** |
| Secret | `CLOUDFLARE_ACCOUNT_ID` | Cloudflare dashboard → Workers & Pages overview (right-hand column) |
| Variable | `VITE_SUPABASE_URL` | `https://pcrjmlpuqsbocqfwoxod.supabase.co` |
| Variable | `VITE_SUPABASE_ANON_KEY` | Supabase → Project Settings → API → anon public |

The Pages project `veridian-dpdp-app` must exist first (dashboard → Create →
Pages → "Upload assets" once, or `wrangler pages project create veridian-dpdp-app`).

## 3. Domain and DNS (OWNER)

1. Cloudflare → the Pages project → Custom domains → add `app.veridian-aios.com`.
2. DNS (zone `veridian-aios.com`): `CNAME app → veridian-dpdp-app.pages.dev`,
   proxied (orange cloud). Cloudflare issues the certificate automatically.
3. Until DNS exists, test on `https://veridian-dpdp-app.pages.dev` (the WO allows
   `*.pages.dev` for all testing).
4. Email domains (`send.` / `reply.veridian-aios.com`) are Resend's records, not
   Pages -- see the Step 4 README under `supabase/functions/dpdp-monday-email/`.

## 4. Supabase settings that must match (OWNER)

Authentication → URL Configuration:
- **Site URL**: `https://app.veridian-aios.com`
- **Redirect URLs**: `https://app.veridian-aios.com/app/**`,
  `https://veridian-dpdp-app.pages.dev/app/**`,
  `https://*.veridian-dpdp-app.pages.dev/app/**` (previews),
  `http://localhost:4173/**` (local `vite preview`).

A redirect not on this list is silently replaced by the Site URL (found live in
the Step 2 spike), so a missing entry looks like "the link opens the wrong site".

## 5. Go-live checklist -- every line is a yes/no with evidence

| # | Check | Evidence |
|---|---|---|
| 1 | `dpdp-app` CI job green on the merge commit | Actions → dpdp-app |
| 2 | Bundle key scan: `service_role` = 0 | CI step log |
| 3 | `/app/` returns `X-Robots-Tag: noindex, nofollow` and `Referrer-Policy: no-referrer` | `curl -I https://…/app/` |
| 4 | `/`, `/dpdp-firm/`, `/dpdp-institution/` readable with JS off (h1 + body in raw HTML) | `curl` output |
| 5 | `robots.txt`, `sitemap.xml`, `llms.txt` served; sitemap lists only public pages | `curl` |
| 6 | Magic link round-trip on the real host: email → link → `/app/#access_token…` → jobs load → fragment cleared | screen recording / test run |
| 7 | Mark Yes persists across reload; `dpdp.event` gains one `obligation_accepted` row with an intact chain | SQL re-read |
| 8 | Cross-tenant RPC tests green at a recorded SHA (`src/lib/services/dpdp-cross-tenant-rpc.test.ts`) | test run timestamp |
| 9 | 70 acceptance checks green against the static app, Next.js server off | Playwright report |
| 10 | Monday digest job ran once in dry-run and the log shows the expected recipients | `dpdp.email_send` rows |
| 11 | Resend domain verified and one real delivery observed | Resend dashboard |
| 12 | Each named crawler user agent gets HTTP 200 on public pages, 4xx on `/app/` | `curl -A` table |
| 13 | Owner sign-off recorded | KT folder |

## 6. Rollback

Cloudflare → Pages → Deployments → "Rollback to this deployment" on the previous
production build (instant, no rebuild). Nothing on Vercel changes either way.
