# OCID-056 -- Platform Security Reconciliation and Credential Governance: Real, Read-Only
# Discovery Report

**For the Owner to act on personally.** Every finding below is real and independently verified
live against GitHub's own APIs and this server's real filesystem/config during this dispatch.
**Nothing in this document was rotated, revoked, or modified.** No secret *value* is quoted in
full anywhere below -- see §3's own note on why.

---

## 1. Method

1. GitHub secret-scanning alerts API (`gh api repos/<owner>/<repo>/secret-scanning/alerts`),
   queried live against the two `FChecklist` repositories OCID-054's same-day discovery pass
   already identified as having secret scanning enabled (`compliance-tracker`, `veda-advisors`) --
   re-confirmed fresh this session rather than copied from that report. The other 13 repos on the
   account were re-confirmed via `gh repo list` to be the same 15 total OCID-054 already
   enumerated; not re-cloned or re-scanned here (that would be genuine duplication of same-day
   work) -- OCID-054's own report is the record for those.
2. Manual credential-pattern grep (`git grep -nIE`) across `compliance-tracker`'s current tracked
   working tree for: Anthropic (`sk-ant-`), OpenAI (`sk-proj-`, `sk-live-`), AWS (`AKIA[0-9A-Z]{16}`),
   GitHub PAT (`ghp_`, `github_pat_`), Slack (`xox[baprs]-`), Google (`AIzaSy`), PEM private-key
   headers, and embedded-password `postgres(ql)://user:pass@host` URIs.
3. `.env`-file tracking check (`git ls-files` for any `.env*` other than `.env.example`/`.env.sample`).
4. Real GitHub Actions secret inventory (`gh secret list --repo FChecklist/compliance-tracker`) --
   **names only**; the GitHub API never exposes configured secret values, so this is inherently
   read-only.
5. `gh auth status` -- token scope/type only, no value.
6. On-disk server-side `.env` file inventory at `/opt/veridian/shared/` -- **existence, location,
   permissions, and variable *names* only, values never read or printed** (see §4).

---

## 2. Finding A (HIGH, confirmed live, currently open) -- 22 real, publicly-leaked Google API keys, `veda-advisors`

