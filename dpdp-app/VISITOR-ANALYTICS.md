# Visitor analytics: the DPDP relay also feeds the one central dashboard (branch feat/visitor-analytics-2026-11-03, NOT live)

The site already has its own first-party visit journey (`public/visit.js` -> `/api/visit` relay -> the `dpdp-track` Edge Function). That is NOT changed and there is no second script.
What is new: the relay (`functions/api/_visit.ts`) also copies each beacon it accepts into the ONE central visitor database that every site of ours shares, so the owner sees every site in one private dashboard.

- `functions/api/_visit-mirror.ts` translates the beacon to the central format (field names, 24-hex visitor code to 32, `cta` and `choice` events to named actions, landing page / referrer / campaign tags only from the first message of a visit) and hands it to the collector. The address, country, city and network come from what Cloudflare saw on that request, never from the page.
- `functions/_analytics/core.ts` is a byte-for-byte copy of `C:/ct/test-sites/site-analytics/src/core.ts` (the copy leaves out the entries of the sites that must not be linked to our other products; checksum in `functions/_analytics/SOURCE.json`; ESLint ignores it because it is changed at its source only). Re-copy with `node C:/ct/test-sites/site-analytics/tools/sync.mjs relay <this folder>`.
- The collector keeps a shortened address (IPv4 last number hidden, IPv6 first 48 bits) and a keyed hash, honours Global Privacy Control / Do Not Track (anonymous counters only) and refuses every path under /app /act /unsubscribe /p /copy /ai /api. The owner's full-address switch is OFF by default.
- Hosts accepted for this site: `veridian-aios.com`, `www.`, `app.`, `dpdp.`. The pages.dev address is not counted.
- What the central dashboard shows for this site: visitors, pages, sections, clicks (`go:/...` = a link or button to that page, `choice:...` = a closed-set choice), entry and exit, sources, devices, places. Its funnel stops at "visit" and "pricing": sign-up and payment happen in the signed-in app (Supabase), which is not mirrored.

## Before it can go live (owner / boss)
1. Create the central database once: `wrangler d1 create site-analytics`, put the real id into the commented `ANALYTICS` block at the end of `wrangler.toml`, remove the `#`. (Without the binding the relay behaves exactly as before.)
2. Pages secret `ANALYTICS_KEY` on the `veridian-dpdp-app` project (same value as on the other sites). Never in a file.
3. **Do not merge this branch into main without the boss's go: a push to `main` touching `dpdp-app/**` starts the Cloudflare Pages deploy workflow.** With the binding still a comment the deployed behaviour is identical to today's.
4. Wording to check (NOT edited here): the site's privacy text about the visit journey says where the data is kept; a second store (the central database, also Cloudflare) is now involved. The owner / a lawyer decides whether the sentence needs a line.
5. Rollback: record the current deployment id first.

Tests: `bun test src/lib/visit-mirror.test.ts src/lib/visit-relay.test.ts` (12 new + the 6 existing relay tests; 3 planted breaks all caught). Restricted typecheck of the changed files and ESLint on `functions/` and the new test: clean. Offline wrangler functions build: routes unchanged (`/ai/*`, `/api/visit`, `/api/telemetry`, `/api/mode`).
