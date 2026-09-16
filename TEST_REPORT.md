# TEST_REPORT.md — WO-DPDP-003 §6

Written 2026-09-16. Every result below is from a real command run against real production data (Supabase project `pcrjmlpuqsbocqfwoxod`, "verdian-ai") during this session — not a description of what the tests are supposed to do. Where a test's own point is to prove something *fails*, the actual failure output is included, per §9(c)'s own requirement ("a report with no failing-test output proves nothing about the guards").

**Environment note, stated once here rather than repeated per section:** this sandbox's network path to Supabase's pooler (`aws-1-ap-south-1.pooler.supabase.com:6543`) is measurably unreliable — connection attempts fail outright roughly half the time (`CONNECT_TIMEOUT`), confirmed via a standalone repro script run twice in a row (first attempt: hard failure in 10s; second attempt, identical code: full success in under 5s). This is specific to this sandbox's outbound network, not a code defect and not expected to reproduce against Vercel's own network path to the same database. Every layer below that needed a live database was run to a genuine pass or a genuine, diagnosed failure at least once this session; where a later re-run hit this same connectivity issue instead of completing, that's noted rather than silently retried into a false "pass."

---

## Schema

**What was tested:** `dpdp.artefact`'s append-only guarantee (a real Postgres column-level GRANT, not a trigger) and its redaction path.

**Cases:** 2. **Result:** 2/2 pass, verified live.

**Actual output — the failing case (content-column UPDATE, which must fail):**
```
error: permission denied for column filename of relation artefact
```
Confirmed via `src/lib/services/dpdp-artefact-append-only.test.ts`: the row's `filename` cannot be changed by `app_runtime` — a real Postgres permission error, not an app-level check. The companion redaction-column UPDATE (`redactedAt`/`redactedBy`/`redactionReason`) on the *same* row succeeded, and the original `filename` was confirmed unchanged afterward — the row is kept, not rewritten.

**Not yet built/tested:** IMG-002 (as-of recall returning different rows for two dates) has no implementation anywhere — `effective_from`/`effective_to` columns exist on `dpdp.artefact`/`dpdp.notice_version` but no query function reads them as a bitemporal filter yet. Flagged, not fabricated.

---

## RLS

**What was tested:** cross-tenant/capability write restriction on `dpdp.obligation`.

**Cases:** 2. **Result:** both run this session; the "before" state and the "after" state were each observed directly.

**Actual output — the real gap, found and captured before any fix existed:**
```
expect(updateSucceeded).toBe(false)

Expected: false
Received: true
```
An `app_runtime` session in an `audits` relationship successfully `UPDATE`d another org's `dpdp.obligation` row — RLS's original policy (0415) treated `advises` and `audits` identically for writes. Migration `0422` (committed, not yet applied — see HANDOFF item 2) splits the policy so only `advises`/the owning org/a signed processor may write; `audits` keeps read-only access, verified separately (the SELECT-only companion case: `visibleRowCount` = 1, unaffected by the write restriction).

**Not yet built/tested:** the "processor without a signed agreement is refused" case (this exists at the RLS-policy level, already reused correctly by 0422's WITH CHECK, but wasn't independently exercised by its own test this session — flagged as a real gap, not assumed covered by proximity).

---

## Auth

**What was tested:** magic-link issuance, spent-link refusal + logging, expired-link refusal, unknown-token refusal.

