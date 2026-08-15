#!/bin/bash
# Entrypoint for a systemd-managed VERIDIAN AI worker. Runs Claude Code headlessly
# against an isolated git worktree, checkpoints periodically, resumes from the
# last checkpoint on restart (server reboot / crash / interruption), pushes the
# branch on success (never merges/deploys), and marks failed with no infinite
# retry loop (systemd StartLimitBurst caps FAST restarts; this script's own
# lifetime-invocation counter caps SLOW-drip retries across many hours/days,
# see 2026-07-19 update below).
#
# v2 (2026-07-20, Owner "zero credit wastage" directive) adds, on top of the
# above: a pre-flight guard (static checks + canary + circuit breaker) run
# BEFORE the main invocation so failure is caught before it costs anything,
# and a compact AI-to-AI directive prompt format that stops re-sending the
# full original task prompt on every resume (previously the single biggest
# source of redundant tokens -- confirmed directly from this exact script's
# prior behavior). Full rationale: /opt/veridian/repos/compliance-tracker/ai-os/COST-CONTROL.md
#
# v3 (2026-07-20, RCA fix for the 47-failed-unit / 71.9%-task-failure-rate
# incident): 2 real bugs found and fixed, see inline comments at each site --
# (1) preflight now checks the REAL, live OpenRouter balance (not just this
# proxy's own internal spend tracker) and is added to the hard-stop list;
# (2) `claude -p --output-format json` returns exit 0 even on a real
# API-level error (e.g. a 402), which silently skipped failure-signature
# recording and let the circuit breaker never see the failure -- now
# explicitly parsed and treated as a real failure.
set -uo pipefail
TASK_ID="$1"
TASK_DIR="/opt/veridian/ai-os/tasks/$TASK_ID"
export PATH="$HOME/.local/bin:$HOME/.local/share/supabase:/usr/bin:$PATH"
START_TS=$(date +%s)

unset CLAUDE_CODE_OAUTH_TOKEN
export ANTHROPIC_BASE_URL="http://127.0.0.1:8787"
export ANTHROPIC_API_KEY="proxy-routed-not-a-real-anthropic-key"
PROXY_URL="http://127.0.0.1:8787"

WORKER_BUDGET_CAP_USD="${VERIDIAN_WORKER_BUDGET_CAP_USD:-10}"

MAX_LIFETIME_INVOCATIONS="${VERIDIAN_MAX_LIFETIME_INVOCATIONS:-20}"
INVOCATION_COUNT_FILE="$TASK_DIR/.invocation_count"
PRIOR_COUNT=$(cat "$INVOCATION_COUNT_FILE" 2>/dev/null || echo 0)
NEW_COUNT=$((PRIOR_COUNT + 1))
echo "$NEW_COUNT" > "$INVOCATION_COUNT_FILE"
if [ "$NEW_COUNT" -gt "$MAX_LIFETIME_INVOCATIONS" ]; then
  python3 /opt/veridian/scripts/veridian-task.py checkpoint "$TASK_ID" --status blocked --note "PREVENTION CAP HIT: this task has been started/restarted $NEW_COUNT times (lifetime max $MAX_LIFETIME_INVOCATIONS) -- stopping to prevent an unbounded slow-drip retry loop across restarts, the same shape as the 2026-07-18 incident. Needs human review, not an automatic retry."
  systemctl --user disable "veridian-worker@${TASK_ID}.service" >> "$TASK_DIR/worker.log" 2>&1 || true
  exit 0
fi

WORKSPACE=$(python3 -c "import yaml; print(yaml.safe_load(open('$TASK_DIR/task.yaml'))['workspace'])")
BRANCH=$(python3 -c "import yaml; print(yaml.safe_load(open('$TASK_DIR/task.yaml'))['branch'])")
CHECKPOINT_COUNT=$(python3 -c "import yaml; print(len(yaml.safe_load(open('$TASK_DIR/task.yaml')).get('checkpoints', [])))")

if [ "$CHECKPOINT_COUNT" -gt 0 ]; then
  IS_RESUME=1
else
  IS_RESUME=0
fi

