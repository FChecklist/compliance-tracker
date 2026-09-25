#!/usr/bin/env bash
# BR-120 (PROJEXA-BUILD-001, phase 1): planted-secret self-test. Proves the secret scan rejects a planted fake key and
# accepts a clean commit, so a green scan means something.
#
# Two modes.
#   local (default, the register row)  Runs gitleaks with the repo's own .gitleaks.toml inside a throwaway git repository in a
#       temp folder: commit 1 is a clean file and must be accepted; commit 2 adds a fake AWS access key built at run time
#       and must be rejected. Nothing leaves the machine; nothing in this repository is touched.
#       Exit 0 prints:  SECRET_SCAN_SELFTEST_OK planted=rejected clean=accepted
#   pr (opt-in: --mode pr --yes)  Proves the real CI job. Creates a throwaway branch from origin/<base> holding ONE file with a
#       documented fake key, pushes it, opens a DRAFT pull request against <base>, waits for the check run named
#       "Secret Scanning" (job secret-scan in .github/workflows/sentinel.yml) to finish, requires its conclusion to be
#       `failure`, then closes the pull request and deletes the branch. It writes to GitHub, starts every workflow that runs on
#       pull requests, and takes minutes. Exit 0 prints:  SECRET_SCAN_SELFTEST_OK planted=rejected mode=pr
#
# --dry-run checks prerequisites only and starts nothing. local: gitleaks and the config file exist. pr: gh has a login token,
# git exists, and .github/workflows/sentinel.yml has a job secret-scan named Secret Scanning. Exit 0 prints:
#   SECRET_SCAN_SELFTEST_PREREQS_OK mode=<mode>
#
# Exit 1 = the scan behaved wrongly (planted key accepted, clean commit rejected, check run concluded with anything but
# failure, or the workflow lacks the job). Exit 2 = usage error or a prerequisite is missing (gitleaks, gh, login, config).
# The last stderr line is `PASS BR-120` or `FAIL BR-120: <reason>`.
#
# The fake key is `AKIA` plus 16 upper-case letters. It is not a real credential and belongs to no account. Its text is
# assembled from pieces at run time so that this script contains no token a scanner would flag.
#
# Usage: bash scripts/verify/secret-scan-selftest.sh [--mode local|pr] [--dry-run] [--yes]
# Environment: GITLEAKS_BIN (default: gitleaks from PATH), GITLEAKS_CONFIG (default: .gitleaks.toml in the repo root),
#   WORKFLOW_FILE (default: .github/workflows/sentinel.yml), SELFTEST_BASE (pr mode base branch, default main),
#   SELFTEST_TIMEOUT_S (pr mode wait, default 1200), SELFTEST_POLL_S (default 20).
set -u

ID="BR-120"
ROOT="$(cd "$(dirname "${BASH_SOURCE[0]}")/../.." && pwd)"
GITLEAKS_CONFIG="${GITLEAKS_CONFIG:-$ROOT/.gitleaks.toml}"
WORKFLOW_FILE="${WORKFLOW_FILE:-$ROOT/.github/workflows/sentinel.yml}"
BASE="${SELFTEST_BASE:-main}"
TIMEOUT_S="${SELFTEST_TIMEOUT_S:-1200}"
POLL_S="${SELFTEST_POLL_S:-20}"

TMP=""
PR_NUMBER=""
BRANCH=""
PUSHED=0
WT=""

remove_tmp() {
  if [ -n "$PR_NUMBER" ]; then
    gh pr close "$PR_NUMBER" --delete-branch >/dev/null 2>&1
    PUSHED=0
  fi
  if [ "$PUSHED" = "1" ] && [ -n "$BRANCH" ]; then
    git -C "$ROOT" push origin --delete "$BRANCH" >/dev/null 2>&1
  fi
  if [ -n "$WT" ]; then
    git -C "$ROOT" worktree remove --force "$WT" >/dev/null 2>&1
  fi
  if [ -n "$TMP" ]; then rm -rf "$TMP"; fi
}
trap remove_tmp EXIT

finish_ok()    { printf '%s\n' "$1"; printf 'PASS %s\n' "$ID" >&2; exit 0; }
finish_fail()  { printf 'FAIL %s: %s\n' "$ID" "$1" >&2; exit 1; }
finish_usage() { printf 'FAIL %s: %s\n' "$ID" "$1" >&2; exit 2; }

PY=""
for c in python python3; do
  if "$c" -c 'import sys' >/dev/null 2>&1; then PY="$c"; break; fi
done
[ -n "$PY" ] || finish_usage "python is not available on PATH"
winpath() { if command -v cygpath >/dev/null 2>&1; then cygpath -m "$1"; else printf '%s' "$1"; fi; }

