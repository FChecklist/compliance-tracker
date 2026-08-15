# OCID-056 — Real Permission Audit Report

**Date:** 2026-08-04. Scope: who/what can access this repo, its secrets, its production infra, and its API surface — based on live queries against GitHub, plus a direct code audit of the app's own auth gating. No permissions were changed as part of this audit.

## 1. Repository-level access (GitHub)

- **Collaborators:** `gh api repos/FChecklist/compliance-tracker/collaborators --jq '.[].login'` → exactly **one**: `FChecklist` (the repo owner account). No other human or bot GitHub account holds direct collaborator access to this repo.
- **AI agent access is via PAT, not GitHub collaborator grants**: per `AGENTS.md`, both full-access agents (Z.ai GLM, Claude Code Secondary) and the interactive Super Boss session act through `PAT_FCHECKLIST` — i.e. they inherit the owner account's own permissions rather than being scoped, separately-permissioned identities. This means there is no GitHub-level way to distinguish "the owner acting directly" from "an AI agent acting via PAT" in the repo's own audit log (commit author metadata is the only differentiator, and that's self-reported by whichever agent is committing, not enforced by GitHub).
- **Branch protection on `main`** (`gh api .../branches/main/protection`, live): `enforce_admins: true` (no bypass, including for the PAT owner), required status checks = `Lint`, `Type Check`, `Build`, `audit-check`, `Guardrail Presence Check`, `Asset Registry Coverage Check`, `Unit Tests` (all must pass), `required_approving_review_count: 0` (matches AGENTS.md Rule 6's documented "no dedicated human reviewer to bottleneck on"), `allow_force_pushes: false`, `allow_deletions: false`. This matches what AGENTS.md Rule 6 claims — independently confirmed against the live GitHub API, not just read from the doc.
- **Repository visibility: PUBLIC** (`gh repo view --json isPrivate,visibility`). This is the fact that turns the `CLAUDE-HANDOFF.md` git-history finding (Exposure Report §1) from "an old file with a stale key" into a live public-exposure incident — anyone can browse this repo's full commit history without any credential of their own.

## 2. Highest-privilege application code paths (service-role / RLS-bypass)

`git grep -l SUPABASE_SERVICE_ROLE_KEY -- 'src/*'` → 17 files hold the ability to construct an RLS-bypassing Supabase admin client:

```
src/app/api/auth/passcode-login/route.ts
src/app/api/auth/sso/[orgSlug]/acs/route.ts
src/app/api/client-portal/[token]/documents/route.ts
src/app/api/construction/ai/diff-drawings/route.ts
src/app/api/construction/ai/estimate-progress/route.ts
src/app/api/documents/[id]/route.ts
src/app/api/documents/route.ts
src/app/api/internal/secrets-audit/run/route.ts
src/app/api/mcp/route.ts
src/app/api/settings/branding/logo/route.ts
src/app/api/users/route.ts
src/app/api/v1/projexa/drawings/route.ts
src/app/api/v1/projexa/permits/route.ts
src/app/api/voice-tickets/route.ts
src/lib/services/document-service.ts
src/lib/services/esignature-service.ts
src/lib/services/workspace-memory-service.ts
```

Spot-checked `src/app/api/documents/route.ts` and `src/app/api/users/route.ts` directly: both construct the service-role client **only after** `requireAuth()` (or `requireRole()`) has already run and returned a valid session — the pattern is "authenticate the human first, then use the admin client for a specific privileged operation the authenticated user is entitled to trigger" (e.g. generating a signed URL, cross-tenant lookup for a support flow), not "admin client reachable pre-auth." `src/app/api/documents/route.ts` even carries an explicit code comment to this effect ("service-role client, used ONLY server-side after requireAuth() has already..."). Not every one of the 17 files was individually re-verified line-by-line in this pass — the two checked are representative of the pattern, not a claim that all 17 were independently confirmed.

`src/app/api/mcp/route.ts` is the one legitimate exception to "requireAuth() first": it's a customer-facing MCP (Model Context Protocol) endpoint authenticated by its own `Bearer vk_...` API-key scheme (looked up against the `api_keys` table) rather than a browser session — the service-role client there is used to look up and validate that API key itself (a chicken-and-egg case: you need an admin client to check whether the presented key is real before you know who the caller is), then all subsequent data access is scoped to that key's own org.

## 3. API route auth-gate coverage

`git ls-files 'src/app/api/**/route.ts'` → **994** route files. `git grep -l requireAuth` → **930** call it directly. The remaining **64** were enumerated and categorized (not individually re-verified line-by-line beyond the representative sample below):

- **Pure re-export shims** (e.g. every `src/app/api/v1/projexa/*` route) — these files contain a single line like `export { GET, POST } from "@/app/api/v1/construction/kpi-definitions/route"`; the real handler lives at the re-exported path and was already counted in the 930. Verified for `kpis`, `labour`, `attendance`, `predictions`, `scope`, `site-diary`, `work-progress`, and both `ai/*` routes — all delegate to a handler using `requireAuthOrApiKey`.
- **`/api/internal/*` cron routes** — gated by a shared `CRON_SECRET` bearer-token check (`isAuthorized()`) instead of a user session, since these run on a schedule with no logged-in user. Verified `ops-task-sync` directly; the sibling `internal/*` routes follow the same documented pattern per `secrets-audit/run/route.ts`'s own header.
- **Alternate token-based auth** — `/api/mcp` (`Bearer vk_...` API keys, see §2), `/api/support-sessions/whoami-target` (`Bearer ss_...` support-session tokens, validated via `validateSupportSessionToken`), `/api/esignature/sign/[token]/*`, `/api/client-portal/[token]/*`, `/api/vendor-portal/[token]/*`, `/api/partner/[token]/*`, `/api/invite/[token]/*`, `/api/guest-chat/[token]/*` — all use a single-purpose opaque token embedded in the URL instead of a login session, appropriate for external parties (clients, vendors, partners, invitees) who by design don't have platform accounts.
- **Intentionally public** — `/api/health`, `/api/v1/openapi.json`, `/api/contact/*`, `/api/track/offer` (explicit code comment: "Public by design"), `/api/forge/*` (captcha-gated public form), `/api/join-code/preview`, `/api/public/portal/[orgSlug]/kb/[slug]`.
- **Auth entry points themselves** — `/api/auth/passcode-login`, `/api/auth/sso/[orgSlug]/{login,acs}` — these *are* the login mechanism, so by definition run before any session exists; they use `SUPABASE_SERVICE_ROLE_KEY` internally to validate credentials/SSO assertions rather than `requireAuth()`.

**No raw, ungated route was found in this pass.** This is a spot-check across representative categories, not an exhaustive line-by-line re-derivation of all 64 — flagged honestly as a scope limit, same class as this repo's own `check-guardrail-presence.mjs` header names for its own checks.

## 4. AI agent authority (per `AGENTS.md`, cross-checked against what's actually live)

- Z.ai GLM and Claude Code (Secondary) are documented as `FULL_ACCESS` — all files, all operations — gated only by Rule 6 (PR/CI, no direct push to `main`) and Rule 9 (guardrail-manifest protection). Confirmed live: branch protection (§1) does enforce this at the GitHub level for both.
- The Super Boss role (interactive Claude Desktop/Code session, added 2026-07-10) has the broadest documented authority — including live DB migrations via Supabase MCP and driving CI — but is explicitly still bound by Rule 6 (no direct `main` push, confirmed enforced at the GitHub level with `enforce_admins: true`, i.e. this is not just a documented courtesy).
- Rule 11 (2026-07-31 Owner directive) removed the `awaiting_human_approval` hold for tasks whose own review verdict is `approve` — i.e. as of that date, credential-adjacent or financial-calculation changes are **not** specially held for a human sign-off step beyond the existing review+`scope-check.py` gate. This is directly relevant to why this task's own PM explicitly re-confirmed, in-chat, that rotation itself (as opposed to discovery) still requires a fresh, separate, provider-by-provider decision — that's a **tighter** constraint than the blanket Rule 11 autonomy grant, scoped specifically to this credential-rotation task, and this report treats that explicit narrower instruction as controlling.

## 5. Not covered by this pass (honest limitation)

- Supabase project-level permissions (which service roles/API keys exist *inside* Supabase itself, RLS policy correctness per table) were not independently re-audited here — `orchestra_changes.md` documents RLS enablement work as of 2026-07-01, and 136 of 283 tracked migration files touch RLS-related SQL, but this report did not re-verify RLS is actually enabled on every current table.
- Vercel team membership / who can access the Vercel dashboard itself (as opposed to who holds `VERCEL_ACCESS_TOKEN`) was not queried — the `vercel whoami`/`vercel project ls` CLI calls in this session hung waiting on interactive auth rather than returning data, and were not forced through non-interactively to avoid an unbounded background process.
