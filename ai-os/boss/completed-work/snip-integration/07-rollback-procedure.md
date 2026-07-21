# snip Rollback / Uninstall Procedure

All commands below run on VERIDIAN-DEV as the `rajat` user. Each step is independently reversible; you do not need to do all of them to disable snip — see "Partial rollback" options at the end.

## Full uninstall (removes the hook, the binary, and all local data)

```bash
# 1. Remove the Claude Code hook registration (safe: snip init --uninstall
#    only removes the PreToolUse entry it added; confirmed by reading
#    ~/.claude/settings.json before/after in this PR's own testing).
~/.local/bin/snip init --uninstall

# 2. Confirm the hook is gone.
cat ~/.claude/settings.json   # should no longer contain "snip hook"

# 3. Remove the binary.
rm -f ~/.local/bin/snip

# 4. Remove local config/trust/tracking data (optional -- purely local,
#    no effect on the repo or any other machine).
rm -rf ~/.config/snip ~/.local/share/snip
```

After step 1 alone, Claude Code stops invoking snip entirely — every shell command reverts to raw, unfiltered output immediately, for both interactive and headless sessions, with zero further action needed.

## Partial rollback options

- **Disable just the custom VERIDIAN filters, keep the 132 built-ins**: remove the project's absolute path from `~/.config/snip/config.toml`'s `filters.dir` array (see Configuration Report §5), or simply `snip untrust .snip/filters/*.yaml` in the repo checkout — untrusted project-local filters are skipped with a warning, not loaded.
- **Disable a single filter** (built-in or custom) without touching anything else: `snip config` shows `filters.enable` — set `<filter-name> = false` for that one filter under `[filters.enable]` in `~/.config/snip/config.toml`.
- **Bypass snip for specific commands** without uninstalling: `[filters.bypass] commands = ["some-command"]` in `~/.config/snip/config.toml` (merges across user+project config per `internal/config/config.go`).
- **Temporarily see raw output for one command**: `snip proxy -- <command>` runs the command with no filtering at all, one-off.

## What rollback does NOT affect

- The 5 custom filter YAML files committed to this repo (`.snip/filters/*.yaml`) are just data files; removing the hook or the binary does not require removing them from version control. They are inert without the hook/binary present.
- `ai-os/MASTER_INDEX.yaml`/`system_index` registration entries added by this PR are documentation, not live wiring — no rollback action needed there beyond a normal doc revert if the Owner wants the integration's existence un-recorded.
- No schema, no database migration, no application source code was touched by this integration — rollback has zero blast radius beyond the `rajat` account's own shell environment on VERIDIAN-DEV.

## Verifying rollback worked

```bash
which snip                     # should report "not found" (if binary removed)
cat ~/.claude/settings.json    # should not mention snip (if hook removed)
gh pr checks <any-pr> --repo FChecklist/compliance-tracker   # should show real, unfiltered-length output again
```
