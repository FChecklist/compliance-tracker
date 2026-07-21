# snip Configuration Report

## 1. Claude Code hook registration

`snip init` (default agent: `claude-code`) was run once for the `rajat` account:

```
$ ~/.local/bin/snip init
snip init complete:
  agent: claude-code
  hook: /home/rajat/.local/bin/snip hook
  filters: /home/rajat/.config/snip/filters
  settings: /home/rajat/.claude/settings.json
```

The resulting file was read directly (not assumed from the success message) to confirm:

```json
// /home/rajat/.claude/settings.json
{
  "hooks": {
    "PreToolUse": [
      {
        "hooks": [{ "command": "/home/rajat/.local/bin/snip hook", "type": "command" }],
        "matcher": "Bash"
      }
    ]
  }
}
```

**Before this run, `~/.claude/settings.json` did not exist at all** (confirmed by a `cat` that returned "No such file or directory" prior to `snip init`) — a clean baseline, not an overwrite of pre-existing hooks.

**Scope: this is Claude Code's global, per-user settings file**, not a project-local `.claude/settings.json`. Claude Code's settings resolution order is enterprise policy > CLI args > project-local `.claude/settings.local.json` > project `.claude/settings.json` > user `~/.claude/settings.json`. Since `snip init` wrote only to the user-level file and no project-level override exists in any project this account touches, the hook applies **globally, to every project directory the `rajat` account works in** — confirmed empirically for both interactive use and headless `claude -p` (see Verification Report).

## 2. Built-in filter coverage (confirmed via `snip check`, not assumed from docs)

Exactly **132 built-in filters** ship compiled into the binary (Go `embed`, not extracted to disk — `~/.config/snip/filters/` does not exist until a user places their own files there). Confirmed present: `git`, `gh` (pr/run/issue — but not `gh api`/`gh workflow`), `npm`, `pnpm`, `docker`, `kubectl`, `psql`, `cargo`, `go test`, `eslint`, `terraform`, `aws`, `curl`, `tsc`, `npx`, and 117 others.

Confirmed **absent** (real gaps on this server): `bun` (install/test/x), `bunx`, `vercel`. Confirmed **correctly absent because genuinely unused** (see Architecture Report §3c): `redis-cli`, `supabase` CLI.

## 3. Custom VERIDIAN filter library — where it lives and how it actually activates

### 3a. File location: `.snip/filters/` (the tool's own documented convention)

Custom filter YAML files were committed to this repo at `.snip/filters/*.yaml` — confirmed via the snip source (`internal/cli/cli.go`, `internal/trust/trust_test.go`) to be the tool's own real, intended convention for project-local filters relative to a project's root, and the default target of `snip trust`/`snip untrust` when run with no explicit path.

Files added:
- `.snip/filters/bun-install.yaml` — `bun install`/`i`/`add`/`remove`/`rm`/`update`/`up`
- `.snip/filters/bun-test.yaml` — `bun test`
- `.snip/filters/bunx.yaml` — `bunx <anything>`
- `.snip/filters/bun-x.yaml` — `bun x <anything>` (bun's own alias form; a distinct argv shape from `bunx`, confirmed via `snip check` that the built-in/other custom filters do not fire for it without its own entry)
- `.snip/filters/vercel.yaml` — `vercel <anything>`

### 3b. IMPORTANT, VERIFIED GAP: `.snip/filters/` + `.snip/config.toml` project-local auto-discovery does not actually activate filters in snip v0.22.0

This was not assumed — it was discovered by direct testing and confirmed by reading the Go source:

1. Placed the 5 filter files at `.snip/filters/*.yaml` and ran `snip trust .snip/filters/*.yaml` — succeeded, hashes recorded in `~/.config/snip/trusted.json`.
2. `snip check -- bun install` still returned `no filter`.
3. Created `.snip/config.toml` (`mode = "project"`, `[filters] dir = ".snip/filters"`) and trusted it too — still `no filter`.
4. Read `internal/config/config.go` and `internal/cli/cli.go` directly from the snip source. Finding: the actual `run`/`check`/`hook` command handlers all call `config.Load()`, which reads **only** the global `~/.config/snip/config.toml`. The project-local-config lookup (`projectConfigPath()`, walking up from cwd for `.snip/config.toml`) is implemented in a separate function, `config.LoadMerged()` — but that function is **not called anywhere in the actual command-execution path** for `run`/`check`/`hook` in this version. The trust-store plumbing for project configs exists and works (that part of the trust gate is real, tested code, per `internal/trust/trust_test.go`), but it is not yet wired to filter loading.
5. **The actually-working mechanism**, verified live: add the project's absolute filter path to the **global** `~/.config/snip/config.toml`:
   ```toml
   [filters]
   dir = ["~/.config/snip/filters", "/opt/veridian/repos/compliance-tracker/.snip/filters"]
   ```
   After this, `snip check -- bun install` → `filter: bun-install`, and all 5 custom filters matched correctly (`bun test` → `bun-test`, `bunx tsc --noEmit` → `bunx`, `bun x tsc` → `bun-x`, `vercel ls` → `vercel`).

**Practical consequence, documented in the Maintenance Guide**: cloning/pulling this repo does **not**, by itself, activate the custom filter library for a new developer or a new worktree. Each person/location must add the repo's `.snip/filters` absolute path to their own `~/.config/snip/config.toml` once. This is a real, current limitation of snip v0.22.0's project-config wiring, not a limitation introduced by how this PR placed the files — the files are in the tool's own documented convention location; the tool's own auto-discovery of that location is what is not yet functional for the commands that matter.

## 4. Trust is keyed by absolute path + hash, not content alone

`internal/trust/trust.go`: the trust store (`~/.config/snip/trusted.json`) maps **absolute file paths** to SHA-256 hashes. Trusting a filter at `/opt/veridian/workspace/snip-integration/.snip/filters/bun-install.yaml` does **not** carry over to the same file content at a different absolute path (e.g. `/opt/veridian/repos/compliance-tracker/.snip/filters/bun-install.yaml` after this PR merges, or any other worktree/clone). Each real checkout location needs its own `snip trust` run once. See the Maintenance Guide for the exact commands to run against the persistent `/opt/veridian/repos/compliance-tracker` checkout after merge.

## 5. Full applied global config (`~/.config/snip/config.toml`, VERIDIAN-DEV, `rajat` account)

```toml
[filters]
dir = ["~/.config/snip/filters", "/opt/veridian/repos/compliance-tracker/.snip/filters"]
```

(Path updated post-merge to point at the real persistent checkout rather than the throwaway worktree used during development — see Verification Report for the exact sequence.)