GitHub secret scanning reports **22 open, unresolved alerts** on the `FChecklist/veda-advisors`
repository (alert numbers 1-22), all `secret_type: google_api_key`, all `state: open`, all
`publicly_leaked: true`, all in the single file `tool-results/read_1782309955766_3e29539f7948.txt`
(an accidentally-committed AI-tool session output file capturing a scraped Google Docs page load).
Independently re-confirmed live this session (not copied from OCID-054's report): fetched the
alert list fresh, fetched one blob directly to confirm the value is real and matches the alert
metadata, confirmed the file is **not** present in the repo's current `main` tree (`git ls-tree`
equivalent already done by OCID-054's report; not re-run here) but remains reachable via git
**history** on a repository whose visibility is **public**, which is exactly why the scanner still
reports these as `open` -- removing a file from `HEAD` does not purge it from a public repo's
fetchable history.

**Context that matters for triage, not previously stated this explicitly in OCID-054's report:**
inspecting the leaked value's surrounding content shows this is a scraped Google Docs page load
(`docs.google.com`, `apis.google.com/_/scs/abc-static/...`) -- the embedded `AIzaSy...` strings are
almost certainly Google's own public, referrer-restricted, client-side web API keys that Google
itself serves inside its page JS bundles for every visitor, not a VERIDIAN-owned backend secret.
This does **not** make the alert safe to ignore (GitHub's scanner has no way to distinguish "our
key" from "a key we accidentally captured," and the file itself -- a raw AI-tool session dump --
may contain other, genuinely sensitive content beyond these 22 flagged strings that a
credential-pattern scanner would not catch) but it does mean the correct remediation is very likely
**purge the file from history + close the alerts as false-positive/used-by-others**, not "rotate a
VERIDIAN-owned key," since VERIDIAN does not control or issue these values. Owner judgment call,
not decided here.

---

## 3. Finding B (MEDIUM, confirmed live, currently open, self-inflicted) -- 1 real alert on `compliance-tracker`, and a documentation-hygiene root cause

GitHub secret scanning reports **1 open alert** (`#1`, `secret_type: google_api_key`,
`publicly_leaked: true`, `state: open`) on `FChecklist/compliance-tracker` itself, with **2
locations**, both introduced by the same commit (`03f60ffd`):
`ai-os/VERIDIAN_OCID_054_UNIVERSAL_REPOSITORY_DISCOVERY_2026-08-04.md` (line 256) and
`ai-os/MASTER-TRACKER.yaml` (line 2373).

**Root cause, independently confirmed by reading both locations directly:** this is the *same*
Google API key value as Finding A's `veda-advisors` alert #22 (confirmed by direct string
comparison of both alerts' `secret` fields). OCID-054's own discovery report quoted that leaked
value **verbatim**, in full, inside a fenced code block, "to confirm the finding is real, not a
scanner false-positive" -- and that verbatim quote, once committed to `compliance-tracker`, was
itself picked up by GitHub's scanner as a **new, second, independent exposure** in a different
repository. Documenting a leaked secret by pasting its full value is not a safe way to prove a
finding is real -- it *creates* the next finding. This document deliberately does not repeat that
mistake: no secret value anywhere in this report is unredacted or complete (see the method note at
the top).

**Process recommendation for the Owner and for future discovery dispatches in this chain:** when
citing a real leaked-secret finding as evidence, quote only a short, clearly-truncated prefix (e.g.
first 8-10 characters + `...`) or a value hash, never the full string -- sufficient to let a human
verify "yes, this matches alert #N" without the citation itself becoming alert #N+1.

---

## 4. Finding C (LOW/INFORMATIONAL) -- Real credential-name inventory across every provider category the Owner named

No values below -- names and locations only, all confirmed via read-only enumeration.

### C1. `compliance-tracker` GitHub Actions secrets (`gh secret list`, 45 configured, names only)

Mapped to the Owner's own named provider categories:

| Category (Owner's list) | Configured secret names found |
|---|---|
| **GitHub** | `PAT_FCHECKLIST` |
| **Vercel** | `VERCEL_TOKEN`, `VERCEL_ACCESS_TOKEN`, `VERCEL_ORG_ID`, `VERCEL_PROJECT_ID`, `VERCEL_PROJECT_ID_CT` |
| **Supabase** | `SUPABASE_SERVICE_ROLE_KEY`, `SUPABASE_DB_PASS`, `SUPABASE_ACCESS_TOKEN`, `SUPABASE_PAT`, `SUPABASE_PROJECT_REF`, `SUPABASE_URL`, `AI_TEAM_SUPABASE_ANON_KEY`, `AI_TEAM_SUPABASE_URL`, `NEXT_PUBLIC_SUPABASE_ANON_KEY`, `NEXT_PUBLIC_SUPABASE_URL` |
| **Database** | `DATABASE_URL` (in addition to the Supabase-specific ones above) |
| **SSH / server infra** | `HETZNER_API_TOKEN` (this box's own host provider -- closest real equivalent to "SSH" found; no literal SSH private-key secret is stored as a GitHub Actions secret, consistent with SSH access being host-key-based rather than a rotatable API credential) |
| **OAuth** | `GOOGLE_OAUTH_CLIENT_ID` |
| **SMTP / outbound email** | `RESEND_API_KEY` |
| **Webhook / internal signing secrets** | `AI_TEAM_LOG_SECRET`, `MCP_DEV_SECRET` (plus `CRON_SECRET`, `OPS_SYNC_SECRET`, `VERCEL_DEPLOYMENT_WEBHOOK_SECRET` -- referenced in application code, §C2, but **not** present in this repo's own `gh secret list` output -- see note below) |
| **AI providers** | `ANTHROPIC_API_KEY`, `GROQ_API_KEY`, `CEREBRAS_API_KEY`, `OPENROUTER_API_KEY`, `OPENROUTER_MANAGEMENT_KEY`, `ZAI_API_KEY`, `ZAI_BASE_URL`, `ZAI_OWNER_EMAIL`, `ZAI_OWNER_USER_ID` |
| **Payment providers** | `RAZORPAY_KEY_ID`, `RAZORPAY_KEY_SECRET`, `RAZORPAY_MID`, `RAZORPAY_ACCOUNT_EMAIL` |
| **Other (not in the Owner's named list, found regardless)** | `JWT_SECRET`, `COMPOSIO_*` (6 keys), `GRAPHY_*` (3 keys), `ORSHOT_*` (2 keys), `ACTIVEPIECES_MCP_URL`, `GOOGLE_DRIVE_FOLDER_ID` |

**Real, non-alarming discovery gap:** `src/` references `process.env.OPENAI_API_KEY` and
`process.env.GOOGLE_API_KEY` directly (grep confirmed, both real call sites), but **neither name
appears in `compliance-tracker`'s own `gh secret list` output.** This does not mean no such
credential exists -- Vercel's own environment-variable store (a separate configuration surface
from GitHub Actions secrets, and not one this dispatch has read access to enumerate) is the more
likely real location for anything only needed at deploy/runtime rather than in CI. Flagged as an
honest gap, not investigated further (out of this dispatch's real read access).

### C2. Additional secret-shaped env vars referenced directly in `src/` (names only, via `process.env.X` grep)

`AI_CONFIG_ENCRYPTION_KEY`, `CRON_SECRET`, `DEMO_API_KEY_IDS`, `EXCHANGE_RATE_API_KEY`,
`GOOGLE_API_KEY`, `NEXT_PUBLIC_SENTRY_DSN`, `OPENAI_API_KEY`, `OPS_SYNC_SECRET`, `SENTRY_DSN`,
`SUPABASE_DB_PASSWORD`, `VERCEL_DEPLOYMENT_WEBHOOK_SECRET` -- none of these appear in
`compliance-tracker`'s own `gh secret list`, consistent with the same explanation as C1's gap note
(Vercel-side config, not GitHub Actions-side).

### C3. `gh auth status` -- this session's own real GitHub token

Scopes: `gist`, `read:org`, `repo`. **No `workflow` scope** -- this session cannot push a branch
that touches `.github/workflows/*.yml` (a real, pre-existing operational constraint, not a security
gap; consistent with this session's own prior confirmed finding). Not itself a rotation candidate
finding, included here because the Owner's directive named "GitHub" broadly and this is the one
GitHub credential this session directly holds and can honestly characterize without guessing.

### C4. Real, non-git-tracked server-side `.env` files (`/opt/veridian/shared/`) -- existence and hygiene only, zero values read

Six real files exist on this host: `.env` (35 lines, last modified 2026-08-01), plus five dated
backup copies -- `.env.bak` (2026-07-18), `.env.backup-2026-07-18-glm-proxy-disable`,
`.env.bak-pre-oauth-refresh-2026-07-28` (2026-07-27), `.env.enduser` (2026-07-29), `.env.template`
(2026-07-17, 385 bytes -- almost certainly placeholder-only given the size relative to the others).
**Confirmed not git-tracked**: `/opt/veridian/shared/` is not inside either real git repo on this
host (`/opt/veridian/scripts/.git`, `/opt/veridian/ai-os/.git`) -- correct hygiene, consistent with
AGENTS.md's "DO NOT commit `.env` files" rule, real and independently verified rather than assumed.
Variable *names* present in the live `.env` (values never read): `CEREBRAS_API_KEY`,
`CLAUDE_CODE_OAUTH_TOKEN`, `GITHUB_PAT`, `GITHUB_PAT_ZAI_KIMI`, `GROQ_API_KEY`,
`OPENROUTER_API_KEY`, `OPENROUTER_MANAGEMENT_KEY`, `OPS_SYNC_SECRET`, `RAZORPAY_TEST_KEY_ID`,
`RAZORPAY_TEST_KEY_SECRET`, `RESEND_API_KEY`, `SUPABASE_ACCESS_TOKEN`, `VERCEL_ACCESS_TOKEN`,
`ZAI_API_KEY`.

**Real hygiene finding (LOW):** four dated backup copies of what is very likely an
earlier-in-time version of this same secret set persist unencrypted on disk (`.env.bak`,
`.env.backup-2026-07-18-glm-proxy-disable`, `.env.bak-pre-oauth-refresh-2026-07-28`, plus
`.env.enduser`, a separate live variant). If any of the named credentials above were rotated after
a given backup's timestamp, that backup still contains the pre-rotation value at rest on this
server. Not itself a leak (server is not public, no git tracking), but worth the Owner's own
housekeeping pass independent of any rotation decision -- deleting stale backups after confirming
nothing depends on them is not a "credential rotation" action and is not blocked by §5 of the
registration doc, but is noted here rather than acted on, since this dispatch's own scope is
discovery only.

---

## 5. Finding D (INFORMATIONAL, negative result) -- No new exposed credential found in `compliance-tracker`'s current tracked tree

The manual pattern sweep (method §1.2) against the full current `HEAD` tree of `compliance-tracker`
found **zero** real matches for Anthropic/OpenAI/AWS/GitHub-PAT/Slack/Google/PEM-key patterns
outside the two locations already covered by Finding B, and **zero** untracked `.env` files beyond
`.env.example`. The only `postgres://`-shaped URI matches were CI placeholder connection strings
(`postgresql://postgres:placeholder@localhost:5432/postgres`, used only for local/CI `tsc`/`bun
test` runs against no real database) and one historical doc
(`history/TASK_LIST.md`) with the password field already redacted as literal text `[DB_PASSWORD]`,
not a real value. This is a real, checked negative result, not an absence of effort.

---

## 6. Summary for the Owner

| # | Finding | Severity | Action needed | Blocked by |
|---|---|---|---|---|
| A | 22 open, publicly-leaked Google API keys, `veda-advisors`, likely Google's own public client keys not VERIDIAN's | HIGH (as scanned; likely lower on judgment -- see §2) | Owner decision: purge history + close as false-positive/third-party, vs. treat as VERIDIAN-owned and rotate | Rotation (if chosen) requires Owner naming this exact credential live in chat, per the standing rule; the alternate purge-history remediation is also a real, non-reversible production action on a live repo and should get the same explicit go-ahead |
| B | 1 open alert, `compliance-tracker`, same key as A, self-inflicted by OCID-054's own report quoting it in full | MEDIUM | Owner decision on remediation of A automatically resolves B (same underlying value); separately, adopt the truncated-citation practice (§3) going forward | Same as A |
| C | Real credential-name inventory across every category the Owner named, zero values exposed | INFORMATIONAL | None required now; this is the input list for whichever specific credentials the Owner names for rotation | N/A -- inventory only |
| D | No new exposed credential found in `compliance-tracker`'s tracked tree | INFORMATIONAL (negative result) | None | N/A |

**Restated per this dispatch's own standing rule:** none of the above proceeds to rotation,
revocation, or history rewrite from this session. The Owner must name the specific credential (or
specific remediation action, for Finding A/B) and confirm it directly in this chat at the moment of
execution. Once named and confirmed, the actual change is still real production/infrastructure work
and remains gated by OCID-020 through OCID-040 per `ai-os/OCID_056_REGISTRATION_2026-08-04.md` §5.
