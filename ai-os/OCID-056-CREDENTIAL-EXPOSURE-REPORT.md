# OCID-056 — Real Credential Exposure Report

**Date:** 2026-08-04 | **Scope:** `FChecklist/compliance-tracker` (this repo), full git history (2702 commits) + current working tree + adjacent live infra referenced from it. **Authorization:** discovery/audit only — no credential was rotated, tested against a live endpoint, or otherwise used as part of this work.

**Method:** `gitleaks detect --source . --log-opts="--all"` (full history, all branches reachable from the default remote refs present in this clone) — 2702 commits scanned, 403 raw matches — every unique file triaged by hand below. Supplemented with targeted `git log --all -p -S"<pattern>"` pickaxe searches for common key prefixes gitleaks' default ruleset doesn't specifically name (`sk-ant-`, `sk-proj-`, `sk-or-v1-`, `ghp_`, `github_pat_`, `AIza`, `xoxb-`/`xoxp-`, `postgres://postgres`, SendGrid `SG.`, PEM private-key headers) — **zero hits** on any of those across all history.

---

## 🔴 URGENT — reported to Owner immediately, not held for next cycle

### 1. Live Supabase `service_role` key committed in plaintext to a PUBLIC repo

- **File:** `CLAUDE-HANDOFF.md` (historical — **not present in the current working tree**; recoverable from git history by anyone who clones or browses this repo, since it is public)
- **Commits:** `b5fc40894d`, `7078505ba2`, `95192c9520` (same two JWTs re-committed across all three; lines 103–104 in each)
- **Repo visibility:** confirmed **PUBLIC** via `gh repo view FChecklist/compliance-tracker --json isPrivate,visibility` → `{"isPrivate":false,"visibility":"PUBLIC"}`
- **What was exposed:** two Supabase JWTs for project ref **`jusqumifsmtcaujqyjuy`** — an `anon` key (line 103, low sensitivity by design) and a **`service_role`** key (line 104, **bypasses Row-Level Security entirely, full DB read/write/admin**).
- **Why this is urgent, not historical noise:** `jusqumifsmtcaujqyjuy` is **not a dead/decommissioned project**. Per this repo's own `orchestra_changes.md` (§ "Live infrastructure findings"), that project is the real, live database backing **MeetTrack** (a separate, live production product under the same owner) — confirmed real tables `users`, `meetings`, `action_items`, `ai_sessions`, and **`user_api_keys`**. Only two *compliance-tracker-specific* schemas (`compliance`, `compliance_tracker`) were later dropped from that project as dead artifacts; MeetTrack's own `public` schema was explicitly verified untouched. A leaked `service_role` key for this project is a live-blast-radius finding against a different product's real user data, not just this repo's own database.
- **Blast radius if unrotated:** full unauthenticated (no login required — this key IS the credential) read/write access to MeetTrack's production Postgres, including `user_api_keys` — i.e. this single leaked key could expose or let an attacker exfiltrate *other users'* stored API keys.
- **What was NOT done, per this task's explicit authorization limit:** the key was not tested against the live Supabase API, not used to query anything, and not rotated. Whether it has already been rotated since these June/July commits is unknown to this report — that determination and the rotation decision itself belong to the Owner, provider by provider, per this task's own scope limit.
- **Recommended next step (decision, not action taken):** Owner confirms whether `jusqumifsmtcaujqyjuy`'s `service_role` key has been rotated since 2026-07 (or authorizes rotating it now); if it hasn't, this is the single highest-priority item in the whole discovery sweep.

### 2. Same Supabase `anon` key also found in two other locations (lower severity, same project)

- `.env.example`, commit `b93c68aae4`, line 8 — anon key only (not present in current tree either — no `.env.example` is currently tracked in this repo).
- `ai-os/PROJEXA_AI_COM_AUTHENTICATED_SCREENS_AUDIT_2026-08-02.md`, commit `56bb75b288`, line 49 — this one is for the **current, live production project** `pcrjmlpuqsbocqfwoxod`, not the old one.
- **Assessment:** `anon` keys are *designed* to be public — they ship to every browser as `NEXT_PUBLIC_SUPABASE_ANON_KEY` and are meaningless without RLS policies doing the real access control. Documenting one in an audit doc is not a meaningful exposure on its own. Flagged here for completeness only, not as an action item.

