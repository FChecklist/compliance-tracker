# dpdp-track -- first-party visitor-journey tracking (marketing + conversions)

Owner-approved 2026-10-06 (chat, "ok do it"). Database: `drizzle/0733_dpdp_visitor_journey.sql`. Shared code: `supabase/functions/_shared/visit/*`.
Browser side: `dpdp-app/public/visit.js` (public pages), `dpdp-app/functions/api/visit.ts` (Cloudflare Pages relay), `dpdp-app/src/lib/visit-link.ts` (signed-in app).
Tests: `src/lib/services/dpdp-visit-pure.test.ts`, `dpdp-track-handler.test.ts`, `dpdp-visitor-journey.pglite.test.ts` (the whole migration on real Postgres via PGlite),
`dpdp-app/src/lib/visit-script.test.ts`, `visit-relay.test.ts`, `visit-link.test.ts`.

## What is recorded (public pages only)

Source (referring site NAME, UTM tags, search engine / AI assistant), landing page, device, language, country and city (Cloudflare), repeat visits, which section of a page was seen and
for how long, calls to action (link destination path), choices (dropdown / radio / tick-box slugs only), scroll depth, and the exit (last page, last section, visible time, scroll).
A random visitor id (cookie `dpdp_vid` + local storage, one year). A SHORTENED ip (IPv4 last octet zeroed, IPv6 /48) and an HMAC-SHA256 of the full address keyed by `DPDP_VISIT_KEY`.
Never recorded: typed text, names, e-mails, the query string, the raw IP, anything from `/app/ /act/ /unsubscribe/ /p/ /copy/ /ai/ /api/`.

Global Privacy Control / Do Not Track: no id, no cookie, no storage; one count-only ping that only increments a daily total (`dpdp.visit_agg`, dimension `off_pv`). Enforced in the script AND
again in the function from the `Sec-GPC` / `DNT` request headers.

Bots (named crawlers + generic scripts): stored with `is_bot`, page views only, no visitor id; excluded from every human number and from the funnel; listed apart in the report.

## Funnel (computed at report time, per visitor, by FIRST-touch source)

visit -> key page (`/dpdp-firm/ /dpdp-institution/ /pricing/ /partner/ /about/ /ai-assistant/`, any section view or choice) -> call to action -> sign-up (`dpdp.visit_link`, written by `POST /link`
from the signed-in browser; the SERVER resolves the person's identity id, no e-mail is stored) -> organisation created (`dpdp.event` `organisation_created`) -> first-visit wizard
(`dpdp.membership.first_visit_seen_at`) -> paid (`dpdp.event` `payment_confirmed`, the product's existing payment confirmation, for an organisation the person owns). Each stage must happen
AFTER the visitor's first visit. A later stage implies the earlier ones. A visitor with no id counts per session.

## Routes (`/functions/v1/dpdp-track/...`, deployed `verify_jwt: false`)

| Route | Who | What |
|---|---|---|
| `POST /` | anyone (origin-checked, 6 KB, rate limited per visitor id and per ip hash) | the beacon; always 204 (429 when over the limit) |
| `POST /link` | signed in | `{ "vid": "<visitor id>" }` -> links the visitor to the person's identity id |
| `GET /report?days=30&format=json\|md` | platform owner only (`dpdp.platform_admin`) | summary: visitors, sessions, sources, campaigns, landing pages, sections + dwell, exits, calls to action, choices, places, devices, funnel by source, converted-by-source, returning visitors / returning ip hashes, crawlers |
| `GET /journey?vid=<visitor id>` or `?identity=<identity id>` | platform owner only | one visitor's whole path from the first visit |

Every owner read writes `dpdp.audit_access_log` FIRST (`dpdp_audit_staff_begin`, organisation `*visits`, a reason of at least 10 characters; pass `&reason=` to say why, a default is supplied) and is completed afterwards.
No log row, no data.

Owner usage (the JWT of the owner's own signed-in session; nothing is e-mailed):
`curl -H "Authorization: Bearer <access token>" "https://pcrjmlpuqsbocqfwoxod.supabase.co/functions/v1/dpdp-track/report?days=30&format=md"`

## Secrets

Edge Function secrets (`supabase secrets set ... --project-ref pcrjmlpuqsbocqfwoxod`):

| Name | Meaning |
|---|---|
| `DPDP_VISIT_KEY` | REQUIRED for ip hashing: `openssl rand -base64 32`. Without it no hash is stored (never an unkeyed one); everything else still works. Rotating it breaks "same IP again" matching across the rotation, nothing else. |
| `DPDP_VISIT_PROXY_KEY` | optional, 16+ chars. Same value as the Cloudflare Pages secret `VISIT_PROXY_KEY`. With it, the address / country / city the Pages relay forwards are trusted; without it the function uses its own gateway's `x-forwarded-for` / `cf-ipcountry` and city stays empty. |
| `DPDP_VISIT_RATE_PER_MIN` | optional, default 60 batches' worth of events per visitor id per minute (clamped 10..600). |

Cloudflare Pages secret: `wrangler pages secret put VISIT_PROXY_KEY --project-name veridian-dpdp-app` (optional, see above).

## Deploy

1. Apply `drizzle/0733_dpdp_visitor_journey.sql` (lead, after review). 2. Set `DPDP_VISIT_KEY` (and the optional proxy key on both sides). 3. `supabase functions deploy dpdp-track --no-verify-jwt --project-ref pcrjmlpuqsbocqfwoxod`.
4. The Pages deploy (`dpdp-app-deploy.yml`) ships `visit.js`, `/api/visit` and the privacy notice v1.8 together; deploy 1-3 first so the first beacons have somewhere to land (until then the relay answers 204 and nothing is stored).

## Retention

`public.dpdp_visit_retention(365)`, pg_cron `dpdp-visit-retention` daily 00:40 UTC (plain SQL, no HTTP): writes anonymised day-level aggregates (`dpdp.visit_agg`: sessions by source, landing, country,
device, exit, section dwell, calls to action, choices, and the funnel by source for visitors whose last visit is going) and THEN deletes raw sessions / events / links older than 365 days, in one transaction.
The aggregates hold no visitor id, no address, no hash and no identity id (proven in the PGlite test).
