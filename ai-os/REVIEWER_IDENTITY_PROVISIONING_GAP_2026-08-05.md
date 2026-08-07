# Reviewer Identity Provisioning Gap (2026-08-05)

**Real dispatch instruction:** `UMR-20260805-091629-d8e3` (Owner directive)
**Related:** `UMR-20260805-034917-33a9` (the branch-protection hardening this supports), `UMR-20260805-091648-6793` (a real, temporary, bounded exception currently active on `required_approving_review_count` while a real second reviewer identity does not exist yet)

This document honestly records what this session did and did not accomplish against `UMR-20260805-091629-d8e3`, and gives the Owner a precise, actionable recommendation for the one real step this session could not take itself.

## The Owner's real ask

A real, separate GitHub identity (App or service account) that can review PRs but never author/push code, wired into the dispatch/review pipeline, **plus** an automated check confirming reviewer and author are never the same account on any given PR.

## What this session built (real, working, merged code)

- `scripts/check-reviewer-not-author.mjs` -- a pure `evaluate({ prAuthorLogin, reviews })` function plus a `main()` CLI entrypoint. `evaluate()` returns `{ blocked: true, ... }` if and only if any review with `state === "APPROVED"` was submitted by the same GitHub account (case-insensitive) as the PR's own author. A `COMMENTED` or `CHANGES_REQUESTED` review from the author does **not** block -- this check's job is identity-mismatch on an actual approval, not presence/count of reviews (that is `required_pull_request_reviews`' job). `main()` resolves the real PR number (CLI arg, or `GITHUB_EVENT_PATH`'s `pull_request.number`, which both `pull_request` and `pull_request_review` CI events carry) and fetches the real, live author + review list via `gh pr view <pr_number> --json author,reviews`.
- `scripts/check-reviewer-not-author.test.ts` -- real `bun test` regression coverage (9 tests, all against the pure `evaluate()` function, no mocked internals): same-account `APPROVED` blocks (including a case-insensitivity case and a case where it's mixed in with other, non-colliding reviews); different-account `APPROVED` is allowed; zero reviews is allowed; reviews present but none `APPROVED` (including one from the author) is allowed; a same-account `COMMENTED` or `CHANGES_REQUESTED` review does not block; an empty/unresolved author login never false-matches an empty reviewer login.
- `ai-os/registry/PENDING-MANUAL-APPLICATION-reviewer-not-author-check.yml.txt` -- the complete, ready-to-use GitHub Actions workflow, staged at this non-`.github` path for the same real, structural reason `PENDING-MANUAL-APPLICATION-sec07-ocid-lock-check.yml.txt` was: this session's GitHub token lacks the `workflow` OAuth scope, so GitHub itself rejects any push that creates or updates a real `.github/workflows/*.yml` file. Needs one real `git mv` into `.github/workflows/` plus a push through a channel with real `workflow` scope to go live. Runs on `pull_request` (opened/synchronize/reopened) and `pull_request_review` (submitted) events, since a review can be submitted well after the PR itself was opened.

Both real test suites pass locally: `bun test ./scripts/check-reviewer-not-author.test.ts` (9/9) and, confirmed unbroken, `bun test ./scripts/check-sec07-ocid-lock.test.ts` (12/12, pre-existing, unmodified by this work).

## What this session did NOT and could not do

**Identity provisioning cannot be completed by this or any automated agent session.** Independently confirmed, not assumed:

- The only real GitHub identity available anywhere in this system is the `FChecklist` account. `gh auth status` shows token scopes `gist`, `read:org`, `repo` -- no `admin:org`, no GitHub App management scope.
- `gh api orgs/FChecklist/members` returns `404` -- this token has no org-admin visibility to even enumerate, let alone provision, a second identity.
- Creating a GitHub App requires either the interactive, browser-based manifest flow, or `admin:org`/app-management OAuth scopes this token does not have. Both are structurally out of reach for a headless session with only the `FChecklist` PAT.

This is a real, structural limitation of the credentials available in this environment, not a shortcut this session chose not to take. No GitHub account, GitHub App, or credential was created, faked, or claimed to exist by this session.

**Consequence for the check just built:** `scripts/check-reviewer-not-author.mjs` is real and tested, but it cannot meaningfully *fire* in this repository's current real state either way -- there is no second real reviewer identity to ever produce a same-account `APPROVED` review from a distinct token/session. It is staged now, exactly like the SEC-07 gate was staged ahead of its own manual-apply step, so it is ready the moment a real second identity exists.

## Precise recommendation for the Owner (the one required action)

**Create a GitHub App**, not a second human account -- cleaner, and more clearly "not a human reviewer pretending." Concretely:

1. **Permissions -- exactly two:**
   - `Pull requests: Read & write` -- needed to actually submit a review via the API. Documenting the real nuance plainly rather than overclaiming a cleaner separation exists: **GitHub's permission model has no finer-grained "review but don't merge/push" permission than this.** `Pull requests: Read & write` is also what would let the App merge a PR or push a commit to a PR branch it has access to, if it ever tried. The real thing that prevents it from ever authoring/pushing code is permission (2) below, not this one.
   - `Contents: Read` only -- **no write.** This is what actually satisfies the Owner's real intent ("never author/push code"): with no `Contents: write`, the App has no path to push a commit, create a branch, or merge (merging a PR is itself a content-changing operation gated by this same permission), regardless of what its `Pull requests` permission allows.
2. **Install it on `compliance-tracker` only** (not org-wide), matching the narrow, per-repo scope everything else in this pipeline already uses.
3. **Generate a private key** for the App, and store it wherever this system's real secrets are already kept (this repository's own convention: GitHub Actions repo secrets, alongside `ZAI_API_KEY`/`ANTHROPIC_API_KEY` per `AGENTS.md`'s "Authorized Agents" section).
4. **Provide to whoever operates this session next:**
   - The App's real client ID / installation ID
   - Its real private key

Once those two real artifacts exist, the remaining wiring step -- calling the GitHub API as that App's identity to submit a real review during the supervisor pathway, and confirming `scripts/check-reviewer-not-author.mjs` genuinely distinguishes that identity from `FChecklist` on a real PR -- can be completed by a future session. That wiring step is explicitly not attempted here; it requires the App to exist first.

## Real citations

- This check's implementation: `scripts/check-reviewer-not-author.mjs`, `scripts/check-reviewer-not-author.test.ts`
- Staged workflow: `ai-os/registry/PENDING-MANUAL-APPLICATION-reviewer-not-author-check.yml.txt`
- Precedent for the staged-workflow pattern and the `workflow`-scope constraint: `ai-os/registry/PENDING-MANUAL-APPLICATION-sec07-ocid-lock-check.yml.txt`, `scripts/check-sec07-ocid-lock.mjs`
- Related UMRs: `UMR-20260805-091629-d8e3` (this directive), `UMR-20260805-034917-33a9` (branch-protection hardening), `UMR-20260805-091648-6793` (the active, temporary, bounded review-count exception)