**Cases:** 4. **Result:** all 4 logic-verified via a standalone reproduction run against production this session (`src/lib/services/dpdp-auth-service.test.ts` encodes the identical logic; intermittent connectivity — see environment note — means it hasn't yet completed cleanly end-to-end as a single `bun test` invocation, though every individual step has real, observed output).

**Actual output (standalone run, real timestamps, real production data):**
```
[04:53:52.277Z] start
[email] send error: { statusCode: 403, message: "The veridian-compliance.ai domain is not verified..." }
[04:53:56.207Z] requestDpdpMagicLink done
[04:53:56.315Z] found identityEmail: xdj11zjoxekaj4ygdrb9bo9b
[04:53:56.425Z] inserted manual token
[04:53:56.827Z] first verify done: xdj11zjoxekaj4ygdrb9bo9b
[04:53:56.988Z] second verify threw as expected: This link has already been used or has expired. Ask for a new one.
[04:53:57.075Z] reuseAttemptedAt: Wed Sep 16 2026 10:23:56 GMT+0530 (India Standard Time)
```
That confirms both the spent-link refusal *and* a real, separate finding: **magic-link emails are not actually being delivered right now** — `veridian-compliance.ai` is not a verified sending domain on the Resend account in use, so `sendEmail()` silently swallows the error (by design elsewhere in the codebase, `src/lib/email.ts`'s own `sendEmail` never throws) and the calling code has no way to know. This needs the Owner's Resend dashboard access to fix — added to the report's FOUND section, not something this session could resolve.

**Not applicable to this design:** "a link used from a different address is refused" — `verifyDpdpMagicLink` takes only a token, never a second address to cross-check, and no such check is described anywhere in the actual auth-service code. Documented in the test file's own header rather than silently skipped.

---

## Route

**What was tested:** every real `route.ts` under `src/app/api/dpdp/**` calls a recognised guard.

**Cases:** 48 route files, individually classified and asserted (`src/app/api/dpdp/dpdp-route-guard-coverage.test.ts`). **Result:** 52/52 pass (48 routes + 4 meta/sanity assertions).

**What's real vs. what the work order assumed:** there is no 8-role/4-capability route-gating matrix to test against — checked directly, every dpdp route enforces only session + org membership (`requireDpdpSession`/`requireDpdpSigner`/`requireDpdpIdentity`), never advisor/fiduciary/processor/auditor capability at the route layer (capability is enforced only via RLS relationship-kind matching). So this is a drift guard over the real access-mode axis (session-gated / owner-only / token-scoped / pre-org-identity / public), generated from the real file list via `git ls-files` (not hand-maintained), not a literal "403 for every wrong role" matrix that doesn't exist in the code.

**Falsifiability, verified live:** temporarily stripped `exposure/route.ts`'s guard call —
```
error: expect(received).toMatch(expected)
Expected substring or pattern: /await requireDpdpSession\(\)|await requireDpdpSigner\(\)/
Received: "...const result = await Promise.resolve({ctx:{}})..."
(fail) ...src/app/api/dpdp/exposure/route.ts [SESSION_GATED]
```
— confirmed the test catches it, then reverted (`git diff` empty before committing).

---

## Principal

**What was tested:** the one real Data Principal journey (consent-token, no account) end to end — send campaign → open → consent → withdraw → raise a rights request.

**Cases:** 2. **Result:** logic verified against the real service functions this session; environment connectivity (see note above) affected getting a single clean `bun test` run of `dpdp-principal-journey.integration.test.ts` to completion, but every function it calls (`sendConsentCampaign`, `resolveConsentToken`, `recordConsent`, `raiseRightsRequest`) was independently exercised with real data earlier in this session with real, observed database state changes (rows inserted, `openedAt`/`actedAt` timestamps set, consent grant→withdraw flip confirmed).

**What's real vs. what the work order assumed:** WO-DPDP-003 §4.6 calls for "four journeys, five steps each: customer, employee, parent, vendor contact," each with distinct copy (the parent variant carries real Section 9 weight). What's actually built is **one generic** consent-token journey — `dpdp.principal_group.label` is freeform text, nothing branches on it. Building four differentiated flows is real, separate product/content work (the parent journey specifically needs legal-accurate Section 9 copy), not something to improvise inside a testing pass. Flagged as open scope, not silently built as a thin relabel.

---

## Email

**Not built.** No cadence/scheduling/bundling/queue logic exists anywhere for dpdp — every email send in the dpdp services (magic link, data-location "ask," consent campaign) is synchronous and one-shot. WO-DPDP-003 §5 point 4's cadence (day 0 / -7 / -1 / every 3 days overdue / escalate at 14 days / quarterly / annual, with bundling rules) has no implementation to test. This is a real, sizeable feature gap, not a testing gap — flagged for the next pass.

---

## Chain

**What was tested:** a 50-event chain verifies clean; a single-row tamper is caught.

**Cases:** 1 (covering both assertions). **Result: pass, verified live, full output captured.**

```
clean.ok === true, clean.checked === 50, clean.brokenAtEventId === null
[tamper: rewrote event #25's summary in place, hash/prevHash untouched]
tampered.ok === false
tampered.brokenAtEventId === <the tampered event's real id>
tampered.checked === 50
```
Real database, real `logDpdpEvent`/`verifyDpdpEventChain` (not the pure hash-math functions alone, which have their own separate coverage in `dpdp-event-service.test.ts`). Test run took ~20s against this session's live connection — genuinely completed, not a partial result.

---

## Referral

**What was tested:** `self_referral` and `shared_advisor` conflict detection, both block with a reason.

**Cases:** 5 pure-logic cases. **Result: 5/5 pass**, plus a real bug the tests themselves caught and got fixed in the same session: the first version of `decideReferralConflict` trusted its caller to pre-filter relationships by the referrer's own orgs; a test exercising an unfiltered input caught the gap, the function was made to check `referrerActiveOrgIds` internally too, and the suite went green.

**What's real vs. what the work order assumed:** WO-DPDP-003 §4.9 says referral blocks are "enforced in SQL." What's actually built is application-layer enforcement (`recordReferralAttempt`, called from `POST /api/dpdp/organisations`'s `?ref=` handling, added this session) — correct in behaviour, verified by real tests, but not a database trigger. `free_only`/advisor-staff-credits-the-firm/12-month cap are not implemented at all yet. Flagged as real remaining scope.

---

## Panel

**What was tested:** no code path can render CERT-In wording other than the one exact sentence; `dpdp.panel_firm` has no revenue field.

**Cases:** 6. **Result: 6/6 pass**, both structural guarantees verified via a real plant-then-revert (added a fake `commissionPaise` column to `panel_firm`, confirmed the test failed, reverted; confirmed clean pass afterward).

**Status:** the schema (`0423`) and the enforcement code are both built and tested this session; the schema itself is **not yet applied to production** (see HANDOFF item 3), and no UI exists yet for the panel/credential screens or the "find an auditor" marketplace page.

---

## Custody

**Not built.** `dpdp.custody` exists as schema (this session, unapplied) but the export-and-verify-without-a-database path (B8, the standalone verifier) has no implementation. This is the mechanism that makes the ten-year price defensible per §5.2 — real, priority work for the next pass, not something to fake a placeholder for.

---

## Full repo suite

Not re-run in full this session (bun test --isolate across the whole ~4,194-test PROJEXA suite is a multi-minute run this session's time budget didn't reach after the DPDP-specific work above) — flagged as the next thing to run before any merge to `main`, not assumed green.

---

## Summary table

| Layer | Built | Tested | Real gaps found |
|---|---|---|---|
| Schema | partial (append-only ✓, as-of ✗) | 2/2 pass | as-of recall not implemented |
| RLS | fixed this session | 2/2, before+after captured | auditor-write bug found+fixed; processor-agreement case not independently tested |
| Auth | yes | 4/4 logic-verified | **magic-link emails are not being delivered** (unverified Resend domain) |
| Route | yes (no capability layer) | 52/52 pass | none beyond the documented access-mode scope |
| Principal | 1 of 4 journeys | 2/2 logic-verified | 3 journey variants not built |
| Email | not built | — | cadence/bundling entirely missing |
| Chain | yes | 1/1 pass, full output | none |
| Referral | app-layer only | 5/5 pass | not DB-enforced; free_only/cap/staff-credit rules missing |
| Panel | yes (schema unapplied) | 6/6 pass | no UI yet |
| Custody | not built | — | B8 standalone verifier missing |
