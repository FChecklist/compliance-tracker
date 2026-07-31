"""Shared helpers for scripts/verify-task-<type>.py.

Built for task-20260731-073931-deterministic-per-task-type-verification:
a deterministic, per-task-type mechanical check sequence that
postflight_audit_gate.py's --audit-cmd can reference verbatim (per
STANDING_DIRECTIVE.yaml's verification_command_predefinition_rule) instead of
a bespoke command authored fresh per task.

Each verify-task-<type>.py script:
  1. resolves a target (a PR number, merged or open, or a plain git ref/branch/sha)
     to a real commit + its diff base,
  2. checks that commit out into an isolated, disposable `git worktree` (so this
     never mutates the caller's own checkout or collides with another
     session's in-flight worktree -- see ai-os/boss/ACTIVE-CLAIMS.yaml and
     [[fchecklist_worktree_isolation_required]]),
  3. runs a real, task-type-specific check sequence in that worktree,
  4. prints one structured JSON result and exits 0 only if every real check
     in the sequence passed.

Honest limitation, same class as this repo's other CI guard scripts (see
scripts/check-terminology-guardrail.mjs's own header): `bunx tsc --noEmit` on
this codebase takes several minutes on a lightly-loaded host and can OOM
outright under this session's real concurrent multi-worker load (verified
empirically 2026-07-31 -- see PROGRESS.md). That means a script here, run
standalone, is the real thing this task's SUCCESS_CRITERIA asks for, but
wiring it into postflight_audit_gate.py's existing fixed 120s subprocess
timeout as-is would need that constant raised first -- not done here, that
gate is shared, load-bearing infrastructure and out of this task's scope.
"""
import json
import os
import shutil
import subprocess
import tempfile
import time

# Some environments (this shared host included) don't have ~/.bun/bin on
# PATH for non-interactive shells even though bun is installed there.
_BUN_BIN = os.path.expanduser("~/.bun/bin")
if _BUN_BIN not in os.environ.get("PATH", "").split(os.pathsep):
    os.environ["PATH"] = _BUN_BIN + os.pathsep + os.environ.get("PATH", "")


def get_repo_root():
    return subprocess.run(
        ["git", "rev-parse", "--show-toplevel"], capture_output=True, text=True, check=True
    ).stdout.strip()


def _rev_parse(repo_root, ref):
    return subprocess.run(
        ["git", "rev-parse", ref], cwd=repo_root, capture_output=True, text=True, check=True
    ).stdout.strip()


def resolve_target(repo_root, target):
    """target is either a bare PR number (e.g. "658") or a git ref/branch/sha
    (e.g. a deliberately-broken temp branch for the negative test case)."""
    if target.isdigit():
        raw = subprocess.run(
            ["gh", "pr", "view", target, "--json",
             "number,state,mergeCommit,baseRefName,headRefOid"],
            cwd=repo_root, capture_output=True, text=True,
        )
        if raw.returncode != 0:
            raise RuntimeError(f"gh pr view {target} failed: {raw.stderr.strip()}")
        data = json.loads(raw.stdout)
        merge_commit = (data.get("mergeCommit") or {}).get("oid")
        if merge_commit:
            subprocess.run(["git", "fetch", "origin", merge_commit], cwd=repo_root,
                            capture_output=True, text=True)
            commit = merge_commit
            base = _rev_parse(repo_root, f"{commit}^1")
            description = f"PR #{target} (merged, merge_commit={commit[:8]})"
        else:
            head = data["headRefOid"]
            base_ref = data.get("baseRefName", "main")
            subprocess.run(["git", "fetch", "origin", head, base_ref], cwd=repo_root,
                            capture_output=True, text=True)
            commit = _rev_parse(repo_root, head)
            base = subprocess.run(
                ["git", "merge-base", commit, f"origin/{base_ref}"],
                cwd=repo_root, capture_output=True, text=True, check=True,
            ).stdout.strip()
            description = f"PR #{target} (state={data.get('state')}, head={commit[:8]})"
    else:
        commit = _rev_parse(repo_root, target)
        base = subprocess.run(
            ["git", "merge-base", commit, "main"],
            cwd=repo_root, capture_output=True, text=True, check=True,
        ).stdout.strip()
        description = f"ref '{target}' (commit={commit[:8]})"
    return {"commit": commit, "base": base, "description": description}


