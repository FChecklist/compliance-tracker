# REGISTER CONVENTIONS - BOOLEAN_REGISTER.csv (contract for every writer)

Source of the format: WORK_ORDER section 8. This file adds the rules that make each row deterministic, close-ended and boolean. The linter (`lint_plan.py`) enforces everything marked LINT.

## Header (LINT: exact, one line)
`id,phase,title,source,verify_command,expected_output,status,evidence_ref,owner_blocked`

## Column rules
- `id` LINT unique. Format `BR-<phase><two digits>`: phase 1 = BR-101..BR-199, phase 2 = BR-201.., phase 3 = BR-301.., phase 4 = BR-401.., phase 5 = BR-501..
- `phase` LINT one of 1,2,3,4,5.
- `title` short noun phrase. Gate tests start with `[ENTRY] ` or `[EXIT] `. LINT: every phase has at least 1 [ENTRY] and at least 3 [EXIT] rows.
- `source` semicolon-separated ids. Must contain at least one unified id (`U-nn` from MERGE_MAP.md section 1) and should list every gap finding id it closes (`F-A05-2` style, from gaps_master.json) and the original test id (`WO2.5`, `E-06`, `D-09`, `T-3`). LINT: every U-id U-00..U-42 appears in at least one row; every finding id in gaps_master.json is either in a source cell here or in the Gap Closure Matrix of MASTER_PLAN.md.
- `verify_command` LINT non-empty, one line, bash syntax (Git Bash on Windows, also runs in GitHub Actions ubuntu), non-interactive, exit 0 = pass, non-zero = fail. No pipes into `head`/`wc` that hide the exit code: use `test "$(cmd)" = "value"` or `cmd | grep -q pattern`. Allowed forms only:
  - F1 SQL assertion: `node scripts/verify/sql-assert.mjs --project <ct|px> --sql "<one SELECT returning one value>" --equals <value>` (exit 3 = cannot run because VERIFY_DATABASE_URL is unset; treated as fail). SELECT only.
  - F2 unit/route test: `bun test --isolate <path> [<path> ...]` (always --isolate; never a bare `bun test`).
  - F3 script: `bash scripts/verify/<name>.sh` (the script must be listed in a register row that creates it).
  - F4 git count: `test "$(git grep -c -E '<pattern>' -- <path> | awk -F: '{s+=$2} END {print s+0}')" = "<n>"`.
  - F5 GitHub: `test "$(gh api <endpoint> --jq '<expr>')" = "<value>"`.
  - F6 file: `test -f <path>` or `test -s <path>`.
  - F7 plan lint: `python ai-os/projexa-build-001/lint_plan.py ai-os/projexa-build-001`.
  - F9 anonymous HTTP status of a PUBLIC URL (never a Vercel-deployed app URL): `test "$(curl -s -o /dev/null -w '%{http_code}' <url>)" = "<code>"`.
  - F8 Vercel/Supabase read API through a committed script only (`bash scripts/verify/<name>.sh`), never a mutating call.
  Forbidden: anything that deploys, unpauses, changes Vercel settings, changes DNS, creates a Supabase branch, applies a migration, sends email, or mints a session. Checks that need a deployed instance are `blocked_owner`.
- `expected_output` LINT non-empty and exact: `EXIT 0` plus, where a value matters, the exact stdout (for example `EXIT 0; stdout last line "0 fail"` or `EXIT 0; stdout "0"`).
- `status` LINT one of `pending`, `pass`, `fail`, `blocked_owner`. Initial value `pending` unless the item is already true and evidenced today (then `pass` with evidence_ref). `blocked_owner` only when the item needs recharge, a spend increase, DNS, an owner decision, or a deployed instance.
- `evidence_ref` LINT empty only while `pending`; otherwise a commit SHA, PR number (`PR#1837`) or a dated query result (`SQL 2026-09-25: 0`).
- `owner_blocked` LINT `yes` or `no`; `yes` if and only if status is `blocked_owner`.

## Banned words (LINT, whole file, case-insensitive)
improve, ensure, robust, appropriate, properly, handle, better, clean up, as needed, where useful, comprehensive, seamless (plus simple inflections: improved, ensuring, handled, handling, robustly, appropriately, comprehensively, seamlessly).

## Row quality rules (reviewers check these)
1. One row tests one thing. If a sentence needs "and", split it.
2. The expected result is a number, an exact string, a status code, or an exit code. Never "looks right".
3. A row that guards a defect has a partner row or note proving the check FAILS when the defect is present (falsifiability, R74-RULING-03): state the mutation in the title of a partner row or in evidence when it is run.
4. Vacuity guard: a count that can reach 0 by having no traffic needs a non-vacuity partner (a fixture write) - see LIVE_FACTS D-09.
5. Prefer the amended tests from MERGE_MAP.md, AMENDMENT_LOG and PM_DECISIONS.md over the original work order wording where they differ.
6. Date-gated checks state the date in the title: `[DATE 2026-09-27]`.
7. No row may depend on Vercel being live. Rows about Vercel cost read billing data through a committed read-only script.

## Phase gate shape (LINT)
Phase 1 ground; Phase 2 identity, scope, attribution; Phase 3 evidence standard; Phase 4 one record type on four surfaces; Phase 5 replicate then perception. Each phase's ENTRY rows are exactly the previous phase's EXIT rows restated as a check that they still pass (phase 1 ENTRY = amendment log exists).
