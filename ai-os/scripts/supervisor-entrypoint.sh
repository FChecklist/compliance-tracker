#!/bin/bash
# VERIDIAN-DEV server-side Superboss: reviews a task's branch for real (not a
# self-report), classifies risk tier deterministically, and either merges
# autonomously (tier1 + approved), holds for human sign-off (tier2 + approved),
# or leaves it blocked with review comments (rejected). Uses GitHub PRs for the
# actual merge (not local git merge) to avoid any conflict with the main repo
# clone's own periodic sync-repos.sh pulls.
set -uo pipefail
TASK_ID="$1"
TASK_DIR="/opt/veridian/ai-os/tasks/$TASK_ID"
export PATH="$HOME/.local/bin:$HOME/.local/share/supabase:/usr/bin:$PATH"

# 2026-07-19 (Owner directive, following COST-INCIDENT-11K-CALLS-RCA): same
# GLM-5.2-via-OpenRouter routing as worker-entrypoint.sh, fail-closed (no
# fallback to real Anthropic auth). See that script's own header for the
# full rationale.
unset CLAUDE_CODE_OAUTH_TOKEN
export ANTHROPIC_BASE_URL="http://127.0.0.1:8787"
export ANTHROPIC_API_KEY="proxy-routed-not-a-real-anthropic-key"
SUPERVISOR_BUDGET_CAP_USD="${VERIDIAN_SUPERVISOR_BUDGET_CAP_USD:-10}"

if [ -f "$TASK_DIR/review.json" ]; then
  echo "Already reviewed, skipping (idempotency guard)."
  exit 0
fi

# --- Pre-flight guard (2026-07-20, constitution-audit gap #7): confirmed
# ZERO protection existed here before this -- no circuit breaker, no static
# checks. Reuses the exact same guard as worker-entrypoint.sh (real GLM
# proxy, not --no-proxy, since this script uses the same proxy). The
# tight-task-schema check inside it gracefully no-ops when $TASK_DIR/
# prompt.txt doesn't exist (a review task has no fresh task prompt to
# validate) -- safe to call unconditionally.
GUARD_OUT=$(python3 /opt/veridian/scripts/preflight-guard.py "$TASK_DIR" "$TASK_DIR" "http://127.0.0.1:8787" 2>&1)
GUARD_EXIT=$?
if [ "$GUARD_EXIT" -ne 0 ]; then
  GUARD_REASON=$(echo "$GUARD_OUT" | python3 -c "import json,sys; print(json.load(sys.stdin).get('reason','unknown'))" 2>/dev/null || echo "unknown")
  GUARD_DETAIL=$(echo "$GUARD_OUT" | python3 -c "import json,sys; print(json.load(sys.stdin).get('detail',''))" 2>/dev/null || echo "$GUARD_OUT")
  python3 /opt/veridian/scripts/veridian-task.py checkpoint "$TASK_ID" --status blocked --note "SUPERVISOR PRE-FLIGHT REJECTED ($GUARD_REASON): $GUARD_DETAIL"
  exit 1
fi

WORKSPACE=$(python3 -c "import yaml; print(yaml.safe_load(open('$TASK_DIR/task.yaml'))['workspace'])")
BRANCH=$(python3 -c "import yaml; print(yaml.safe_load(open('$TASK_DIR/task.yaml'))['branch'])")
REPO=$(python3 -c "import yaml; print(yaml.safe_load(open('$TASK_DIR/task.yaml'))['repo'])")
TITLE=$(python3 -c "import yaml; print(yaml.safe_load(open('$TASK_DIR/task.yaml'))['title'])")

cd "$WORKSPACE"
git fetch origin
DEFAULT_BRANCH=$(git symbolic-ref refs/remotes/origin/HEAD | sed 's@^refs/remotes/origin/@@')

TIER=$(python3 /opt/veridian/scripts/risk-tier.py "$WORKSPACE" "origin/$DEFAULT_BRANCH" 2>>"$TASK_DIR/supervisor.log")
echo "Risk tier: $TIER" >> "$TASK_DIR/supervisor.log"

DIFF_STAT=$(git diff --stat "origin/$DEFAULT_BRANCH"...HEAD)
DIFF=$(git diff "origin/$DEFAULT_BRANCH"...HEAD | head -c 60000)

REVIEW_PROMPT="You are the VERIDIAN-DEV Superboss performing a real code review of another AI worker's completed task. Do not trust a self-report — review the actual diff below for architecture soundness, correctness, and security issues.

