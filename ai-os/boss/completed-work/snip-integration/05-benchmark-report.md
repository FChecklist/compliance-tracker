# snip Benchmark Report

All numbers below are real, either measured directly (`wc`/`ls`) or queried live from `~/.local/share/snip/tracking.db` (SQLite) on VERIDIAN-DEV. None are estimated.

## A methodology note that matters for reading these numbers honestly

`tracking.db`'s own `savings_pct` column measures the filter's **pipeline** step only, holding constant any argument-rewriting a filter's `inject:` step performs (e.g. `git-log`'s built-in filter injects `--pretty=format:...` before the pipeline ever runs). For filters with an `inject` step, this understates the *true* end-to-end reduction a user/AI would see versus a fully naive command with no snip at all. Where this matters, both numbers are given below, clearly labeled.

## Real measurements

| Command | Raw (no snip) | Filtered (via snip) | Reduction | Source |
|---|---|---|---|---|
| `git log -30` (compliance-tracker) | 34,311 chars / 681 lines | 2,441 chars / 31 lines | **92.9%** (true end-to-end) | direct `wc` comparison |
| ↳ same command, tool's own self-reported metric | 852 tokens (pipeline baseline, already using injected `--pretty` args) | 611 tokens | 28.3% (pipeline-only; see methodology note) | `tracking.db` id 6 |
| `gh pr checks 548` (19 checks, this PR's own CI) | 2,053 chars | 2,066 chars | **-0.6%** (no real benefit at this scale — honestly reported, not cherry-picked) | direct `wc` comparison |
| `bun test` (full real suite, 1898 tests, 0 fail) | 257,371 chars / 2,386 lines | 27,970 chars / 519 lines | **89.1%** | direct `wc`; corroborated by `tracking.db` id 5 (`89.13%`, methodology matches here since `bun-test.yaml` has no `inject` step) |
| `bun add left-pad` | 223 chars | 98 chars | **56.1%** | direct `wc`; `tracking.db` id 7 reports `37.5%` token-based |
| `bunx tsc --noEmit` (clean, no errors) | (would be silent either way — tsc prints nothing on success) | 1 char | n/a (no errors to compress) | live run, exit 0 |
| `go test ./...` (synthetic 1-pass-1-fail fixture, built-in filter) | 305 tokens | 5 tokens | 98.4% — **but see Risk Assessment: this is the concerning case, not a clean win** | `tracking.db` id 3 |

## Session aggregate (`snip gain`, real, live)

```
Commands filtered     7
Tokens saved          58.1K
Avg savings           86.7%
Efficiency            Great
Total time            12.9s
```

Per-command breakdown (real):
```
bun test (full suite)     1 run   57.3K saved   89.1%
git log -30               2 runs     464 saved   27.5%
go test ./... (synthetic) 1 run     300 saved   98.4%
bun add left-pad          1 run      15 saved   37.5%
gh pr checks 548          1 run      14 saved    2.7%
bun test (1 broken test)  1 run       0 saved    0.0%
```

## Real dollar-terms estimate (`snip cc-economics`, real, live)

```
Total tokens saved        58.1K
Estimated savings by model tier:
    Haiku    $0.01
    Sonnet   $0.17
    Opus     $0.87
Based on 7 filtered commands over 1 day.
```
(This is snip's own estimate assuming saved tokens are re-fed as input context — a real, if session-small, sample. It will scale directly with real day-to-day interactive/worker usage volume once this ships broadly; this session's 7 commands are a lower bound, not a projection.)

## Honest takeaway

The win is real but uneven: full-suite test output and large git-log ranges see 89-93% real reduction — the dominant, meaningful case for a debugging-heavy dev environment. Small-scale structured output (a 19-check `gh pr checks` call) shows no real benefit and can even add a few bytes of tee-pointer overhead. This matches the tool's own stated design center (verbose CLI/build/test noise), not every possible shell command uniformly.
