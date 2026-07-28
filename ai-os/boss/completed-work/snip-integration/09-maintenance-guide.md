# snip Maintenance Guide — VERIDIAN Filter Library

## One-time setup for a new developer / new worktree (read this first)

Because snip v0.22.0's project-local `.snip/filters` auto-discovery is not yet wired to actual filter loading (Risk Assessment §4, Configuration Report §3b), each new checkout location needs two manual, one-time steps:

```bash
# 1. Trust the filter files at THIS checkout's real absolute path
#    (trust is path-keyed, not just content-keyed -- see Configuration
#    Report §4 -- a fresh clone/worktree needs its own trust run even if
#    the file content is identical to one already trusted elsewhere).
cd /path/to/your/compliance-tracker/checkout
snip trust .snip/filters/*.yaml

# 2. Add this checkout's absolute filter path to your OWN global
#    ~/.config/snip/config.toml (create the file if it doesn't exist):
mkdir -p ~/.config/snip
cat >> ~/.config/snip/config.toml << 'EOF'
[filters]
dir = ["~/.config/snip/filters", "/path/to/your/compliance-tracker/checkout/.snip/filters"]
EOF

# 3. Confirm it worked.
snip check -- bun install    # should print "filter: bun-install", not "no filter"
```

## How to add a new custom filter

1. **Check it isn't already covered.** `snip check -- <the command you want to filter>` — if it already reports a filter name (built-in or custom), you don't need a new one; consider a per-filter `[filters.override]` entry in `config.toml` instead if you just want to tune an existing filter's truncation limits.
2. **Capture real samples first, always.** Run the real command (success case, and at least one realistic failure case) and save the raw output. Every filter in this library was written from real, captured output on this exact server, never from documentation or memory of what a tool "usually" prints — do the same for anything new.
3. **Pick the safe pipeline shape for the content class:**
   - **Well-bounded, well-understood summary output** (install/build summaries with a small number of known line shapes): an **allow-list** (`keep_lines`) is fine, following `bun-install.yaml`/the built-in `npm-install.yaml` as templates.
   - **Anything where a failure could contain unpredictable content** (test output, compiler errors, security/auth warnings, stack traces): use a **deny-list** (`remove_lines` targeting only the specific, narrowly-anchored noise pattern you've confirmed is safe to drop) and **never** use snip's `aggregate` pipeline action for these — see Risk Assessment §1 for the concrete reason (the built-in `go-test.yaml` collapses failure detail to a bare count).
   - Always end with `on_error: "passthrough"`.
4. **Write real `tests:` entries** using your captured samples as `input`/`expected` pairs (see any file in `.snip/filters/` for the format) — even though `snip verify` in this version only self-checks the 132 embedded built-ins (confirmed, see Configuration Report), these test blocks are still the project's own regression record and the clearest documentation of intended behavior for the next person.
5. **Place the file** at `.snip/filters/<name>.yaml` in this repo.
6. **Trust and verify** at your own checkout path (see setup steps above), then confirm with `snip check` and a real `snip run` against both a passing and a failing real sample.
7. **Commit it** — plain YAML, reviewed like any other PR change, `audit-check`-gated like everything else in this repo.

## Filters NOT built, and why (don't rebuild these without new evidence)

- **Redis / `redis-cli`** — this codebase deliberately does not use Redis (see `src/lib/services/asset-registry-cache.ts`'s own header). Do not add a filter for it unless that architectural decision changes.
- **`supabase` CLI** — this project's real migration workflow is `drizzle-kit`, not the Supabase CLI (zero real invocations of `supabase db push`/etc. anywhere in the repo). Do not add a filter for it unless the project's actual DB-tooling workflow changes.
- **`preflight-guard.py` / `run-logged.sh`** — never invoked from inside a running Claude Code session (they're launcher/cron-level tooling, not something the AI's own Bash tool calls) — a filter for either would never fire regardless of how well-written it is.
- **Mother Router / AI Dev Team dispatch (`mother-router.ts` and children)** — no shell/subprocess surface exists here at all (confirmed via `grep` for `child_process`/`spawn`/`exec`, zero matches). This is not a "not yet built" gap; it is structurally not applicable to snip's mechanism. See Architecture Report §2.

## Candidates worth revisiting later, with what evidence would justify it

- **`vercel.yaml`** — currently validated only against the version banner and a credential error (no Vercel credentials on this box). Re-test against a real authenticated `vercel deploy`/`vercel build` and add a live-captured test case before treating this as validated for build-log-scale reduction.
- **`bun run build`** (Next.js production build output) — not built in this pass (time-boxed out; a full production build is slow and wasn't run). If build-log verbosity becomes a real pain point, capture a real `bun run build` sample first, same discipline as everything else here.
- **`gh api` / `gh workflow`** — the built-in `gh-pr`/`gh-run`/`gh-issue` filters cover the commands this task's brief specifically named; `gh api` calls were found in only 2 scripts repo-wide (not a dominant usage pattern here), so this was deprioritized, not rejected. Revisit if real usage grows.

## Version history of this filter library

| Filter | Version | Last changed | Why |
|---|---|---|---|
| `bun-install.yaml` | 1 | 2026-07-21 | Initial build |
| `bun-test.yaml` | 1 | 2026-07-21 | Initial build |
| `bunx.yaml` | 1 | 2026-07-21 | Initial build |
| `bun-x.yaml` | 1 | 2026-07-21 | Initial build |
| `vercel.yaml` | 1 | 2026-07-21 | Initial build; needs re-validation against real deploy output (see above) |

Bump the `version:` field in a filter's own YAML whenever its pipeline changes meaningfully, and add a row here — mirrors this repo's existing convention of dated, reasoned changelogs rather than silent edits (e.g. `MASTER-TRACKER.yaml`, `ai-os/boss/COMPLETED.yaml`).