MODE="local"
DRY=0
YES=0
while [ $# -gt 0 ]; do
  case "$1" in
    --mode)    [ $# -ge 2 ] || finish_usage "--mode needs local or pr"; MODE="$2"; shift 2 ;;
    --dry-run) DRY=1; shift ;;
    --yes)     YES=1; shift ;;
    *) finish_usage "unknown argument: $1" ;;
  esac
done
case "$MODE" in local|pr) ;; *) finish_usage "--mode must be local or pr" ;; esac
command -v git >/dev/null 2>&1 || finish_usage "git is not installed"

TMP="$(mktemp -d)"

# The fake key: AKIA + 16 letters, assembled at run time from pieces.
FAKE_HEAD="AKI"
FAKE_HEAD="${FAKE_HEAD}A"
FAKE_TAIL="QYPR""TXZJ""WMBH""VKNC"
FAKE_KEY="${FAKE_HEAD}${FAKE_TAIL}"

write_planted_file() {   # $1 = path
  {
    printf '%s\n' "FAKE CREDENTIAL FOR A SCANNER SELF-TEST (BR-120, scripts/verify/secret-scan-selftest.sh)."
    printf '%s\n' "The value below is not a real key and belongs to no account. This file is removed when the self-test ends."
    printf 'aws_access_key_id = %s\n' "$FAKE_KEY"
  } > "$1"
}

workflow_has_job() {   # prints OK, NOJOB or NONAME
  cat > "$TMP/job.py" <<'PYEOF'
import re
import sys

text = open(sys.argv[1], encoding="utf-8-sig").read().replace("\r\n", "\n") + "\n"
m = re.search(r"^  secret-scan:[ \t]*\n((?:(?:    .*|[ \t]*)\n)+)", text, re.M)
if not m:
    print("NOJOB")
elif re.search(r"^    name:[ \t]*Secret Scanning[ \t]*$", m.group(1), re.M):
    print("OK")
else:
    print("NONAME")
PYEOF
  "$PY" "$(winpath "$TMP/job.py")" "$(winpath "$WORKFLOW_FILE")" 2>/dev/null
}

# ---------------------------------------------------------------- local mode
GL=""
find_gitleaks() {
  GL="${GITLEAKS_BIN:-}"
  if [ -z "$GL" ] && command -v gitleaks >/dev/null 2>&1; then GL="gitleaks"; fi
  [ -n "$GL" ] || finish_usage "gitleaks was not found (PATH or GITLEAKS_BIN); the CI job secret-scan runs it, or install it to run this locally"
  command -v "$GL" >/dev/null 2>&1 || finish_usage "gitleaks program not found: $GL"
  [ -f "$GITLEAKS_CONFIG" ] || finish_usage "gitleaks config not found: $GITLEAKS_CONFIG"
}

scan_repo() {   # $1 = repository folder. Returns 0 = no leak found, 1 = leak found, 2 = the scanner failed.
  local dir cfg ver major minor rc
  dir="$(winpath "$1")"
  cfg="$(winpath "$GITLEAKS_CONFIG")"
  ver="$("$GL" version 2>/dev/null | tr -d '\r' | head -n 1)"
  major="$(printf '%s' "$ver" | sed -n 's/^v\{0,1\}\([0-9][0-9]*\)\.\([0-9][0-9]*\)\..*/\1/p')"
  minor="$(printf '%s' "$ver" | sed -n 's/^v\{0,1\}\([0-9][0-9]*\)\.\([0-9][0-9]*\)\..*/\2/p')"
  if [ -n "$major" ] && { [ "$major" -gt 8 ] || { [ "$major" -eq 8 ] && [ "$minor" -ge 19 ]; }; }; then
    "$GL" git --no-banner --redact --config "$cfg" --exit-code 1 "$dir" >/dev/null 2>&1
  else
    "$GL" detect --no-banner --redact --config "$cfg" --exit-code 1 --source "$dir" >/dev/null 2>&1
  fi
  rc=$?
  case "$rc" in 0) return 0 ;; 1) return 1 ;; *) return 2 ;; esac
}

run_local() {
  find_gitleaks
  if [ "$DRY" = "1" ]; then finish_ok "SECRET_SCAN_SELFTEST_PREREQS_OK mode=local"; fi
  local W="$TMP/throwaway"
  mkdir -p "$W"
  git -C "$W" init -q || finish_usage "git init failed in the temp folder"
  git -C "$W" config user.email "selftest@example.invalid"
  git -C "$W" config user.name "secret-scan selftest"
  git -C "$W" config commit.gpgsign false
  git -C "$W" config core.autocrlf false
  printf '%s\n' "A clean file for the secret-scan self-test." > "$W/clean.txt"
  git -C "$W" add -A 2>/dev/null && git -C "$W" commit -q -m "clean commit" || finish_usage "git commit failed in the temp folder"

  scan_repo "$W"
  case $? in
    0) : ;;
    1) finish_fail "the clean commit was rejected by the scanner (clean=rejected)" ;;
    *) finish_usage "the scanner failed on the clean commit" ;;
  esac

  write_planted_file "$W/planted.txt"
  git -C "$W" add -A 2>/dev/null && git -C "$W" commit -q -m "planted fake key" || finish_usage "git commit failed in the temp folder"
  scan_repo "$W"
  case $? in
    1) : ;;
    0) finish_fail "the planted fake key was accepted by the scanner (planted=accepted)" ;;
    *) finish_usage "the scanner failed on the planted commit" ;;
  esac
  finish_ok "SECRET_SCAN_SELFTEST_OK planted=rejected clean=accepted"
}

