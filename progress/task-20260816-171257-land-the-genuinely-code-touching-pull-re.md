# Task: land-the-genuinely-code-touching-pull-re

Owner directive 2026-08-16: FChecklist/compliance-tracker has 422 open PRs. Classify
by real changed-file signature, take ONLY the code-touching class (not doc-only, not
dependabot), audit each against its real current head SHA via the box's own
adopt+supervisor-sweep mechanism (not the broken at-claude GH Action comment
trigger), merge on genuine PASS, record real blocking reasons otherwise.

## Completed
- [x] Registered claim in ai-os/boss/ACTIVE-CLAIMS.yaml
- [x] Checked indexes per AGENTS.md Rule 12 (crontab-drift-approved-2026-08-14):
      no existing wiring_registry/capability_registry row covers "classify+merge
      422 open PR backlog" specifically; consulted CLAUDE_MEMORY_INDEX.md-equivalent
      (session's own long-term memory) for branch-protection state and audit-check
      mechanics -- see notes below.
- [x] No sibling PR-classification artifact exists yet in the repo (checked
      `git ls-tree -r origin/main` for pr-classif/open-pr/code-touching-named
      files -- none). Derived the classification myself per SPEC's fallback
      instruction.
- [x] Fetched the real full open-PR list (422) via paginated GraphQL (gh's own
      `--json`/`--jq` default caps at 30 items without an explicit `--limit`,
      and even `--limit 1000` redirected to a file got corrupted by the
      Bash-tool's large-output truncation trailer -- worked around by writing
      each GraphQL page directly to disk from Python, 50 PRs/page x 9 pages).
- [x] Classified all 422 by real changed-file signature (not just title
      prefix): 8 dependabot (excluded per SPEC), 42 non-dependabot PRs with a
      fix/feat/build/chore title prefix, of which **26 genuinely touch a real
      source/test/config/schema path** (src/**, drizzle/**, scripts/**,
      ai-os/scripts/**, tests, package.json/bun.lock, next.config.ts) and 16
      touch only bookkeeping paths (PROGRESS.md, AGENTS.md/CLAUDE.md,
      ai-os/boss/ACTIVE-CLAIMS.yaml/COMPLETED.yaml, ai-os/OS.yaml,
      ai-os/MASTER-TRACKER.yaml, progress/*.md) despite the code-suggesting
      prefix -- these 16 are real chore/fix *bookkeeping* closures, not code,
      left untouched (sibling's docs-only class, or simply out of scope).
      One borderline case noted: PR #1295 touches
      `ai-os/ci-templates/domain-drift-check.yml.pending-workflow-scope` (a
      real CI-check YAML body, held out of `.github/workflows/` only for
      token-scope reasons) alongside AGENTS.md/CLAUDE.md/governance YAML --
      treated as non-code/doc-adjacent here since the substantive file isn't
      live in any executable path yet; flagged for the doc-owning sibling to
      make the final call.
      **My working set, 26 PRs, newest-first:** #1286, #1230, #1229, #1200,
      #1199, #1028, #997, #994, #991, #979, #978, #968, #966, #965, #959,
      #954, #929, #808, #807, #668, #667, #666, #665, #663, #657, #618.
- [x] Confirmed `required_approving_review_count` is now 0 on `main` (checked
      live via `gh api repos/.../branches/main/protection`, corroborated by a
      concurrent sibling's own ACTIVE-CLAIMS entry) -- the long-standing
      self-approval merge deadlock documented in this session's memory
      (2026-08-06..08-14) is currently NOT in effect; `gh pr merge` is
      expected to work once CI+audit are genuinely green.

## Remaining
- [ ] Per-PR audit+merge loop (see table below, updated as each completes)
- [ ] Final report table (number / outcome / real mergedAt or blocking reason)
- [ ] Record completion via agent_work_briefing.py record-completion

## Per-PR status (updated live)
| PR | Title (short) | Status |
|----|----|----|
| 1286 | pin nanoid CVE | pending |
| 1230 | api-sandbox rate-limit | pending |
| 1229 | AI model lifecycle | pending |
| 1200 | Z.ai CSP/XFO/404/sitemap | pending |
| 1199 | GTM cat15/16 tenant | pending |
| 1028 | worker-entrypoint gate name | pending |
| 997 | CO/FI/SD calc engines | pending |
| 994 | CSP-Report-Only + XFO | pending |
| 991 | re-pin veridian-ui-kit | pending |
| 979 | layout.tsx PWA metadata | pending |
| 978 | sitemap.ts canonical domain | pending |
| 968 | brand pricing/contact/terms/privacy | pending |
| 966 | pricing brand mismatch | pending |
| 965 | signup/mfa-challenge brand | pending |
| 959 | pre-auth brand pricing/contact/terms/privacy | pending |
| 954 | signup brand hardcode fix | pending |
| 929 | GET /api/me perf + settings 403 | pending |
| 808 | CRM/ERP 403 UX explanation | pending |
| 807 | CLM templates/clauses 500-vs-403 | pending |
| 668 | crm_campaigns objective column | pending |
| 667 | PM Teams/Groups/Templates | pending |
| 666 | CRM CSV/XLSX import/export | pending |
| 665 | PM social/collaboration feed | pending |
| 663 | project_team_members table | pending |
| 657 | CRM Sales Pipeline KPI widget | pending |
| 618 | prompt translation/localization/marketplace | pending |
