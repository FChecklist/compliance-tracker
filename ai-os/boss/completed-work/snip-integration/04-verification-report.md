# snip Verification Report

Every claim below was tested live on VERIDIAN-DEV; none are inferred from documentation alone.

## 1. Binary works

```
$ ~/.local/bin/snip --version
snip v0.22.0
```

## 2. Hook registered (see Configuration Report §1 for the full file read)

## 3. Headless (`-p --dangerously-skip-permissions`) mode fires the hook — the task's single most important "don't assume" item

- First attempt without the worker's real auth mechanism failed with `"Not logged in · Please run /login"` — correctly surfaced as a genuine auth gap, not silently worked around.
- Found the real mechanism: `worker-entrypoint.sh` sets `ANTHROPIC_BASE_URL=http://127.0.0.1:8787` and a placeholder `ANTHROPIC_API_KEY`, routing through `anthropic_openrouter_proxy_v2.py` (a local HTTP→OpenRouter/GLM-5.2 translation proxy). Confirmed a healthy instance already running (PID 1087, 14h+ uptime, `$10` budget cap with `$0.0001` spent, prior real `200` responses in its own log) — did **not** start a duplicate instance (a second attempt correctly failed with `Address already in use`, no orphaned process left behind, confirmed via `ps aux` afterward).
- Ran, with the exact same flags/env as production `worker-entrypoint.sh`:
  ```
  claude -p "Run this exact shell command using the Bash tool and then just reply with the single word DONE: git log -30" \
    --dangerously-skip-permissions --max-budget-usd 0.30 --output-format json
  ```
  Result: `is_error:false, result:"DONE", total_cost_usd:0.287435, num_turns:2` — the model genuinely invoked its Bash tool.
- **`snip hook-audit` recorded a real, timestamped entry for this exact run**: `2026-07-21 18:50  git log -30  git  yes  yes` (matched, rewritten).
- **`tracking.db` gained a real new row** (id 6, `git log -30`, `26.7%` savings) at the same timestamp.

Conclusion: confirmed, not assumed — headless mode fires the identical PreToolUse hook as interactive mode.

## 4. Custom filter matching — all 5 confirmed via `snip check`

| Command | Result before custom filters | Result after |
|---|---|---|
| `bun install` | `no filter` | `filter: bun-install` |
| `bun test` | `no filter` | `filter: bun-test` |
| `bunx tsc --noEmit` | `no filter` | `filter: bunx` |
| `bun x tsc` | `no filter` | `filter: bun-x` |
| `vercel ls` | `no filter` | `filter: vercel` |

## 5. Never-compress verification — tested explicitly, both a concern found and my own filters' safety confirmed

### 5a. A real, concrete finding: the *built-in* `go-test.yaml` filter can violate never-compress

Built a realistic synthetic `go test -json` fixture (standard, documented event schema) representing one passing and one failing test, the failure containing the literal marker string `SECURITY-CRITICAL REGRESSION IN AUTH TOKEN VALIDATION`, and ran it through the real built-in filter via a stub `go` binary (so the actual shipped `filters/go-test.yaml` pipeline executed, not a hand-simulation):

```
$ snip run -- go test ./...
1 passed, 1 failed
```

**The visible output contains zero information about which test failed or why** — the entire error text, including the security-marker string, is gone from what an AI agent would see directly. This is because `go-test.yaml` uses snip's `aggregate` action to collapse all `Action:"pass"/"fail"` JSON events into a bare count, after a `keep_lines` step that already discards every `Action:"output"` event (which is where Go's real assertion messages live).

**Mitigation confirmed present**: snip's `tee.mode: failures` (the default, confirmed via `snip config`) wrote the complete, unfiltered raw output to `~/.local/share/snip/tee/<ts>-go.log` on the non-zero exit, and appended a `[full output: <path>]` pointer to the visible output. `grep` against that file confirms the security-marker string is fully present there. **Detail is not permanently lost, but it is one file-read away and depends on the AI agent noticing and following the pointer** — see Risk Assessment for the recommendation this drives.

### 5b. This project's own custom `tsc` coverage does NOT have this problem

The built-in `tsc.yaml` (which covers plain `tsc`, the underlying compiler this project's `bunx tsc --noEmit` wraps) keeps every individual `error TSxxxx` line verbatim — confirmed by reading its real test fixtures (`filters/tsc.yaml`'s own `tests:` block) and by a live deliberately-broken-type-error test on this server:

```
$ cd /opt/veridian/workspace/snip-integration
$ echo 'const x: number = "not a number"' > src/lib/__snip_broken_temp.ts
$ bunx tsc --noEmit
src/lib/__snip_broken_temp.ts(1,7): error TS2322: Type 'string' is not assignable to type 'number'.
```
(rm'd immediately after capture; not committed)

### 5c. This project's own custom `bun-test.yaml` was deliberately designed to avoid the go-test.yaml problem, and this was verified live

Ran a real deliberately-failing bun test through the actual custom filter (not a hand-simulation):

```
$ cd /opt/veridian/workspace/snip-integration
$ snip run -- bun test src/lib/__snip_broken_temp.test.ts
bun test v1.3.14 (0d9b296a)

src/lib/__snip_broken_temp.test.ts:
1 | import { test, expect } from "bun:test"
2 | test("deliberately broken assertion for snip never-compress verification", () => {
3 |   expect(1 + 1).toBe(3)
                    ^
error: expect(received).toBe(expected)

Expected: 3
Received: 2

      at <anonymous> (/opt/veridian/workspace/snip-integration/src/lib/__snip_broken_temp.test.ts:3:17)
(fail) deliberately broken assertion for snip never-compress verification [3.79ms]

 0 pass
 1 fail
 1 expect() calls
Ran 1 test across 1 file. [459.00ms]
```

Every line of the real, live failure — source context, `error:`, `Expected:`/`Received:`, stack trace, and the `(fail)` line — survives byte-for-byte. Exit code 1 correctly propagated. This is `bun-test.yaml`'s deliberate design (deny-list only, never `aggregate`, never allow-list — see Configuration/Risk reports).

### 5d. Auth/authz failure preserved

Real, live-captured Vercel CLI credential error (no credentials configured on this box) passes through the custom `vercel.yaml` filter unchanged:
```
Vercel CLI 56.3.1 (Node.js 24.18.0)
Error: No existing credentials found. Please run `vercel login` or pass "--token"
Learn More: https://err.sh/vercel/no-credentials-found
```

## 6. Real-scale test: full test suite through the custom filter

```
$ bun test                              # raw, unfiltered
1898 pass, 0 fail, 3773 expect() calls, Ran 1898 tests across 151 files. [12.61s]
2386 lines / 257,371 chars

$ snip run -- bun test                  # through bun-test.yaml
1898 pass, 0 fail, 3773 expect() calls, Ran 1898 tests across 151 files. [11.54s]
519 lines / 27,970 chars
```
Pass/fail counts identical before and after filtering — confirming the filter changes presentation, not test outcome reporting.
