# STEP 4 static-export inventory — input to owner decision 13

PROJEXA-COST-001 §4 says: "Vercel serves static files only — Next.js static export,
CDN-cached; no server-rendered pages, no API routes on the normal path." WO-DPDP-011
(same repo, same day) chose the opposite mechanics for one app's user-facing journey
(Vite + Cloudflare Pages + SECURITY DEFINER RPCs) after finding it hit three of Next's
`output: 'export'` unsupported features at once. This is the factual inventory the
owner needs to pick one direction for both products (decision 13) — no recommendation
is made here.

**Tool:** `scripts/static-export-inventory.mjs` (zero dependencies, regex-based —
see its own header for stated limits). **Re-run determinism confirmed:** a fresh run
against `compliance-tracker` on 2026-09-24 reproduced the committed CSV byte-for-byte.
**Unit-tested:** `scripts/static-export-inventory.test.mjs`, 21 pass, exercising every
exported detector against small in-memory snippets. Full data:
`ai-os/step4-static-export-inventory-compliance-tracker.csv` (1,491 rows),
`ai-os/step4-static-export-inventory-projexa.csv` (505 rows).

## 1. Headline numbers

| | compliance-tracker | projexa |
|---|---|---|
| Pages | 233 | 192 |
| Layouts | 8 | 2 |
| Route handlers | 1,250 | 311 |
| **Exportable as-is** | **0** | **0** |

**Every single file in both repos is blocked from `output: 'export'` today.** The
dominant reason in both repos is `NOT_FORCE_STATIC` (every route handler, 1,250 + 311
of them — see §2), not a per-page defect that could be fixed one screen at a time.

### Top blockers, compliance-tracker (of 1,491 files)
`NOT_FORCE_STATIC` 1,250 · `READS_REQUEST` 962 · `NON_GET_METHOD` 906 ·
`DYNAMIC_SEGMENT_NO_GSP` 621 · `NEXT_HEADERS_TRANSITIVE` 241 ·
`SERVER_ACTION_TRANSITIVE` 175 · `FORCE_DYNAMIC` 107 ·
`REDIRECT_IN_SERVER_COMPONENT` 34 · `NEXT_HEADERS` 12 · `AFTER` 2

### Top blockers, projexa (of 505 files)
`NOT_FORCE_STATIC` 311 · `READS_REQUEST` 224 · `NON_GET_METHOD` 217 ·
`DYNAMIC_SEGMENT_NO_GSP` 197 · `NEXT_HEADERS_TRANSITIVE` 189 ·
`SEARCH_PARAMS_PROP` 79 · `FORCE_DYNAMIC` 9 · `REDIRECT_IN_SERVER_COMPONENT` 5 ·
`ISR_REVALIDATE` 5 · `NEXT_HEADERS` 1. **5 files are `neutralizedByForceStatic`**
(they read `cookies()`/`headers()`/`searchParams` but are marked
`force-static`, so Next 16's own source empties those reads instead of blocking —
see the script's header for the exact `dist/server/request/*.js` citation).

## 2. Why route handlers dominate — this is architectural, not per-file

Next's own bundled guide (`node_modules/next/dist/docs/01-app/02-guides/static-exports.md`,
"Unsupported Features") states Route Handlers are exportable **only** when they
"generate a static response" — in practice: the only exported verb is `GET`, the
route exports `export const dynamic = 'force-static'` explicitly, and the handler
never reads the incoming request. Almost none of these do:

- **`NON_GET_METHOD`** (906 / 217): most routes export `POST`/`PATCH`/`DELETE` —
  compliance-tracker's whole API is CRUD over Drizzle, and PROJEXA's `/api/v1/*`
  proxy layer forwards whatever verb the caller used.
- **`READS_REQUEST`** (962 / 224): nearly every handler reads `request.json()`,
  a header, or `request.nextUrl` — needed for `requireAuth()`/`requireRole()`
  (compliance-tracker) or to forward the caller's identity (PROJEXA's proxy).
- **`NOT_FORCE_STATIC`**: no route handler in either repo declares
  `export const dynamic = 'force-static'`. Exportability requires it explicitly
  per the guide — absence alone is a blocker on every route, independent of the
  other three.

None of this is a handful of stray flags to flip — it is the shape of a CRUD API.

## 3. Repo-level blockers (beyond individual files)

- **`src/proxy.ts`** (compliance-tracker) — Supabase session refresh + protected-route
  redirect, runs on every navigation. Next's guide lists "Proxy" (Next 16's
  rename of Middleware) as unsupported for static export outright.
- **`next.config.ts` `headers()`** (compliance-tracker) — also on the guide's
  unsupported list; a static export serves files with no per-route header
  injection point.
- **`src/i18n/request.ts`** reads `next/headers` (`cookies`) but is *invoked*
  by `getLocale()`/`getMessages()`/`getTranslations()`, not imported by name —
  an import-graph walk cannot see this edge, which is why the script's own
  header calls this out as a named exception it special-cases rather than a
  general capability.

