# snip Installation Report

**Date:** 2026-07-21/22 · **Host:** VERIDIAN-DEV (Hetzner, 167.233.220.35) · **User account:** `rajat` · **Session:** claude-code background task

## What was installed

- **Tool:** [`snip`](https://github.com/edouard-claude/snip) v0.22.0, a Go CLI ("CLI Token Killer") that filters verbose shell/CLI output through declarative YAML pipelines before it reaches an AI coding assistant's context.
- **Binary location:** `/home/rajat/.local/bin/snip` (chosen automatically by the installer because `/usr/local/bin` was not writable by `rajat`).
- **PATH:** `~/.local/bin` was already present in both `~/.bashrc` (lines 120, 138) and `~/.profile` (line 26) before this install — no shell-profile change was needed. Note: a plain `ssh host "cmd"` invocation runs a non-interactive, non-login shell that does **not** source `.bashrc`, so `snip` is not on PATH for one-shot SSH commands (`~/.local/bin/snip` must be referenced by full path in that context) — it *is* on PATH for real interactive/login shells and for any process (like a Claude Code session) that inherits a normal login environment.

## Due diligence performed before running the installer

1. Fetched `install.sh` from `https://raw.githubusercontent.com/edouard-claude/snip/master/install.sh` and read it in full (both via WebFetch and, separately, `curl`+`cat` directly on the server) before piping it to `sh`.
2. Confirmed the script only: detects OS/arch, queries `https://api.github.com/repos/edouard-claude/snip/releases/latest` for the latest tag, downloads `snip_<version>_<os>_<arch>.tar.gz` from `https://github.com/edouard-claude/snip/releases/download/...`, extracts it into a `mktemp -d` scratch dir (cleaned up via `trap ... EXIT`), moves the single `snip` binary to `/usr/local/bin` or `~/.local/bin`, `chmod +x`s it, and runs `--version` to confirm. **No sudo. No other network calls. No other side effects.**
3. Independently confirmed via GitHub: 376 stars, MIT license, Go 99.4%, no telemetry/phone-home mentioned in the README.
4. Confirmed the tool's own tracking is fully local: `~/.local/share/snip/tracking.db` (SQLite) and `~/.local/share/snip/tee/*.log` (raw-output safety copies on failure) — both created only after first real use, both under the user's own home directory.

## Installation steps executed

```
curl -fsSL https://raw.githubusercontent.com/edouard-claude/snip/master/install.sh -o /tmp/snip-install.sh
sha256sum /tmp/snip-install.sh   # recorded: 0c146453a2101acf5bf6e0adb5b5064823cc42f9d6f99e1bf261f61c6b8eb850
cat /tmp/snip-install.sh         # read in full before executing
sh /tmp/snip-install.sh
```

Real output:
```
[snip] detected platform: linux/amd64
[snip] fetching latest release...
[snip] latest version: 0.22.0 (v0.22.0)
[snip] downloading https://github.com/edouard-claude/snip/releases/download/v0.22.0/snip_0.22.0_linux_amd64.tar.gz
[snip] extracting...
[snip] /usr/local/bin is not writable, installing to /home/rajat/.local/bin
[snip] installed snip v0.22.0 to /home/rajat/.local/bin/snip
```

## Verification

```
$ ~/.local/bin/snip --version
snip v0.22.0
```

Confirmed working (not just installed) by running `snip --help`, `snip config`, and real filtered commands (see the Verification Report for full detail).

## Scope note — nothing installed locally

Per this project's own standing directive (`ai-os/STANDING_DIRECTIVE.yaml`, `execution.location: ssh_only`), **nothing was installed on the local Windows laptop.** All installation, configuration, and testing happened exclusively over SSH on VERIDIAN-DEV, for the `rajat` account only.