def changed_files(repo_root, base, commit):
    out = subprocess.run(
        ["git", "diff", "--name-only", "--diff-filter=ACMR", base, commit],
        cwd=repo_root, capture_output=True, text=True, check=True,
    ).stdout
    return [line for line in out.splitlines() if line]


def make_worktree(repo_root, commit):
    tmp = tempfile.mkdtemp(prefix="verify-task-")
    os.rmdir(tmp)  # git worktree add requires the path not exist yet
    subprocess.run(
        ["git", "worktree", "add", "--detach", tmp, commit],
        cwd=repo_root, capture_output=True, text=True, check=True,
    )
    return tmp


def remove_worktree(repo_root, path):
    subprocess.run(["git", "worktree", "remove", "--force", path],
                    cwd=repo_root, capture_output=True, text=True)
    shutil.rmtree(path, ignore_errors=True)


def prepare_node_modules(repo_root, worktree, base, commit):
    """Symlinks the caller's own node_modules into the disposable worktree
    when the diff doesn't touch package.json/bun.lock (the overwhelming
    majority of this session's task types -- see PROGRESS.md's PR survey),
    which turns what would otherwise be a multi-minute `bun install` into a
    zero-cost reuse. Falls back to a real `bun install` when dependencies
    actually changed, since a symlinked stale node_modules would silently
    hide a real dependency-drift bug in that case."""
    files = changed_files(repo_root, base, commit)
    deps_changed = any(f in ("package.json", "bun.lock") for f in files)
    main_nm = os.path.join(repo_root, "node_modules")
    if not deps_changed and os.path.isdir(main_nm):
        os.symlink(main_nm, os.path.join(worktree, "node_modules"))
        return {"strategy": "symlinked-from-caller-checkout", "deps_changed": False}
    result = subprocess.run(["bun", "install"], cwd=worktree, capture_output=True,
                             text=True, timeout=600)
    return {"strategy": "bun-install", "deps_changed": deps_changed,
            "exit_code": result.returncode}


def run_check(name, cmd, cwd, timeout):
    t0 = time.time()
    try:
        result = subprocess.run(cmd, cwd=cwd, capture_output=True, text=True, timeout=timeout)
        return {
            "name": name,
            "cmd": cmd if isinstance(cmd, str) else " ".join(cmd),
            "exit_code": result.returncode,
            "ok": result.returncode == 0,
            "duration_s": round(time.time() - t0, 1),
            "stdout_tail": result.stdout[-1500:],
            "stderr_tail": result.stderr[-1500:],
        }
    except subprocess.TimeoutExpired:
        return {
            "name": name,
            "cmd": cmd if isinstance(cmd, str) else " ".join(cmd),
            "exit_code": None,
            "ok": False,
            "duration_s": round(time.time() - t0, 1),
            "stdout_tail": "",
            "stderr_tail": f"TIMEOUT after {timeout}s",
        }


def skipped_check(name, reason):
    """A check that legitimately does not apply to this diff (e.g. no
    migration file touched). Recorded as ok=True but with cmd=None so it is
    never confused with a check that actually ran -- see each script's
    `checks` output."""
    return {"name": name, "cmd": None, "exit_code": None, "ok": True,
            "duration_s": 0, "stdout_tail": reason, "stderr_tail": ""}


def failed_without_running(name, reason):
    """A check the sequence expected to be able to run (e.g. a changed
    service test file) but couldn't -- counted as a real failure, not a
    silent skip."""
    return {"name": name, "cmd": None, "exit_code": None, "ok": False,
            "duration_s": 0, "stdout_tail": "", "stderr_tail": reason}
