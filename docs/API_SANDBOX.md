# VERIDIAN AI OS — API Sandbox (Interim)

**Status:** interim measure — this reuses an existing demo org rather than
provisioning a dedicated, self-serve sandbox environment. See "Why interim,
and what a dedicated sandbox would add" below for the honest limitations of
this approach.

**Covers:** the same `/api/v1/**` public API surface documented in
[`docs/API_CHANGELOG.md`](./API_CHANGELOG.md); read that document (and the
live schema at [`/api/v1/openapi.json`](/api/v1/openapi.json)) for the
contract itself. This document only covers how to test against it safely.

---

## Correcting a naming mismatch

An earlier gap-analysis finding recommended reusing "the existing Demo
Company org" as an interim sandbox. **No org literally named "Demo Company"
exists in this codebase.** That string only appears as a hardcoded label in
a marketing screenshot component (`src/components/RealProductDemo.tsx`) — it
has no backing database row and no org-level logic tied to it. It cannot be
used as a sandbox because there is nothing behind it to point integrators
at.

The real, functionally equivalent mechanism already in the codebase is the
**`projexa_demo_org`** organization, reached through the **`projexa_demo_key`**
API key (`src/lib/supabase/api-key-auth.ts`). This document formalizes that
as the interim sandbox instead.

## How the sandbox works

1. **The key is gated off by default, everywhere, including production.**
   `projexa_demo_key` is one of a small set of `KNOWN_DEMO_KEY_IDS` that
   `validateApiKey()` rejects outright (`{ status: "invalid" }`, identical
   to a garbage/missing key) unless the `DEMO_API_KEY_IDS` environment
   variable explicitly allowlists it (e.g.
   `DEMO_API_KEY_IDS=projexa_demo_key`). This was a deliberate security fix
   (Wave A, 2026-07-17) after this same key was found working, unrestricted,
   from a live production deployment. **Enabling sandbox access for external
   integrators requires an operator to set that env var in the target
   deployment** — it is not on by default anywhere today.
2. **Once enabled, requests are rate-limited to 30/minute**, regardless of
   what the key's own database row says (`DEMO_KEY_RATE_LIMIT_PER_MINUTE` in
   `src/lib/supabase/api-key-auth.ts`). This ceiling applies only to keys in
   `KNOWN_DEMO_KEY_IDS` and only takes effect once the key is allowlisted —
   it doesn't change behavior for any other key, demo or otherwise.
3. **Scopes are unrestricted (`read,write`)** — a sandbox needs to let
   integrators exercise writes (creating a lead, submitting a timesheet,
   etc.), not just reads.
4. **The org's data is shared, not private.** `projexa_demo_org` is used for
   internal load-testing (see `docs/testing/PROJEXA_LOAD_TEST_RESULTS.md`)
   and PROJEXA's own local/preview development, in addition to any external
   sandbox use. Don't write anything to it you'd be unhappy to see altered
   or removed by someone else's test run, and don't treat responses from it
   as representative of a clean/empty tenant.

## What this is not

This is explicitly **not** a dedicated, self-serve sandbox: there is no
"create a test org" flow, no per-integrator isolated tenant, and no
automatic reset/seed cycle. It is one shared demo org, made safely
reachable, as an interim measure — matching the gap finding's own framing
("reuse the existing demo org as an interim sandbox **before** building a
dedicated flag").

**If real, sustained external-integrator demand for isolated per-integrator
sandboxes materializes**, the natural next step is a dedicated
`organizations.isSandbox` (or equivalent) flag with its own provisioning
flow — tracked as follow-on scope in `ai-os/MASTER-TRACKER.yaml`, not
built speculatively here.

## Requesting access

Sandbox access is not currently self-serve. Contact the platform owner
(see `AGENTS.md`) to have `DEMO_API_KEY_IDS` enabled for a target
deployment and to receive the `projexa_demo_key` bearer token.