---

## Reviewed and confirmed NOT a real exposure (false positives, checked individually)

| File | Gitleaks rule | Why it's not real |
|---|---|---|
| `src/lib/composio-connectors.ts` (339 hits, current file) | `generic-api-key` | Every match is a hardcoded `authConfigId` (e.g. `ac_011eZbN9n-gT`) — Composio's own **public** config-reference identifiers, not secrets. The real secret (`COMPOSIO_API_KEY`) is read from `process.env` at line 108, never hardcoded. Confirmed by reading the file's own inline comment ("same 'never store the secret itself' posture...") and the surrounding code. |
| `apps/web/.next/prerender-manifest.json`, `apps/web/.next/server/{server-reference,middleware}-manifest.json` — commit `2d2c91a68`, 2026-06-27 | `generic-api-key` | Next.js's own internal, auto-generated build-time keys (`encryptionKey`, `NEXT_SERVER_ACTIONS_ENCRYPTION_KEY`, `__NEXT_PREVIEW_MODE_SIGNING_KEY`/`_ENCRYPTION_KEY`). Regenerated on every build unless explicitly pinned via env vars (this codebase does not pin them). **Real, separate finding worth noting**: a build output directory (`apps/web/.next/`) was committed at all, under a since-abandoned `apps/web/` monorepo restructure — not present in the current tree, and the root `.gitignore`'s `/.next/` rule is anchored to repo root so would **not** have caught a nested `apps/web/.next/` path had that structure still existed. Low current risk (path no longer exists, keys are build-ephemeral) but the `.gitignore` gap is real; see Environment Security Report §4. |
| `src/app/api/webhooks/vercel-deployment/route.test.ts`, `src/lib/webhooks/vercel-signature.test.ts` (24 hits each) | `generic-api-key` | Test fixtures: `SECRET = "whsec_test_secret_1234567890"` — an obviously-fake literal used to unit-test signature verification, not a real webhook secret. |
| `scripts-scratch/ocid049-state.json`, `scripts-scratch/ocid049-tier-scale.mjs` (commit `ba173d6f89`) | `generic-api-key` | Synthetic test password `OCID049-test-pass-<timestamp>` generated by a prior OCID-049 load-test script, not a real credential. |

**Pickaxe searches, zero hits (full history):** `sk-ant-`, `sk-proj-`, `sk-or-v1-`, `ghp_`, `github_pat_`, `AIza`, `xoxb-`, `xoxp-`, `postgres://postgres`, `SG\.`, `-----BEGIN...PRIVATE KEY-----`. No Anthropic, OpenAI, OpenRouter, GitHub PAT, Google, Slack, SendGrid, or raw PEM private key has ever been committed to this repo's history in a form gitleaks or these targeted patterns would catch.

## Environment/config files checked

- No `.env*` file is tracked in the current working tree (`git ls-files` returns none); `.gitignore` explicitly excludes `.env*`.
- All 13 `.github/workflows/*.yml` files reference secrets exclusively via `${{ secrets.NAME }}` — zero hardcoded values found (`git grep` for a hardcoded-looking `KEY:`/`SECRET:`/`TOKEN:`/`PASSWORD:` literal not wrapped in `secrets.` returned nothing).

## Not covered by this sweep (honest limitation)

- **Screenshots / images / binary build artifacts**: gitleaks and the pickaxe searches are text-pattern tools; they cannot OCR text baked into a PNG/JPG. No image files matching credential-adjacent filenames (e.g. `*supabase*.png`, `*token*.png`) were found via `git ls-files` in this repo, so there is no specific screenshot flagged as needing manual visual review, but this is a scope limitation of the method, not a positive clearance of every image ever committed.
- **Browser storage (localStorage/sessionStorage)**: reviewed as a *permission* concern (see Permission Audit Report) rather than a static-exposure concern — nothing analogous to gitleaks exists for runtime browser storage; this would require live-session inspection, which is outside a static/history discovery pass.
- **Other repositories** (`veda-advisors`, `projexa`, `veridian-scripts`, etc. under `/opt/veridian/repos/`): out of this task's scope, which is this repo (`compliance-tracker`). The MeetTrack finding above surfaced *from* this repo's own history even though MeetTrack itself lives elsewhere — worth a matching sweep of MeetTrack's own repo, if the Owner wants one, but not performed here.