# --- Pre-flight guard (2026-07-20): static checks + canary + circuit breaker,
# all before the main (potentially tens-of-thousands-of-tokens) invocation.
# A rejection here costs $0-0.0002 (canary only) instead of a full invocation.
GUARD_OUT=$(python3 /opt/veridian/scripts/preflight-guard.py "$TASK_DIR" "$WORKSPACE" "$PROXY_URL" 2>&1)
GUARD_EXIT=$?
if [ "$GUARD_EXIT" -ne 0 ]; then
  GUARD_REASON=$(echo "$GUARD_OUT" | python3 -c "import json,sys; print(json.load(sys.stdin).get('reason','unknown'))" 2>/dev/null || echo "unknown")
  GUARD_DETAIL=$(echo "$GUARD_OUT" | python3 -c "import json,sys; print(json.load(sys.stdin).get('detail',''))" 2>/dev/null || echo "$GUARD_OUT")
  if [ "$GUARD_REASON" = "circuit_breaker_tripped" ] || [ "$GUARD_REASON" = "budget_exhausted" ] || [ "$GUARD_REASON" = "openrouter_balance_exhausted" ] || [ "$GUARD_REASON" = "credit_accountant_rejected" ]; then
    # Hard stops -- retrying will not help, do not let systemd restart this.
    # openrouter_balance_exhausted added 2026-07-20 (RCA fix): confirmed root
    # cause of a 47-failed-unit incident was a real, live OpenRouter 402 that
    # this preflight check now catches BEFORE the wasted call, but which
    # (like circuit_breaker_tripped/budget_exhausted) must be a hard stop,
    # not a retryable transient -- retrying an empty account produces the
    # identical failure every time until a human adds credits.
    # credit_accountant_rejected added 2026-07-20 (round-2 audit fix, same
    # day): the credit-accountant.py gate's own deterministic rejections
    # (balance/existing-capability/sequencing) share the identical property
    # -- blind retry produces the identical rejection until a human
    # intervenes. Confirmed live: 163 tasks were stuck in a restart-storm
    # before this fix because this reason fell through to the transient
    # branch below instead.
    python3 /opt/veridian/scripts/veridian-task.py checkpoint "$TASK_ID" --status blocked --note "PRE-FLIGHT HARD STOP ($GUARD_REASON): $GUARD_DETAIL"
    systemctl --user disable "veridian-worker@${TASK_ID}.service" >> "$TASK_DIR/worker.log" 2>&1 || true
    exit 0
  else
    # Transient (disk/mem/proxy/worktree) -- let systemd's normal
    # Restart=on-failure retry after RestartSec, still counted against the
    # lifetime invocation cap above.
    python3 /opt/veridian/scripts/veridian-task.py checkpoint "$TASK_ID" --status failed --note "PRE-FLIGHT REJECTED ($GUARD_REASON, transient): $GUARD_DETAIL -- no model call made, no cost incurred"
    exit 1
  fi
fi

python3 /opt/veridian/scripts/veridian-task.py checkpoint "$TASK_ID" --status in_progress --note "worker started (resume=$IS_RESUME, lifetime invocation $NEW_COUNT/$MAX_LIFETIME_INVOCATIONS, pre-flight passed)"

# Background checkpoint loop: snapshots git state + PROGRESS.md every 5 minutes
# regardless of whether the AI itself remembers to checkpoint.
(
  while true; do
    sleep 300
    python3 /opt/veridian/scripts/veridian-task.py checkpoint "$TASK_ID" --auto --note "periodic checkpoint"
  done
) &
CHECKPOINT_PID=$!
trap 'kill $CHECKPOINT_PID 2>/dev/null' EXIT

cd "$WORKSPACE"

PROGRESS_INSTRUCTION="PROTOCOL: maintain PROGRESS.md (## Completed / ## Remaining, markdown checkboxes), update after each step. commit+push after each meaningful unit, not only at the end. on a 2nd consecutive failure of the identical approach: STOP, do not attempt a 3rd time -- this is enforced by a circuit breaker on the next invocation regardless, so stopping yourself first saves a wasted restart."

if [ "$IS_RESUME" -eq 1 ]; then
  RESUME_CONTEXT=$(python3 /opt/veridian/scripts/veridian-task.py resume-context "$TASK_ID")
  PROMPT="RESUME task=$TASK_ID invocation=$NEW_COUNT/$MAX_LIFETIME_INVOCATIONS
