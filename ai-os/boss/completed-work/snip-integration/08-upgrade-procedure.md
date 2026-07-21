# snip Upgrade Procedure

snip has no self-update command (confirmed: no `update`/`upgrade`/`self-update` subcommand in `snip --help`'s full command list). Upgrading means re-running the installer, which is safe to do repeatedly (the installer always fetches whatever GitHub currently reports as `releases/latest` and overwrites the existing binary at the same path).

## Standard upgrade

```bash
# 1. Check current version.
snip --version

# 2. Re-run the installer (same due-diligence read as first install --
#    re-read install.sh if a meaningful amount of time has passed, since
#    this re-fetches from GitHub and the script itself could have changed).
curl -fsSL https://raw.githubusercontent.com/edouard-claude/snip/master/install.sh -o /tmp/snip-install.sh
sha256sum /tmp/snip-install.sh    # compare against the last-known-good hash if re-upgrading soon after a prior install
cat /tmp/snip-install.sh          # read before executing, every time
sh /tmp/snip-install.sh

# 3. Confirm the new version.
snip --version
```

## What survives an upgrade untouched

- The Claude Code hook registration (`~/.claude/settings.json`) — points at the binary path, which the installer overwrites in place; no hook re-registration needed.
- `~/.config/snip/config.toml` (the `filters.dir` entry pointing at this project's `.snip/filters/`) — untouched by the installer.
- `~/.config/snip/trusted.json` (the trust store) — untouched.
- `~/.local/share/snip/tracking.db` and `tee/` logs — untouched.
- This repo's `.snip/filters/*.yaml` custom filter files — untouched (they live in the git repo, not in anything the installer manages).

## After upgrading, re-check for behavior changes

Filter format/behavior is versioned per-filter (each YAML has its own `version:` field), but a snip binary upgrade could still change pipeline-action semantics or add new built-in filters that now shadow/duplicate one of this project's custom ones. After any upgrade:

```bash
cd /opt/veridian/repos/compliance-tracker
snip check -- bun install     # confirm still "filter: bun-install", not suddenly "no filter" or a new built-in name
snip check -- bun test
snip check -- bunx tsc --noEmit
snip check -- bun x tsc
snip check -- vercel ls
snip verify                   # confirm the 132(+N) built-in self-tests still pass
```

If a new built-in filter appears that duplicates one of this project's custom ones (e.g. a future snip release ships its own `bun-install.yaml`), retire the custom one in the same PR that bumps the documented version here, rather than leaving two filters silently competing (the built-in and a same-named custom filter cannot coexist under the same name in one registry — check `snip check`'s reported filter name after upgrading to catch this).

## Rollback if an upgrade misbehaves

```bash
# The installer does not keep old binaries by default. If you need to pin
# an older version, download it explicitly instead of using install.sh's
# "latest" resolution:
curl -fsSL -o /tmp/snip.tar.gz \
  https://github.com/edouard-claude/snip/releases/download/v0.22.0/snip_0.22.0_linux_amd64.tar.gz
tar xzf /tmp/snip.tar.gz -C /tmp
mv /tmp/snip ~/.local/bin/snip
chmod +x ~/.local/bin/snip
snip --version   # confirm pinned back to v0.22.0
```