# ------------------------------------------------------------------- pr mode
repo_slug() {
  local url
  url="$(git -C "$ROOT" remote get-url origin 2>/dev/null)"
  printf '%s' "$url" | sed -n 's#^.*github\.com[:/]\([^/]*/[^/]*\)$#\1#p' | sed 's/\.git$//'
}

run_pr() {
  [ -f "$WORKFLOW_FILE" ] || finish_usage "workflow file not found: $WORKFLOW_FILE"
  case "$(workflow_has_job)" in
    OK) : ;;
    NOJOB)  finish_fail "the workflow file has no job named secret-scan" ;;
    NONAME) finish_fail "the secret-scan job is not named Secret Scanning" ;;
    *) finish_usage "could not read the workflow file" ;;
  esac
  command -v gh >/dev/null 2>&1 || finish_usage "gh is not installed"
  gh auth token >/dev/null 2>&1 || finish_usage "gh has no login token (run gh auth login, or set GH_TOKEN)"
  local SLUG
  SLUG="$(repo_slug)"
  [ -n "$SLUG" ] || finish_usage "could not read the GitHub repository from the origin remote"
  if [ "$DRY" = "1" ]; then finish_ok "SECRET_SCAN_SELFTEST_PREREQS_OK mode=pr"; fi
  [ "$YES" = "1" ] || finish_usage "pr mode writes to GitHub (a branch and a draft pull request); add --yes to run it, or --dry-run to check prerequisites"

  BRANCH="selftest/secret-scan-$(date -u +%Y%m%d%H%M%S)-$$"
  WT="$TMP/wt"
  git -C "$ROOT" fetch origin "$BASE" --quiet 2>/dev/null || finish_usage "git fetch origin $BASE failed"
  git -C "$ROOT" worktree add --detach "$WT" "origin/$BASE" >/dev/null 2>&1 || finish_usage "git worktree add failed"
  git -C "$WT" checkout -q -b "$BRANCH" || finish_usage "could not create the throwaway branch"
  mkdir -p "$WT/verify-selftest"
  write_planted_file "$WT/verify-selftest/planted-fake-secret.txt"
  git -C "$WT" add verify-selftest/planted-fake-secret.txt
  git -C "$WT" -c user.email="selftest@example.invalid" -c user.name="secret-scan selftest" -c commit.gpgsign=false \
    commit -q -m "selftest: planted fake key (BR-120), do not merge" || finish_usage "git commit failed"
  local SHA
  SHA="$(git -C "$WT" rev-parse HEAD)"
  git -C "$WT" push -q origin "$BRANCH" 2>/dev/null || finish_usage "git push failed"
  PUSHED=1

  local URL
  URL="$(gh pr create --draft --base "$BASE" --head "$BRANCH" \
    --title "selftest: planted fake key, do not merge (BR-120)" \
    --body "Throwaway pull request opened by scripts/verify/secret-scan-selftest.sh. It holds one file with a fake key so the Secret Scanning job can be seen to fail. The script closes this pull request and deletes the branch when it ends." 2>/dev/null)"
  PR_NUMBER="$(printf '%s' "$URL" | sed -n 's#.*/pull/\([0-9][0-9]*\).*#\1#p')"
  [ -n "$PR_NUMBER" ] || finish_usage "gh pr create did not return a pull request number"

  local waited=0 STATE=""
  while [ "$waited" -lt "$TIMEOUT_S" ]; do
    STATE="$(gh api "repos/$SLUG/commits/$SHA/check-runs?per_page=100" \
      --jq '[.check_runs[] | select(.name == "Secret Scanning")] | if length == 0 then "none" else (.[0].status + " " + (.[0].conclusion // "none")) end' 2>/dev/null)"
    case "$STATE" in
      "completed "*) break ;;
    esac
    sleep "$POLL_S"
    waited=$((waited + POLL_S))
  done
  case "$STATE" in
    "completed failure") finish_ok "SECRET_SCAN_SELFTEST_OK planted=rejected mode=pr" ;;
    "completed "*)       finish_fail "the Secret Scanning check run concluded with '${STATE#completed }', expected failure (planted key accepted)" ;;
    *)                   finish_usage "the Secret Scanning check run did not finish within ${TIMEOUT_S}s (last state: ${STATE:-unknown})" ;;
  esac
}

if [ "$MODE" = "local" ]; then run_local; else run_pr; fi