Before reviewing, read /opt/veridian/repos/claude-control/SUPERBOSS_DISPATCH_PROMPT.md in full using your Read tool — it is the authoritative, current standing-instructions file for this role (tiered trust model, the hard rule against .github/workflows/** changes, module routing, retry policy). Apply its rules to this review, not just the summary below.

Risk tier (deterministic, pre-classified — you cannot override this, only record your verdict): $TIER
- tier1: if you approve, this may be merged autonomously by this process.
- tier2: even if you approve, this requires human sign-off before merge — your approval only means 'ready for a human to merge', not permission to merge it yourself.

Task title: $TITLE

Diff stat:
$DIFF_STAT

Diff:
$DIFF

Write a file named review-verdict.json in the current directory (repo root) with exactly this shape and nothing else:
{\"verdict\": \"approve\" or \"reject\", \"tier\": \"$TIER\", \"summary\": \"one paragraph\", \"issues\": [\"list, empty if none\"]}
Do not modify any other file. Do not attempt to merge, push, or run git commands beyond reading the diff. If this diff touches .github/workflows/** in a way that would need to be pushed (per the hard rule in SUPERBOSS_DISPATCH_PROMPT.md), note that explicitly in issues."

SUPERVISOR_START_EPOCH=$(date -u +%s)
claude -p "$REVIEW_PROMPT" --dangerously-skip-permissions --max-budget-usd "$SUPERVISOR_BUDGET_CAP_USD" --output-format json > "$TASK_DIR/supervisor-result.json" 2>>"$TASK_DIR/supervisor.log"

# Real-cost check (see worker-entrypoint.sh for why this reads the proxy's
# own log instead of the CLI's self-reported total_cost_usd).
SUPERVISOR_COST=$(python3 -c "
import json
from datetime import datetime
start_epoch = float('$SUPERVISOR_START_EPOCH')
total = 0.0
try:
    with open('/opt/veridian/ai-os/logs/glm-proxy-calls.jsonl') as f:
        for line in f:
            try:
                rec = json.loads(line)
                ts = datetime.fromisoformat(rec['ts']).timestamp()
                if ts >= start_epoch and rec.get('real_cost_usd') is not None:
                    total += rec['real_cost_usd']
            except Exception:
                continue
except FileNotFoundError:
    pass
print(total)
")
echo "Real review cost: \$$SUPERVISOR_COST" >> "$TASK_DIR/supervisor.log"

if [ ! -f "$WORKSPACE/review-verdict.json" ]; then
  python3 /opt/veridian/scripts/veridian-task.py checkpoint "$TASK_ID" --status blocked --note "supervisor failed to produce a review verdict — see supervisor.log"
  exit 1
fi

cp "$WORKSPACE/review-verdict.json" "$TASK_DIR/review.json"
rm -f "$WORKSPACE/review-verdict.json"
VERDICT=$(python3 -c "import json; print(json.load(open('$TASK_DIR/review.json'))['verdict'])")
SUMMARY=$(python3 -c "import json; print(json.load(open('$TASK_DIR/review.json'))['summary'])")

# Create the PR (record exists regardless of outcome — auditability)
PR_URL=$(gh pr create --repo "FChecklist/$REPO" --base "$DEFAULT_BRANCH" --head "$BRANCH" \
  --title "$TITLE" \
  --body "Automated worker task \`$TASK_ID\`. Risk tier: $TIER.

Superboss review: $SUMMARY" 2>>"$TASK_DIR/supervisor.log") || PR_URL=""

if [ -z "$PR_URL" ]; then
  # PR may already exist (idempotent retry) — find it
  PR_URL=$(gh pr list --repo "FChecklist/$REPO" --head "$BRANCH" --json url -q '.[0].url' 2>>"$TASK_DIR/supervisor.log")
fi
echo "$PR_URL" > "$TASK_DIR/pr_url.txt"

# mandatory-audit-check.yml requires a structured "AUDIT: PASS/FAIL" PR
# comment (8 labeled fields, see src/lib/audit-protocol.ts) before ANY merge
# can pass required-status-checks — post it before attempting a tier1
# merge, not after, or the merge silently fails while this script still
# reports "completed"/"merged" (real incident: PR #416, 2026-07-18).
ISSUES_TEXT=$(python3 -c "import json; d=json.load(open('$TASK_DIR/review.json')); i=d.get('issues') or []; print('; '.join(i) if i else 'none')")
if [ "$VERDICT" = "approve" ]; then
  AUDIT_VERDICT_LINE="AUDIT: PASS"
  AUDIT_SEVERITY="none"
  AUDIT_CORRECTIVE="Not required -- no issues found in this review."
  AUDIT_REAUDIT="Not required -- approved as-is, no follow-up needed."
else
  AUDIT_VERDICT_LINE="AUDIT: FAIL"
  AUDIT_SEVERITY="medium"
  AUDIT_CORRECTIVE="Worker to address the findings listed above and resubmit."
  AUDIT_REAUDIT="Required after corrective changes are pushed."
fi
AUDIT_BODY="$AUDIT_VERDICT_LINE
Objective Understood: Reviewed worker task '$TITLE' (risk tier: $TIER) by reading the actual diff, not a self-report.
Standards Reviewed: AGENTS.md Operating Rule 7c structured audit protocol; risk-tier.py's deterministic tier classification.
Scope Confirmed: $DIFF_STAT
Evidence Recorded: $SUMMARY Issues found: $ISSUES_TEXT
Severity Classified: $AUDIT_SEVERITY
Verdict: $(echo "$VERDICT" | tr 'A-Z' 'a-z' | sed 's/approve/pass/;s/reject/fail/')
Corrective Action Owner: $AUDIT_CORRECTIVE
Re-Audit Scheduled: $AUDIT_REAUDIT"
gh pr comment "$PR_URL" --body "$AUDIT_BODY" >> "$TASK_DIR/supervisor.log" 2>&1

# Master/Supervisor pilot: if this task was dispatched through a module
# queue (module-queue-dispatcher.py), a module_scope.yaml sidecar declares
# its module + files_allowed. Deterministic scope-check.py enforcement --
# same trust-boundary posture as risk-tier.py, the AI reviewer's approve
# verdict cannot override a real scope violation. Tasks with no sidecar
# (the general gap-queue, pre-pilot) are unaffected -- additive only.
SCOPE_OK=1
if [ -f "$TASK_DIR/module_scope.yaml" ]; then
  MODULE=$(python3 -c "import yaml; print(yaml.safe_load(open('$TASK_DIR/module_scope.yaml'))['module'])")
  FILES_ALLOWED_CSV=$(python3 -c "import yaml; print(','.join(yaml.safe_load(open('$TASK_DIR/module_scope.yaml')).get('files_allowed') or []))")
  if ! python3 /opt/veridian/scripts/scope-check.py "$WORKSPACE" "origin/$DEFAULT_BRANCH" "$MODULE" "$FILES_ALLOWED_CSV" >> "$TASK_DIR/supervisor.log" 2>&1; then
    SCOPE_OK=0
  fi
fi

if [ "$VERDICT" = "approve" ] && [ "$TIER" = "tier1" ] && [ "$SCOPE_OK" = "1" ]; then
  # CI must actually go green (including audit-check, now satisfied above)
  # before a merge can succeed — poll briefly rather than firing the merge
  # immediately against checks that haven't finished running yet.
  for _ in $(seq 1 20); do
    STATE=$(gh pr view "$PR_URL" --json mergeStateStatus -q .mergeStateStatus 2>>"$TASK_DIR/supervisor.log")
    [ "$STATE" = "BLOCKED" ] || [ "$STATE" = "BEHIND" ] || break
    sleep 15
  done
  if gh pr merge "$PR_URL" --merge --delete-branch >> "$TASK_DIR/supervisor.log" 2>&1; then
    python3 /opt/veridian/scripts/veridian-task.py checkpoint "$TASK_ID" --status completed --note "tier1, Superboss-approved, merged autonomously: $PR_URL"
  else
    python3 /opt/veridian/scripts/veridian-task.py checkpoint "$TASK_ID" --status blocked --note "tier1, Superboss-approved, but the merge itself FAILED (see supervisor.log) — needs manual attention, NOT actually merged: $PR_URL"
  fi
elif [ "$VERDICT" = "approve" ] && [ "$TIER" = "tier1" ] && [ "$SCOPE_OK" = "0" ]; then
  gh pr comment "$PR_URL" --body "Superboss review: APPROVED and tier1, but BLOCKED by scope-check.py -- this diff touches files outside its declared module ownership. See supervisor.log for the exact violation. Not merged." >> "$TASK_DIR/supervisor.log" 2>&1
  python3 /opt/veridian/scripts/veridian-task.py checkpoint "$TASK_ID" --status blocked --note "tier1, Superboss-approved, but SCOPE VIOLATION (file-ownership) blocked the merge — see supervisor.log: $PR_URL"
elif [ "$VERDICT" = "approve" ] && [ "$TIER" = "tier2" ]; then
  python3 /opt/veridian/scripts/veridian-task.py checkpoint "$TASK_ID" --status awaiting_human_approval --note "tier2, Superboss-approved, held for human merge: $PR_URL"
else
  python3 /opt/veridian/scripts/veridian-task.py checkpoint "$TASK_ID" --status blocked --note "Superboss rejected: $PR_URL — see review.json for issues"
fi
