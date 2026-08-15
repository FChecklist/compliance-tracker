# Wave 10: projexa-ai.com DNS/Vercel cutover (+ Wave 9 credential reverse-link gap)

Final step of the VERIDIAN/PROJEXA brand-layer merge (10-wave plan; see the
2026-07-21 "CRM completion + VERIDIAN/PROJEXA brand-layer merge" entry in
`ai-os/boss/ACTIVE-CLAIMS.yaml`). Owner authorized Waves 9+10 ("Yes, proceed
with both now") and separately delegated judgment for the remaining
decisions ("you decide ... complete everything and report back"). All
PROJEXA data involved is confirmed synthetic test/demo/QA fixture data, no
real paying customers.

## Part 1: Wave 9 follow-up gap (prerequisite, done first)

Wave 9 (`ai-os/boss/completed-work/wave9-projexa-data-migration.md`) created
6 new `compliance.organisations` rows for 6 PROJEXA orgs but explicitly left
PROJEXA's own `public.veridian_credentials` table (project `evpckeuxgvahguwsaeul`)
untouched, so those 6 orgs had no `vk_...` key linking PROJEXA's runtime back
to their new compliance-tracker org id. Closed that gap directly (no code
change needed -- `POST /api/v1/platform/provision-org` mints keys for
*brand-new* orgs only, not a clean fit for backfilling already-created rows,
so this was a direct, one-off data operation matching that route's exact
key-minting shape: `vk_` + 32 random alphanumeric chars, SHA-256 hex hash,
`key_prefix` = first 8 chars + `...`, scopes `read,write`, `is_active=true`,
`issued_for_application_id` = the real `platform_applications` row for
`application_key='projexa'` (`a1dab7a7-8fb5-4853-9876-a3cb72703da1`)).

| PROJEXA org | PROJEXA org id | compliance-tracker org id | new api_keys.id |
|---|---|---|---|
| Acme Test Construction | `26489072-0b74-4acf-9d69-ae4e044416fd` | `05886eb3-40bf-4b04-9bce-8d188da573af` | `abb323e9-436d-4adc-850a-df419d95fec4` |
| Wave4 QA Test Co | `03c8858a-5989-45cc-a64f-54b16cdb0ea0` | `3794cb50-867c-4760-b02b-fe8d88041f6e` | `f7d8b8d3-2f1d-4c6c-bfca-62b1894bac6c` |
| Skyline Builders | `15bf14d9-6098-4777-bbbe-5487157bfe42` | `678bbc0f-72de-4b75-a174-e9be97e00139` | `9ef05f30-9e6d-42e3-a176-a01bac622b96` |
| Meridian Skyline Group | `f6b0df80-968f-4874-8884-2674cf5354d7` | `e202f572-f67c-4f7a-bf5d-5fdbdee5d0d9` | `2d40a8dc-ea2f-4be9-b2dc-100fd3545608` |
| Platform Test Org Alpha (2nd) | `48310173-0b3b-44d5-98df-18b3bbcb5005` | `aa8cd0be-6264-4d48-abc3-f58fe395eb2f` | `a9ec74e4-6da5-4fac-bd59-077832fbec09` |
| Al Maha Skyline Contracting & Interiors LLC | `03483997-4a9d-4e07-b833-e5935101ed9a` | `81161b38-9180-4d76-8d48-b347aedc04bc` | `44a96403-95bc-4088-8e66-ac648edf3b19` |

Wrote the corresponding `organization_id` / `veridian_org_id` / `veridian_api_key`
(plaintext, matching the existing 3 rows' own convention -- this table stores
the raw key, not a hash) row into PROJEXA's `public.veridian_credentials` for
each of the 6.

**Verified, not assumed:** a real HTTPS call from outside the DB, using one
of the newly-minted raw keys (`Acme Test Construction`'s) as a Bearer token
against the live production API (`GET https://veridian-aios.com/api/v1/compliance`)
returned `200` with a valid, correctly-org-scoped JSON body
(`{"compliance":[],"total":0,...}` -- empty because it's a brand-new org,
not an auth failure). The same call also succeeded through the new
`projexa-ai.com` domain post-cutover (see Part 2). A DB-level join
(`api_keys` x `organisations` x `platform_applications`) confirms all 9 total
PROJEXA-provisioned orgs (3 pre-existing + 6 new) now resolve end-to-end.

**Orphan noted, not fixed (out of scope, per the original brief's own
guidance to spend at most a few minutes on it):** compliance-tracker org
`is94gppgpbuwq8jl3m5baame` ("Platform Test Org Alpha", no numeric suffix) is
a duplicate with its own `api_keys` row (`id=pd8w2jvsw7blbz0w78usdqj2`,
prefix `vk_cVtxu...`) but **no** PROJEXA-side `veridian_credentials` link at
all -- a likely failed/retried provisioning call from before Wave 9, as Wave
9's own report already flagged. Left alone deliberately: it isn't blocking
the cutover (no live PROJEXA org points at it), and merging/deleting a
possibly-referenced org id is a judgment call for whoever next touches
PROJEXA's provisioning path, not a 5-minute fix.

## Part 2: DNS / Vercel cutover

**Key finding that changed the shape of this step:** `projexa-ai.com` is a
domain *registered directly through Vercel* (registrar = Vercel, nameservers
= `ns1/ns2.vercel-dns.com`, confirmed via `vercel domains inspect
projexa-ai.com`), and DNS is fully Vercel-managed (`vercel dns ls` shows only
Vercel's own `ALIAS`/`CAA` records, resolving to Vercel's shared edge IPs
`216.198.79.1` / `216.198.79.65` -- the exact same IPs `veridian-aios.com`,
compliance-tracker's existing domain, already resolves to). There is **no
external registrar/DNS provider and no meaningful TTL to lower and wait
out** the way there would be for a domain on a third-party DNS provider --
the "cutover" is entirely a Vercel-side project-to-domain reassignment, and
Vercel's edge network already routes both domains through the same anycast
IPs. This is why the propagation-wait step in the original plan didn't apply
here in the way it was written; it doesn't mean the risk was skipped, it
means the actual mechanism is different and faster than assumed.

Steps taken:
1. Confirmed Vercel project setup: `compliance-tracker` -> Vercel project
   `veridian-compliance-ai` (production URL `veridian-aios.com`); PROJEXA's
   own separate project `projexa` (production URL, until this change,
   `projexa-ai.com`). Both under team `meet-track-s-projects`.
2. `vercel domains add projexa-ai.com veridian-compliance-ai --force` --
   moved the domain from the `projexa` project to `veridian-compliance-ai`.
   `--force` was required and expected (the domain was still attached to the
   old project); output confirmed `Removing domain projexa-ai.com from
   project prj_JA9mwUdOfW3SKSxjG4jdPo0R2iVM` then `Success! Domain
   projexa-ai.com added to project veridian-compliance-ai`.
3. `vercel domains add www.projexa-ai.com veridian-compliance-ai --force` --
   same move for the `www` alias (it was already configured on the domain).
4. Did **not** touch the `projexa` Vercel project or the `FChecklist/projexa`
   GitHub repo -- both confirmed still present and unarchived after the
   cutover (`vercel project ls` still lists `projexa`;
   `gh repo view FChecklist/projexa` -> `isArchived: false`). This is the
   deliberate rollback path, not an oversight to clean up later.

**Verified live (not just claimed):**
- `vercel domains inspect projexa-ai.com` now shows it under project
  `veridian-compliance-ai` (`www.projexa-ai.com, projexa-ai.com`).
- `curl https://projexa-ai.com/` -> `HTTP/2 200`, `server: vercel`,
  `x-powered-by: Next.js`, matching compliance-tracker's own app (not a
  cached/stale response -- `x-vercel-cache: MISS` on first hit).
- `curl -H "Authorization: Bearer <new vk_ key>" https://projexa-ai.com/api/v1/compliance`
  -> `200`, proving the domain change and the Part 1 credential fix compose
  correctly end-to-end.
- Propagation was effectively immediate (both checks above succeeded within
  under a minute of the `vercel domains add` calls) -- consistent with the
  Vercel-native-DNS finding above, not a coincidence.

**Honestly not fully verified:** the anonymous public "/" marketing page
served at `projexa-ai.com` currently shows compliance-tracker's default
"THE FIRM" / "VERIDIAN COGNITIVE AI OS" marketing branding, **not** PROJEXA
branding -- `resolveBranding()` (`src/lib/services/org-branding-service.ts`)
is org-scoped, applied post-login/post-org-resolution, not hostname-scoped
for the anonymous marketing page. I did not find (and did not build) any
hostname-to-brand resolution for the logged-out landing page, so I can't
honestly claim "visiting projexa-ai.com shows PROJEXA branding" for an
anonymous visitor -- only that the underlying app being served is correct,
and that an authenticated PROJEXA-branch org resolves its own branding
correctly via the API once logged in (per the CRM/brand-layer merge's Wave 5
work, which fixed brand *name* resolution server-side; the anonymous landing
page's brand-by-domain treatment reads as a separate, pre-existing gap, not
something this wave's brief asked to fix). Flagging this rather than
overclaiming full branding verification.

## Rollback runbook

If `projexa-ai.com` needs to point back at the old PROJEXA deployment:

1. `vercel domains add projexa-ai.com projexa --force` (from
   `/opt/veridian/repos/compliance-tracker` or any directory, using the
   team's Vercel token/scope `meet-track-s-projects`) -- reassigns the apex
   domain back to the original `projexa` project. Same for
   `vercel domains add www.projexa-ai.com projexa --force` if `www` needs
   to move back too.
2. No DNS-provider-side change is needed (see the Vercel-native-DNS finding
   above) -- this Vercel-side reassignment is the entire mechanism, in both
   directions, and takes effect on the order of seconds to low minutes.
3. The 6 `api_keys` rows (compliance-tracker) and 6 `veridian_credentials`
   rows (PROJEXA) added in Part 1 do **not** need to be rolled back as part
   of a DNS-only rollback -- they're additive and harmless to leave in place
   even if traffic reverts to the old PROJEXA deployment (PROJEXA's own
   backend simply wouldn't use them if its frontend goes back to being
   served from the old project). Only revert them if the whole Wave 9/10
   migration itself is being undone, which is a separate, larger decision.
4. Nothing was deleted at any point -- the `projexa` Vercel project and the
   `FChecklist/projexa` GitHub repo were never touched beyond the domain
   detach implied by step 2 above, so rollback has no data-loss risk.
