# snip Risk Assessment

## 1. Never-compress risk in built-in filters (confirmed real, not hypothetical) — MEDIUM, mitigated

`filters/go-test.yaml` (and potentially other built-ins using the `aggregate` pipeline action — not individually audited beyond this one, see Recommendation below) can collapse a real test failure, including the actual assertion/error message, down to a bare pass/fail count with zero inline detail (see Verification Report §5a for the live reproduction with a synthetic security-marker string that disappeared from visible output).

**Mitigation already in place, confirmed working**: `tee.mode: failures` (the shipped default) writes the complete unfiltered output to `~/.local/share/snip/tee/<ts>-<cmd>.log` on any non-zero exit and appends a `[full output: <path>]` pointer to what the AI actually sees.

**Residual risk**: this depends on the AI agent noticing the pointer and choosing to read that file. An agent that treats "1 passed, 1 failed" as the complete story would miss the detail. This project does not use Go, so `go-test.yaml` itself is low-exposure here — but the same `aggregate` pattern could exist in other built-ins this review did not individually audit (auditing all 132 was out of scope for this task; the 16 that shipped with inline `tests:` blocks were spot-checked via `snip verify`, all 37/37 passing, but that only checks the built-in's own self-declared test cases, not an exhaustive discard-on-failure audit).

**Recommendation**: add a standing instruction (CLAUDE.md or team convention) that any Claude Code session seeing a `[full output: ...]` pointer after a failing command should read that file before concluding what happened — this closes the residual gap without needing to touch snip's own source.

## 2. This project's own custom filters — LOW, by design

`bun-install.yaml`, `bun-test.yaml`, `bunx.yaml`, `bun-x.yaml`, and `vercel.yaml` were all deliberately built as deny-list-only (or, for `bun-install`, a narrow, real-sample-grounded allow-list matching the built-in `npm-install.yaml`'s own precedent) — none use `aggregate`, none risk silently discarding an error class the filter's author didn't anticipate. Verified live against real failure samples (Verification Report §5c).

## 3. `vercel.yaml` was not validated against real deploy/build output — LOW-MEDIUM, disclosed

No Vercel credentials are configured for the `rajat` shell account, so this filter could only be tested against the CLI's version banner and a real credential-error message — not against actual `vercel deploy`/build-log output, which is where the verbose spinner/progress noise this filter targets would really appear. The pipeline is deliberately conservative (deny-list, generous truncation caps) specifically because of this gap. **Action item, stated plainly in the filter file's own header comment**: re-verify with a real authenticated `vercel deploy` before relying on this for meaningful build-log-scale reduction, and add a live-captured test case at that time.

## 4. Project-local filter auto-discovery is not actually wired in snip v0.22.0 — MEDIUM, operationally real

Confirmed by reading the Go source (Configuration Report §3b): the `.snip/filters/` + `.snip/config.toml` project-local convention exists in the trust-store code but is not connected to the actual filter-loading path used by `run`/`check`/`hook`. **Practical risk**: a developer who clones this repo, runs `snip trust .snip/filters/*.yaml`, and expects filtering to "just work" will find it silently does not — `snip` gives no strong distinguishing signal for "filter file exists and is trusted but its directory isn't in the search path" versus any other no-match case (both just report `no filter`). This is disclosed in detail in the Maintenance Guide with the exact, tested workaround (add the absolute path to the global config). Worth flagging upstream to the snip project as a possible bug/missing-feature report — not done as part of this PR since filing external issues wasn't requested and is a judgment call for the Owner.

## 5. Fail-open design — LOW (this is the tool's own strength, confirmed, not just claimed)

Every filter, built-in and custom, carries `on_error: "passthrough"`. If a filter's own regex/pipeline throws (malformed input, a pattern that doesn't compile against unexpected content, etc.), the real raw output is returned unfiltered rather than dropped or replaced with an error. This is architectural, not filter-specific, so it applies uniformly to the 5 new custom filters as much as to the 132 built-ins.

## 6. Supply-chain / trust-store scope — LOW

Filter YAML is data (regex + template strings), not executable code — there is no code-execution surface in a malicious filter file beyond a maliciously slow/catastrophic regex (ReDoS), which the trust-store gate (SHA-256, path-keyed, requiring an explicit `snip trust` per file per location) is designed to catch by making silent, unreviewed filter changes visible rather than auto-applied. No filter in this PR was sourced from anywhere but this task's own direct authorship, grounded in real captured samples.

## 7. No network calls, confirmed at the binary level — LOW

Consistent with the README's claim and this PR's own installer review: every live test in this task ran with no unexpected outbound network activity attributable to `snip` itself (the only outbound calls observed anywhere in this task were the installer's own GitHub API/release download, `gh`/`vercel`/`bun` themselves, and the deliberate OpenRouter proxy test — none of those are snip making a call on its own initiative).

## Summary table

| Risk | Severity | Status |
|---|---|---|
| Built-in `aggregate` filters can discard failure detail | Medium | Mitigated by tee-on-failure; residual dependence on agent reading the pointer |
| Custom VERIDIAN filters same risk | Low | Designed out (deny-list only, verified live) |
| `vercel.yaml` unvalidated against real deploy output | Low-Medium | Disclosed; re-verify before broad reliance |
| `.snip/filters` project-local auto-discovery not wired | Medium | Documented workaround; each location needs manual global-config entry |
| Fail-open on filter error | Low | Architectural, confirmed |
| Supply-chain via filter YAML | Low | Trust-gated, all filters here self-authored from real samples |
| Unexpected network calls | Low | None observed |