## 4. The seven record types (PROJEXA-NEXT-001 Step 2 slice) — page-by-page

Per the work order's own naming, "BOQ" is PROJEXA's word for Scope of Work (see
`object-screens.ts` and this repo's own CLAUDE.md history) — routes are under `/scope`.

| Record type | Page(s) | Route file | Exportable today |
|---|---|---|---|
| Daily work progress | `/work-progress`, `/work-progress/[id]` | `src/app/(app)/work-progress/{,[id]/}page.tsx` | No |
| RFIs | `/rfis`, `/rfis/new`, `/rfis/[id]` | `src/app/(app)/rfis/{,new/,[id]/}page.tsx` | No |
| Punch list / snags | `/punch-list`, `/punch-list/new`, `/punch-list/[id]` | `src/app/(app)/punch-list/{,new/,[id]/}page.tsx` | No |
| Change orders | `/change-orders`, `/change-orders/new`, `/change-orders/[id]` | `src/app/(app)/change-orders/{,new/,[id]/}page.tsx` | No |
| Billing claims | `/billing-milestones` | `src/app/(app)/billing-milestones/page.tsx` | No |
| BOQ progress | `/scope`, `/scope/new`, `/scope/import`, `/scope/[id]`, `/scope/[id]/revise`, `/scope/[id]/compare` | `src/app/(app)/scope/**/page.tsx` | No |
| Exceptions | `/analysis/exceptions` | `src/app/(app)/analysis/exceptions/page.tsx` | No |

All 15 pages across the seven record types are blocked — every one is a dynamic
segment without `generateStaticParams` and/or reads `next/headers` transitively
through the shared app shell (`AppSidebar`/`AppHeader` from
`@fchecklist/veridian-ui-kit`, which reads the session).

## 5. What a browser-direct-to-Supabase design must replace

**Server-held secrets on the PROJEXA → VERIDIAN path** (`src/lib/veridian-client.ts`,
PROJEXA repo — names only, values never read here): `VERIDIAN_API_KEY`,
`VERIDIAN_PLATFORM_APPLICATION_KEY`. Every one of the seven record types above is
proxied through this client to compliance-tracker's `/api/v1/projexa/*` surface —
a browser calling Supabase directly for construction data has no equivalent of this
server-held key today; it would need real RLS policies on the underlying
`compliance.*` tables instead (see §6).

**Two different Supabase projects — a real auth boundary, not just a data
boundary.** PROJEXA's own users authenticate against Supabase project
`evpckeuxgvahguwsaeul`; the construction/compliance data these seven record types
live in is on `pcrjmlpuqsbocqfwoxod`. A browser holding a PROJEXA session JWT
cannot present it to `pcrjmlpuqsbocqfwoxod` and have it validate — that project's
`auth.users` table is a different user pool entirely. "Browser talks straight to
Supabase" therefore is not a wiring change on top of today's proxy; it requires
either issuing `pcrjmlpuqsbocqfwoxod`-native sessions to PROJEXA users, or a
token-exchange step, before any RLS policy can even be evaluated.

## 6. Comparison, facts only — no recommendation

| | Next.js static export on Vercel (COST-001 §4) | Vite + Cloudflare Pages (WO-DPDP-011) |
|---|---|---|
| Current blocker count | 1,491 + 505 = 1,996 files, 0 exportable | N/A — a from-scratch build, not a port of blocked files |
| Auth model needed | Native Supabase Auth (`pcrjmlpuqsbocqfwoxod`-issued sessions) reaching both Supabase projects, or a token exchange | WO-011's own plan: Supabase Auth magic links (Option A, its lean) or custom tokens exchanged via an Edge Function (Option B) |
| Data access | Direct browser → Supabase, RLS-gated (per COST-001 §4's own wording) | WO-011's spike used SECURITY DEFINER Postgres RPCs with the anon key, not raw table RLS |
| Server-side compute | None — CDN-served static files only, per Next's guide | None — Cloudflare Pages has no server runtime in this design (Pages Functions explicitly excluded, per WO-011's own note on where the service-role key may never go) |
| Unsupported-feature list (quoted, Next's own docs) | "Route Handlers that rely on Request", "Server Actions", "Cookies", "Rewrites", "Redirects", "Headers", "Proxy", "ISR", "Image Optimization (default loader)", "Draft Mode", "Dynamic Routes without generateStaticParams()", "Intercepting Routes" | Not applicable — Vite has no such restriction list; it never claimed Next.js semantics |
| Scope of rebuild implied | Every one of the 1,996 files above needs its blocker removed (many via the same shared-shell fix — `AppSidebar`/`AppHeader`'s session read is the common `NEXT_HEADERS_TRANSITIVE` ancestor for most pages) or the route restructured | A new, parallel app surface (already precedented once, for DPDP) — does not touch the existing Next.js codebase's routes at all |

Both are real, working options — WO-011 already proved the second is buildable in
this codebase. Which one fits PROJEXA's seven record types (a full CRUD product
surface, not one static journey) is the owner's call.
