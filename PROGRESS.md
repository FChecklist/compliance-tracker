# PROGRESS — 2026-08-31: rebase-and-merge of PR #968 (supersedes sibling PR #966)

Two independent PRs (#968, #966), opened 48 minutes apart against the same real gap
(GAP-PROJEXA-MARKETING-PAGES-HARDCODED-VERIDIAN: /pricing, /contact, /terms, /privacy
render hardcoded VERIDIAN wordmark instead of resolving per-host brand), neither aware
of the other. Decision (owner-directed): #968 is the broader/more complete PR --
it covers /pricing, /contact, /terms, /privacy AND a real tagline field on
`PreAuthBrand` (org-branding-service.ts, backed by the pre-existing unused
`product_branches.tagline` column) that #966 does not touch. #966 is narrower
(pricing only) but does include a real, honest cross-PR collision check in its own
body, correctly finding and deferring to sibling PR #965 (a different, already-real
PR covering /signup + /mfa-challenge, unaffected by this decision).

Rebase performed in an isolated worktree (`rebase-968` branch): fetched PR #968's
real head branch (`worker/task-20260805-185202-ocid-020-gtm-cert-addendum--fix-pre-auth`),
merged it onto fresh `origin/main`, then merged `origin/main` again to pick up
anything that landed mid-rebase. Opened as PR #1492. `main` moved forward again
(picking up #1490 "rebase-1014-fixed" and #1491) before #1492 could merge, so this
entry also covers that second, later re-merge.

## Conflicts resolved
- `PROGRESS.md`: this file follows this repo's established convention of holding only
  the *current* active entry, not an accumulated log (confirmed against origin/main's
  real content, which itself held only its own single latest entry, "rebase-1014-fixed",
  with nothing older). Replaced wholesale with this entry rather than concatenating --
  a prior invocation of this same task had mistakenly concatenated three old entries
  end-to-end here instead; that mistake is corrected in this pass, not repeated.
- `ai-os/boss/ACTIVE-CLAIMS.yaml`: kept-both -- current main's full `active:`/
  `recently_completed:` sections preserved verbatim, with PR #968's own
  `task-20260805-185202-ocid-020-gtm-cert-addendum` claim entry (absent from main,
  since the PR hadn't merged yet) inserted at the top of `active:`. Re-validated
  parseable with `js-yaml` (`json: true` mode, matching
  `check-governance-yaml-parse.mjs`'s own loader) both before and after. Auto-merged
  clean on the later re-merge against #1490/#1491 -- no further hand resolution needed.
- `ai-os/registry/terminology-guardrail-exemptions.yaml`: auto-merged clean on the
  later re-merge (main's own concurrent edits were in unrelated entries).
- `src/app/pricing/page.tsx`: real conflict -- HEAD (current main at the time) still had
  the old, pre-split, fully-client-side monolithic page; PR #968's side is the new async
  Server Component + `pricing-client.tsx` split. Took PR #968's side. Main had
  independently made 5 small unrelated changes to the old file since PR #968 branched
  (2026-08-05) -- an `aria-hidden="true"` accessibility fix on the decorative logo
  glyph, and 4 `text-ct-saffron` -> `text-ct-saffron-text` design-token renames
  (confirmed real and repo-wide via `git diff <merge-base> origin/main`, and that
  `ct-saffron-text` is genuinely used in 20+ other files) -- both re-applied onto the
  new `pricing-client.tsx` so neither regresses.
- This PR's own body claims a `bunfig.toml` addition; confirmed via
  `git diff --cached --name-only` that no such file is actually part of the real diff
  -- ignored per the triage note, harmless stale claim.

## Terminology Guardrail Check
`node scripts/check-terminology-guardrail.mjs` found 10 real (not previously
exempted) `hardcoded_iso_date` findings across 9 files touched by this PR --
all genuine dated code comments (this repo's established "cite the real UMR/date
this change implements" convention), not example/placeholder data. Added/raised
exemption entries in `ai-os/registry/terminology-guardrail-exemptions.yaml` (2 raised:
`org-branding-service.ts` 3->4, `org-branding-service.test.ts` 1->2; 7 new file
entries: contact/data-policy/pricing/privacy/terms page.tsx, pricing-client.tsx,
LegalShell.tsx). Re-ran the check clean after.

**Real, honestly-flagged finding: this check (and the mandatory-audit-check.yml
workflow this task's own setup instructions expected to gate this PR) were BOTH
already removed from this repo 13 days before this task ran** -- commit `c37f91c9`
("chore: remove dispatch machinery workflows and guardrail scripts", PR #1301,
2026-08-18, real Owner-authored commit) deleted `mandatory-audit-check.yml` and
dropped `terminology-guardrail-check` (plus guardrail-presence, asset-registry-
coverage, metadata-index-coverage, doc-quarantine-banner, doc-cross-references) from
`ci.yml`'s job list entirely -- confirmed by reading `ci.yml`'s actual current job
names (`lint`, `typecheck`, `build`, `unit-tests`, `migration-collision-check`,
`route-error-handling-check`, `migration-integrity-check`,
`governance-yaml-parse-check`, `migration-schema-drift-check`, `new-test-coverage`,
`test-coverage-gap-report`, E2E) and via `git log --all -- .github/workflows/
mandatory-audit-check.yml`. Neither check can fail CI on this PR today. Did the
guardrail-exemption work anyway (real debt, real governance file, still worth
keeping accurate even though nothing currently enforces it) and posted a genuine
`AUDIT: PASS` comment per Rule 7(c)'s still-sound doer/auditor-separation practice
-- but not framed as satisfying a CI gate that no longer exists.

## Verification run this session
- `node scripts/check-governance-yaml-parse.mjs` -- pass (5/5 governance files parse)
- `node scripts/check-terminology-guardrail.mjs --file <9 touched files>` -- pass,
  0 new findings, after the exemption updates above
- `bunx tsc --noEmit` (`NODE_OPTIONS=--max-old-space-size=4096`) -- clean, no errors
  attributable to this change
- `bun test src/lib/services/org-branding-service.test.ts` -- pass (see this file's
  own commit history for the earlier machine-load timeout flake root-cause note,
  unrelated to this PR's diff)

## Remaining (this later re-merge pass)
- [x] Re-merge `origin/main` (picked up #1490 "rebase-1014-fixed" and #1491
      "r65-part-b-autonomy-gate") -- only `PROGRESS.md` needed hand resolution,
      `ai-os/boss/ACTIVE-CLAIMS.yaml` and `terminology-guardrail-exemptions.yaml`
      auto-merged clean.
- [x] Close #966 for real -- an earlier invocation of this task had posted #966's
      "closing as superseded" comment but never actually called the close-PR API;
      the PR was still open. Closed for real this pass.
- [ ] Push, wait for CI, merge #1492.
