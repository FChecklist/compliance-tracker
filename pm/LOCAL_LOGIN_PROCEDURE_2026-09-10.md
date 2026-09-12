# Local Login Procedure — compliance-tracker @ http://localhost:3000
**Date:** 2026-09-10 · **Author:** W-ENV/W-PROD worker session, with one correction merged in from the parallel PM investigation (see §1a) · **Method:** code reading + read-only SQL/Edge-Function-metadata probes only. No server was started or restarted (0.88GB free RAM, PM's dev server already owns port 3000). No credential was set, reset, rotated, or created. No account was created. All SQL below ran as `app_runtime` (RLS-respecting) except two `auth.users`/`auth.identities` reads which necessarily run as `postgres` (that schema has no `app_runtime` grants) — both were plain `SELECT`s, no writes.

## Bottom line

There are **two complementary working mechanisms**, discovered independently (one by this worker, one by PM's own parallel investigation) — neither of us had the whole picture alone:

1. **Magic Link, admin-only, works right now with zero owner action** — §1.
2. **`mint-session-r39ct` Edge Function, role-flexible (any allow-listed email/role), but currently disabled fail-closed until the owner sets two Supabase secrets** — §1a.

Every other method is either already confirmed broken (password), structurally gated behind data only the owner can set (passcode, SSO), or (for `mint-session-r33` specifically, as distinct from its compliance-tracker sibling) not applicable to this project.

| Method | Verdict | Why |
|---|---|---|
| **Magic Link** | ✅ **WORKS NOW**, admin role only | Client-side `signInWithOtp`, no password/passcode check, no admin API needed. See §1. |
| **`mint-session-r39ct`** | ⚠️ **Code confirmed working, currently disabled fail-closed** | Real, `ACTIVE` Edge Function on compliance-tracker's own project. Reaches any allow-listed email — not admin-only. Needs the owner to set two secrets first. See §1a. |
| Password | ❌ Confirmed broken (PM, prior session) | Not re-tested this task — out of scope to re-litigate, and re-testing a password is indistinguishable from trying to authenticate with a credential, which this task's boundary avoids touching. |
| Passcode | ❌ Dead end | `passcode_hash` is `NULL` for **every** user in `compliance.users`, including the one usable Magic-Link account. `passcode-login/route.ts`'s `verifyPasscodeLogin()` cannot succeed for anyone until the owner sets a passcode — owner-only action, not performed. |
| SSO | ❌ Dead end (unconfigured, not just untested) | `compliance.sso_configurations` has **zero rows**, for any org. `getOrgBySlugWithSso()` (`sso-service.ts:74`) has nothing to look up regardless of `orgSlug`. The ACS route's admin-mint-and-redirect pattern is real, working code — it just has no SAML config to validate against. |
| `mint-session-r33` (PROJEXA's own) | ❌ Not applicable to this app | Confirmed to be scoped exclusively to **PROJEXA's own** Supabase project (`evpckeuxgvahguwsaeul`) and its Edge Function. This is still correct as far as it goes — **but see the self-correction in §1a**: compliance-tracker has its own, separate sibling mint function that this worker missed on the first pass by checking only the e2e spec files' references instead of calling `list_edge_functions` directly on compliance-tracker's own project. The 4 e2e specs that reference `mint-session-r33` (`demo-gate-smoke.spec.ts`, `r01-r02-boq-create-env1.spec.ts`, `r32-boq-total-excludes-subtasks-env1.spec.ts`, `r40-work-progress-weighted-subtask-env1.spec.ts`) are all testing **PROJEXA**, not compliance-tracker — `r63-local-composer.spec.ts` is the one spec that targets compliance-tracker's own `localhost:3000`, and it explicitly does NOT use mint-session (uses real password, which is the already-confirmed-broken path; it also predates `mint-session-r39ct`'s existence). |
| Google OAuth | ⚠️ **Unverified, flagged, not claimed either way** | `login-form.tsx:107`'s own comment asserts it's "configured in the Supabase project's Auth settings." Empirically: `auth.identities` has 423 rows, **100% `provider = 'email'`, 0 `provider = 'google'`** — nobody has ever completed a Google sign-in on this project. That is consistent with either "never tried" or "not actually enabled" — I cannot distinguish the two. Provider enable/disable + OAuth client id/secret live in Supabase's platform-level Auth config (Dashboard / Management API), which is **not reachable through any tool available to me** (the Supabase MCP's tools only reach the Postgres database and Edge Functions — `execute_sql`, `list_tables`, `list_edge_functions`, etc. — none expose Auth provider settings). Do not trust the code comment alone; this needs the Supabase Dashboard (owner/PM access) to actually confirm. |

## 1. The working path: Magic Link

**Mechanism:** `login-form.tsx`'s `handleMagicLink()` (line 128) calls the Supabase **client SDK**'s `supabase.auth.signInWithOtp({ email, options: { emailRedirectTo } })` directly — anon-key only, no server route, no password check, no passcode check. Supabase's own hosted mailer sends a real email containing a magic sign-in link to whatever address is typed into the form.

**Why it's actionable *locally*, specifically:** there's no local Inbucket/email capture (confirmed: `C:\ct\ct\supabase\` has only a `migrations` folder, no `config.toml` — no local Supabase CLI stack exists at all). Ordinarily that would mean "you'd need real access to whatever inbox Supabase sends to," which is a dead end for the ~470 synthetic demo accounts in this database (see §2). But one account breaks that dead end:

- **Email:** `raajat.agarwal+audit1785643790899@gmail.com`
- **Role:** `admin`
- **Org:** `Audit Test Org 1785643790899` (slug `audit-test-org-1785643790899`, org id `lmru1irvf7icjr5bsgcxc758`, created 2026-08-02 — a real, non-empty, non-deleted org, confirmed by an RLS-context-scoped read, not a bypass read)
- **Why the owner can receive this mail:** Gmail's `+tag` addressing delivers `local-part+anything@gmail.com` to the same inbox as `local-part@gmail.com`. This address is a `+`-tagged alias of the owner's own real Gmail address on file with this session (`raajat.agarwal@gmail.com`). Mail Supabase sends to the `+audit...` address lands in the owner's normal inbox, filterable/searchable by the `+audit1785643790899` tag.
- **Account health, confirmed via `auth.users`:** `email_confirmed_at` is set (confirmed), `banned_until` is null (not banned), `last_sign_in_at` = 2026-08-27 (a real, previously-used account, not a stale artifact).

### Exact steps
1. Open `http://localhost:3000/login` (PM's existing dev server — do not start a second one).
2. Switch to the **Magic Link** tab/section of the login form.
3. Enter email: `raajat.agarwal+audit1785643790899@gmail.com`
4. Click **Send Magic Link** (`sendMagicLink` button, `handleMagicLink` handler).
5. The owner checks their real Gmail inbox (`raajat.agarwal@gmail.com`) — the mail will show the full `+audit1785643790899@gmail.com` recipient, so it's easy to find/filter.
6. Click the link in the email. It redirects to `/auth/callback?next=...`, which exchanges the code for a session exactly like every other magic-link/SSO/passcode flow in this codebase already does.
7. Lands signed in as an **admin** of `Audit Test Org 1785643790899`.

**This step requires the owner** (only the owner can open that Gmail inbox) but requires **no credential action by anyone** — no password is set, reset, or even touched; no account is created; the passcode and SSO gates are never exercised.

## 1a. The role-flexible path: `mint-session-r39ct` (currently disabled) — self-correction

**This entire section is a self-correction.** On the first pass, this worker checked only the `mint-session-r33` name referenced by the 4 e2e spec files, confirmed it was PROJEXA-scoped, and stopped — without calling `list_edge_functions` directly on compliance-tracker's own project (`pcrjmlpuqsbocqfwoxod`) to check for a same-purpose sibling. PM's own, independent, parallel investigation of this same task did make that call and found one. Verified here independently (not taken on trust): `list_edge_functions` on `pcrjmlpuqsbocqfwoxod` shows a third function, `mint-session-r39ct`, `status: ACTIVE`, `verify_jwt: true`, version 2 — and its full source was read directly (`get_edge_function`), not just its listing.

**What it does, confirmed from its own source:**
- Same underlying technique as `mint-session-r33`: `supabaseAdmin.auth.admin.generateLink({type: "magiclink", email})`, returning a `token_hash` a caller can exchange with GoTrue for a real session — for **whatever email is requested**, not fixed to one account. This is the role-flexible advantage over the Magic-Link path in §1, which only reaches the one admin account the owner happens to control the inbox for.
- **It is fail-closed by design, and currently fails closed.** Its own header comment documents that an earlier version (`v1`) was exactly the kind of unauthenticated any-account session-mint flagged as fault `R81_F40` (hardened 2026-09-08). The current version refuses every request with HTTP 503 unless a `MINT_SECRET_CT` environment secret is set on the function — there is **no fallback to the old hardcoded secret**, which the code explicitly calls "burned."
- Even once `MINT_SECRET_CT` is set, it still requires a **second** secret, `MINTABLE_EMAILS` — a comma-separated allow-list. The code is explicit that an unset or empty list means *nothing* is mintable, not everything: `!allowed.has(email)` → HTTP 403.
- Both secrets are Supabase Edge Function secrets (Dashboard → Edge Functions → Secrets for this project), **not** anything in `.env.local` or the app's own codebase — setting them is a platform-level action, not a code change.

**Status as of this write-up:** presumed still disabled (fail-closed / HTTP 503), since setting `MINT_SECRET_CT` is an owner action and no owner action has been reported. **Not confirmed by invoking the live endpoint** — doing so would itself be exercising a live authentication-mint mechanism against a real project, which is outside a code-reading investigation's boundary, so this status is inferred from the absence of a reported owner action, not measured directly.

**Owner-only action required to use this path:** set `MINT_SECRET_CT` (any strong value) and `MINTABLE_EMAILS` (a comma-separated allow-list of **demo/test addresses only — never a real customer account**, per the function's own comment) in the Supabase Dashboard for project `pcrjmlpuqsbocqfwoxod`. No redeploy needed. Once set, any address on that list can be minted a session at any role that address holds in `compliance.users` — this is what makes it valuable for a **manager/member/viewer** role sweep, which the admin-only Magic-Link account in §1 cannot reach.

**Standing caution, restated from the function's own comment and worth repeating for whoever sets these secrets:** widening `MINTABLE_EMAILS` to include a real customer account re-opens fault `R81_F40` (an any-account authentication bypass). Keep the list to synthetic demo/test addresses only.

## 2. What this does *not* reach — the real dead end

The 423 users in `compliance.users` break down by email domain roughly as:

| Domain pattern | Count | Real inbox? |
|---|---|---|
| `*.veridiandemo.internal`, `*.internal` | ~500 (multiple orgs, 50 each) | **No** — fabricated domain, no MX, no mailbox exists anywhere. Not owner-blocked, **impossible** — nobody, including the owner, can receive mail there. |
| `*.demo`, `*.example` | ~186 | **No** — same as above. |
| `projexa-ai.com` | 20 | Unknown — this is a real, owned domain (PROJEXA's marketing domain), but whether it has a working mailbox/catch-all for these specific addresses was not checked; out of scope for this task. |
| `gmail.com` | 16 | **Mixed.** Only `raajat.agarwal+audit1785643790899@gmail.com` is provably the owner's own inbox (Gmail plus-alias of the on-file owner address). The other 15 (`ocid020...@gmail.com`, `platformtestalpha@gmail.com`, `projexa.verify.test1@gmail.com`, `rajiv.malhotra.skylinebuilders@gmail.com`, etc.) are plausibly real Gmail accounts but belong to **unknown parties** — do not attempt magic-link against these; there is no way to confirm who receives that mail. |

**The realistic, production-flavoured demo orgs the team actually demos with (Skyline Builders, Almaha Skyline, Meridian Auto, Apex Consulting, Rise Academy, Grandvista Hotels, Sharma & Associates, Campus Facilities, Velocity Softworks, Horizon Logistics, Wellness Care) all sit on fabricated `.demo`/`.internal` domains.** For those, Magic Link is not "owner-blocked" — it is **categorically impossible** as those accounts stand, because no mailbox exists to deliver to. The only ways to sign into any of *those* specific accounts locally would be:
- the owner sets a real password directly in the database/Supabase Dashboard (owner-only, explicitly out of this task's boundary), or
- the owner sets a `passcode_hash` for one of them (same), or
- the owner configures a real SSO IdP for that org (same), or
- the owner points one of those accounts' `email` column at a real inbox they control (a data edit, not strictly a "credential," but still an account-provisioning decision — flagged, not performed).

This is a complete and useful negative result in its own right, per PM's own framing: **"if the answer turns out to be 'the owner must set a password,' that is a complete result."** Here it's slightly better than that — one admin account is reachable with no owner-side database action at all, but the rest of the realistic demo fleet does need one of the four owner-only actions above.

## 3. Traps / notes for the next session

- **Don't re-derive the SSO conclusion by querying with a bare `SELECT ... FROM compliance.organisations` and no `app.current_org_id` set** — it silently returns zero rows for every org (RLS, same `current_org_id()`-is-NULL trap as the `withTenantContext`-without-userId bug class documented elsewhere in this window's handover). I hit this myself investigating this exact account and had to wrap the read in `BEGIN; SET LOCAL ROLE app_runtime; SELECT set_config('app.current_org_id', '<id>', true); SELECT ...; COMMIT;` to get a real answer. A bare zero-row result from `compliance.organisations` or similar tenant-scoped tables should never be read as "doesn't exist."
- **Google OAuth's status is still genuinely unknown** — don't let the code comment or this file's "0 identities" data point get cited as a definitive verdict either way; it needs actual Supabase Dashboard access (Authentication → Providers) to settle, which nobody in this session's toolset has.
- **`mint-session-r33` itself is still PROJEXA-only** — that conclusion holds. But **don't stop at checking only the name an e2e spec references.** This worker's first pass concluded "no mint mechanism for compliance-tracker" from spec provenance alone and missed `mint-session-r39ct`, a same-purpose sibling deployed directly on compliance-tracker's own project, because `list_edge_functions` was never called on `pcrjmlpuqsbocqfwoxod` directly. PM's parallel investigation caught this. **Always call `list_edge_functions` on the target project directly** when asking "does a mint/bypass mechanism exist here" — don't infer non-existence from test-file references alone (this is a specific instance of the standing Git-Bash-`find`/`grep` "don't assert non-existence" lesson, just via a different tool this time).
- **Do not set `MINT_SECRET_CT`, `MINTABLE_EMAILS`, a passcode, or an SSO config "just to unblock testing."** All are explicitly owner-only per this task's boundary, restated here for whoever reads this next: *"DO NOT set, reset, rotate or create any credential, and do not create accounts. That is owner-only and it stays owner-only."*