DO_NOT restart from scratch. run: git status && git log --oneline -10 && read PROGRESS.md.
LAST_CHECKPOINT:
$RESUME_CONTEXT
SPEC: full task spec is prompt.txt in cwd (provided once already, not restated here -- read it only if you need it).
$PROGRESS_INSTRUCTION"
else
  PROMPT="SPEC: $(cat "$TASK_DIR/prompt.txt")

$PROGRESS_INSTRUCTION"
fi

MAIN_OUT="$TASK_DIR/.claude-out-main.json"
MAIN_START_EPOCH=$(date -u +%s)
claude -p "$PROMPT" --dangerously-skip-permissions --max-budget-usd "$WORKER_BUDGET_CAP_USD" --output-format json > "$MAIN_OUT" 2>>"$TASK_DIR/worker.log"
EXIT_CODE=$?
cat "$MAIN_OUT" >> "$TASK_DIR/result.json"

# --- API-level error detection (2026-07-20 RCA fix) ---
# Confirmed root cause of the 47-failed-unit incident: `claude -p
# --output-format json` returns exit code 0 even when the underlying API
# call itself failed (e.g. a real OpenRouter 402) -- the error is captured
# INSIDE the JSON payload ("is_error":true), never surfaced as a non-zero
# process exit. This silently skipped the EXIT_CODE!=0 branch below
# entirely -- no failure signature was ever recorded for this task, so the
# circuit breaker never had a chance to trip on the 2nd identical failure,
# and every failed attempt fell through toward the "no changes to commit"
# path instead, while systemd's OWN restart policy still cycled the unit.
# Explicitly parse the JSON result for is_error now, and treat it exactly
# like a non-zero EXIT_CODE -- this is the fix that makes the circuit
# breaker and failure-signature recording actually see this failure class.
API_IS_ERROR=$(python3 -c "
import json
try:
    with open('$MAIN_OUT') as f:
        d = json.load(f)
    print('1' if d.get('is_error') else '0')
except Exception:
    print('0')
")
if [ "$API_IS_ERROR" = "1" ] && [ "$EXIT_CODE" -eq 0 ]; then
  EXIT_CODE=1
  echo "API-level error detected in result JSON (is_error=true) despite exit code 0 -- treating as failure. See $MAIN_OUT for the real API error." >> "$TASK_DIR/worker.log"
fi

# --- CLI's own max-budget-usd hard stop (2026-07-20 RCA fix, 2nd distinct
# root cause of the same incident) ---
# A genuinely large/looping task can hit `claude -p`'s own --max-budget-usd
# ceiling ("subtype":"error_max_budget_usd", "terminal_reason":
# "budget_exhausted" in $MAIN_OUT) -- this is a DIFFERENT failure class from
# a plain API error: retrying will almost certainly just spend ANOTHER
# $WORKER_BUDGET_CAP_USD hitting the identical wall again, real avoidable
# waste, exactly what this whole guard system exists to prevent. Before this
# fix the generic EXIT_CODE!=0 branch below treated this the same as any
# other retryable failure, so it ALSO retry-stormed into a permanent
# systemd 'failed' state (confirmed: 2 of the 47 affected units in the
# 2026-07-20 incident were this exact pattern, not the OpenRouter-balance
# one -- found by checking real result.json content per unit before
# assuming one root cause explained all 47). This is a hard stop, same
# treatment as the pre-flight guard's own budget_exhausted/
# openrouter_balance_exhausted reasons: checkpoint blocked, disable the
# unit, exit 0 -- no retry.
CLI_HIT_BUDGET_CAP=$(python3 -c "
import json
try:
    with open('$MAIN_OUT') as f:
        d = json.load(f)
    print('1' if d.get('subtype') == 'error_max_budget_usd' or d.get('terminal_reason') == 'budget_exhausted' else '0')
except Exception:
    print('0')
")
if [ "$CLI_HIT_BUDGET_CAP" = "1" ]; then
  python3 /opt/veridian/scripts/veridian-task.py checkpoint "$TASK_ID" --status blocked --note "CLI HARD STOP (max_budget_usd): this invocation's own self-reported cost hit the \$$WORKER_BUDGET_CAP_USD per-task cap ($MAIN_OUT). Stopping rather than retrying -- a retry will very likely spend another \$$WORKER_BUDGET_CAP_USD hitting the identical wall. Needs human review: either the task is too large for one invocation (split it) or it is genuinely stuck/looping."
  git -C "$WORKSPACE" add -A
  git -C "$WORKSPACE" commit -m "Worker $TASK_ID: automated checkpoint commit (CLI hit its own max-budget-usd cap)" >> "$TASK_DIR/worker.log" 2>&1 || true
  git -C "$WORKSPACE" push -u origin "$BRANCH" >> "$TASK_DIR/worker.log" 2>&1 || true
  systemctl --user disable "veridian-worker@${TASK_ID}.service" >> "$TASK_DIR/worker.log" 2>&1 || true
  kill "$CHECKPOINT_PID" 2>/dev/null || true
  wait "$CHECKPOINT_PID" 2>/dev/null || true
  exit 0
fi

kill "$CHECKPOINT_PID" 2>/dev/null || true
wait "$CHECKPOINT_PID" 2>/dev/null || true

END_TS=$(date +%s)
ELAPSED=$((END_TS - START_TS))
python3 /opt/veridian/scripts/veridian-task.py record-usage "$TASK_ID" --elapsed "$ELAPSED"

real_invocation_cost_usd() {
  python3 -c "
import json
from datetime import datetime
start_epoch = float('$1')
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
"
}

budget_exceeded() {
  python3 -c "print(1 if float('$1' or 0) >= float('$WORKER_BUDGET_CAP_USD') * 0.95 else 0)"
}

# --- Failure-signature recording (2026-07-20) ---
# Feeds the circuit breaker in preflight-guard.py on the NEXT invocation.
# Signature = a stable fingerprint of the failure: last 400 chars of
# worker.log PLUS the result.json's own error text when present (2026-07-20
# RCA fix -- an API-level error like the 402 above produces ZERO worker.log
# output, so hashing worker.log alone always produced the same signature
# regardless of the REAL error). Two consecutive identical signatures trips
# the breaker before a 3rd attempt is ever made.
record_failure_signature() {
  python3 -c "
import hashlib, json, os
sig_file = '$TASK_DIR/.failure_signatures.json'
try:
    with open('$TASK_DIR/worker.log') as f:
        tail = f.read()[-400:]
except FileNotFoundError:
    tail = 'no-worker-log'
try:
    with open('$MAIN_OUT') as f:
        result = json.load(f)
    api_err = result.get('result', '') if result.get('is_error') else ''
except Exception:
    api_err = ''
normalized = ' '.join((tail + ' ' + api_err[:200]).split())
sig = hashlib.sha256(normalized.encode()).hexdigest()[:24]
sigs = []
if os.path.exists(sig_file):
    try:
        sigs = json.load(open(sig_file))
    except Exception:
        sigs = []
sigs.append(sig)
sigs = sigs[-10:]
json.dump(sigs, open(sig_file, 'w'))
"
}

if [ "$EXIT_CODE" -ne 0 ]; then
  record_failure_signature
  FAIL_COST=$(real_invocation_cost_usd "$MAIN_START_EPOCH")
  python3 /opt/veridian/scripts/credit-accountant.py report --task-id "$TASK_ID" --increment 1 --actual-spend-usd "$FAIL_COST" --outcome "main invocation FAILED, exit code $EXIT_CODE, real cost \$$FAIL_COST -- see worker.log" >> "$TASK_DIR/worker.log" 2>&1 || true
  git -C "$WORKSPACE" add -A
  git -C "$WORKSPACE" commit -m "Worker $TASK_ID: checkpoint commit (invocation failed, exit $EXIT_CODE)" >> "$TASK_DIR/worker.log" 2>&1 || true
  git -C "$WORKSPACE" push -u origin "$BRANCH" >> "$TASK_DIR/worker.log" 2>&1 || true
  python3 /opt/veridian/scripts/veridian-task.py checkpoint "$TASK_ID" --status failed --note "worker exited with code $EXIT_CODE; failure signature recorded for circuit breaker; pushed whatever progress existed; systemd will retry up to the burst limit"
  exit 1
fi

MAIN_COST=$(real_invocation_cost_usd "$MAIN_START_EPOCH")
python3 /opt/veridian/scripts/credit-accountant.py report --task-id "$TASK_ID" --increment 1 --actual-spend-usd "$MAIN_COST" --outcome "main invocation completed, exit 0, real cost \$$MAIN_COST" >> "$TASK_DIR/worker.log" 2>&1 || true
if [ "$(budget_exceeded "$MAIN_COST")" = "1" ]; then
  python3 /opt/veridian/scripts/veridian-task.py checkpoint "$TASK_ID" --status blocked --note "PREVENTION CAP HIT: this invocation's REAL OpenRouter/GLM-5.2 cost was \$$MAIN_COST, at/above the \$$WORKER_BUDGET_CAP_USD budget cap -- stopped rather than continuing unbounded. Needs human review before further retries (likely a stuck/looping task, not ordinary progress)."
  git -C "$WORKSPACE" add -A
  git -C "$WORKSPACE" commit -m "Worker $TASK_ID: automated checkpoint commit (budget cap hit)" >> "$TASK_DIR/worker.log" 2>&1 || true
  git -C "$WORKSPACE" push -u origin "$BRANCH" >> "$TASK_DIR/worker.log" 2>&1 || true
  systemctl --user disable "veridian-worker@${TASK_ID}.service" >> "$TASK_DIR/worker.log" 2>&1 || true
  exit 0
fi

if git -C "$WORKSPACE" diff --quiet && git -C "$WORKSPACE" diff --cached --quiet && [ -z "$(git -C "$WORKSPACE" status --porcelain)" ]; then
  python3 /opt/veridian/scripts/veridian-task.py checkpoint "$TASK_ID" --status completed --note "worker finished, no changes to commit"
  systemctl --user disable "veridian-worker@${TASK_ID}.service" >> "$TASK_DIR/worker.log" 2>&1 || true
  exit 0
fi

# Quality gates: up to 2 auto-fix attempts (same conversation via --continue)
# before giving up and marking blocked for human review.
GATE_ATTEMPT=0
GATE_PASSED=0
while [ "$GATE_ATTEMPT" -lt 3 ]; do
  echo "=== quality gate attempt $GATE_ATTEMPT ===" >> "$TASK_DIR/worker.log"
  if bash /opt/veridian/scripts/quality-gate.sh "$WORKSPACE" "$TASK_DIR/quality-gate-$GATE_ATTEMPT.json" >> "$TASK_DIR/worker.log" 2>&1; then
    GATE_PASSED=1
    break
  fi
  GATE_ATTEMPT=$((GATE_ATTEMPT + 1))
  if [ "$GATE_ATTEMPT" -ge 3 ]; then
    break
  fi
  python3 /opt/veridian/scripts/veridian-task.py checkpoint "$TASK_ID" --status in_progress --note "quality gate failed, attempting auto-fix ($GATE_ATTEMPT/2)"
  FIX_PROMPT="GATE_FAIL attempt=$GATE_ATTEMPT/2. Fix the underlying issue, do not silence the checker. output:
$(cat "$TASK_DIR/quality-gate-$((GATE_ATTEMPT-1)).json" | python3 -c 'import json,sys; d=json.load(sys.stdin); [print(f"--{k}--\n{v.get(\"output_tail\",\"\")}") for k,v in d.items() if not v.get("passed", True)]' 2>/dev/null)

$PROGRESS_INSTRUCTION"
  FIX_PROPOSE_OUT=$(python3 /opt/veridian/scripts/credit-accountant.py propose --task-id "$TASK_ID" --plan "auto-fix attempt $GATE_ATTEMPT/2 for quality gate failure on task $TASK_ID, see quality-gate-$((GATE_ATTEMPT-1)).json for the failing checks" --search-terms "quality gate auto-fix retry")
  FIX_PROPOSE_RC=$?
  echo "$FIX_PROPOSE_OUT" >> "$TASK_DIR/worker.log"
  if [ "$FIX_PROPOSE_RC" -ne 0 ]; then
    python3 /opt/veridian/scripts/veridian-task.py checkpoint "$TASK_ID" --status blocked --note "credit accountant rejected auto-fix attempt $GATE_ATTEMPT, no further metered spend without human review: $FIX_PROPOSE_OUT"
    git -C "$WORKSPACE" add -A
    git -C "$WORKSPACE" commit -m "Worker $TASK_ID: automated checkpoint commit (credit accountant rejected auto-fix)" >> "$TASK_DIR/worker.log" 2>&1 || true
    git -C "$WORKSPACE" push -u origin "$BRANCH" >> "$TASK_DIR/worker.log" 2>&1 || true
    systemctl --user disable "veridian-worker@${TASK_ID}.service" >> "$TASK_DIR/worker.log" 2>&1 || true
    exit 0
  fi
  FIX_INCREMENT=$(echo "$FIX_PROPOSE_OUT" | python3 -c "import json,sys; print(json.load(sys.stdin).get('increment_number', $GATE_ATTEMPT + 1))" 2>/dev/null)
  FIX_INCREMENT="${FIX_INCREMENT:-$((GATE_ATTEMPT + 1))}"
  FIX_OUT="$TASK_DIR/.claude-out-fix-$GATE_ATTEMPT.json"
  FIX_START_EPOCH=$(date -u +%s)
  claude -p "$FIX_PROMPT" --continue --dangerously-skip-permissions --max-budget-usd "$WORKER_BUDGET_CAP_USD" --output-format json > "$FIX_OUT" 2>>"$TASK_DIR/worker.log"
  cat "$FIX_OUT" >> "$TASK_DIR/result.json"
  FIX_COST=$(real_invocation_cost_usd "$FIX_START_EPOCH")
  python3 /opt/veridian/scripts/credit-accountant.py report --task-id "$TASK_ID" --increment "$FIX_INCREMENT" --actual-spend-usd "$FIX_COST" --outcome "auto-fix attempt $GATE_ATTEMPT/2 completed, real cost \$$FIX_COST" >> "$TASK_DIR/worker.log" 2>&1 || true
  if [ "$(budget_exceeded "$FIX_COST")" = "1" ]; then
    python3 /opt/veridian/scripts/veridian-task.py checkpoint "$TASK_ID" --status blocked --note "PREVENTION CAP HIT: auto-fix attempt $GATE_ATTEMPT real cost \$$FIX_COST, at/above the \$$WORKER_BUDGET_CAP_USD budget cap. Stopping auto-fix loop for human review rather than continuing unbounded."
    git -C "$WORKSPACE" add -A
    git -C "$WORKSPACE" commit -m "Worker $TASK_ID: automated checkpoint commit (budget cap hit during auto-fix)" >> "$TASK_DIR/worker.log" 2>&1 || true
    git -C "$WORKSPACE" push -u origin "$BRANCH" >> "$TASK_DIR/worker.log" 2>&1 || true
    systemctl --user disable "veridian-worker@${TASK_ID}.service" >> "$TASK_DIR/worker.log" 2>&1 || true
    exit 0
  fi
done

git -C "$WORKSPACE" add -A
git -C "$WORKSPACE" commit -m "Worker $TASK_ID: automated checkpoint commit" >> "$TASK_DIR/worker.log" 2>&1 || true

if [ "$GATE_PASSED" -eq 1 ]; then
  git -C "$WORKSPACE" push -u origin "$BRANCH" >> "$TASK_DIR/worker.log" 2>&1
  python3 /opt/veridian/scripts/veridian-task.py checkpoint "$TASK_ID" --status pending_review --note "quality gates passed, pushed branch $BRANCH, awaiting review"
  systemctl --user disable "veridian-worker@${TASK_ID}.service" >> "$TASK_DIR/worker.log" 2>&1 || true
  systemctl --user start "veridian-supervisor@${TASK_ID}.service" >> "$TASK_DIR/worker.log" 2>&1 || true
else
  git -C "$WORKSPACE" push -u origin "$BRANCH" >> "$TASK_DIR/worker.log" 2>&1
  python3 /opt/veridian/scripts/veridian-task.py checkpoint "$TASK_ID" --status blocked --note "quality gates still failing after $((GATE_ATTEMPT)) auto-fix attempts; branch $BRANCH pushed with failing state for human review, see quality-gate-*.json"
  systemctl --user disable "veridian-worker@${TASK_ID}.service" >> "$TASK_DIR/worker.log" 2>&1 || true
fi
