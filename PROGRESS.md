# PROGRESS -- task-20260802-172443-amendment--end-to-end-end-user-certifica

Amendment to `UMR-20260802-104058-25ba` (canonical artifact:
`ai-os/IMPLEMENTATION_MATRIX_2026-08-02.md`). Real end-to-end end-user
certification pass on PROJEXA-AI.COM — live browser testing, not code review.

## Completed
- [x] Read AGENTS.md/CLAUDE.md governance chain, ACTIVE-CLAIMS.yaml, canonical
      matrix (`ai-os/IMPLEMENTATION_MATRIX_2026-08-02.md`, item 11: 22 real
      Playwright specs exist targeting live projexa-ai.com, never run as a
      full suite, no CI job).
- [x] Checked for prior/in-flight adversarial or E2E-certification work on
      PROJEXA-AI.COM specifically: found the 2026-07-19 5-phase spec-authoring
      program (closed, wrote the specs, did not run them as a full suite) and
      `ai-os/audits/projexa_erp_e2e_reaudit_2026-07-27.md` (source-code/test
      re-audit of 5 PRs, not a live browser end-user run). Neither is a
      duplicate of this directive's real live-browser certification ask.
- [x] Registered claim in `ai-os/boss/ACTIVE-CLAIMS.yaml`.

## Remaining
- [ ] Run the real existing 25-spec Playwright suite (`/opt/veridian/repos/projexa/e2e/`)
      against the real live `https://projexa-ai.com`, capture real pass/fail
      counts, screenshots, traces.
- [ ] Manually verify flows the suite may not cover as a first-time and power
      user: login, workspace setup, multi-tenant/multi-brand behavior, every
      menu/module, prompt flow, reports, cache behavior, search, VERI Chat/AI
      assistant, ERP workflows, real business scenarios.
- [ ] For every gap found: real evidence (screenshot/error/repro path),
      retest any claimed fix.
- [ ] Amend `ai-os/IMPLEMENTATION_MATRIX_2026-08-02.md` in place (item 11 and
      any other item touched) with real findings, go-live verdict.
- [ ] Move ACTIVE-CLAIMS entry to `recently_completed`, commit+push final.
