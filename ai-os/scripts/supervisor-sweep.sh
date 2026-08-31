#!/bin/bash
# Safety net: catches any task stuck in pending_review with no review.json,
# meaning its immediate supervisor trigger was missed (crash, systemd hiccup).
set -uo pipefail
LOG=/opt/veridian/logs/supervisor-sweep-$(date +%Y%m%d-%H%M%S).log
exec > "$LOG" 2>&1
echo "=== supervisor sweep $(date -u) ==="

for task_dir in /opt/veridian/ai-os/tasks/*/; do
  task_id=$(basename "$task_dir")
  [ -f "${task_dir}task.yaml" ] || continue
  status=$(python3 -c "import yaml; print(yaml.safe_load(open('${task_dir}task.yaml'))['status'])" 2>/dev/null || echo "")
  if [ "$status" = "pending_review" ] && [ ! -f "${task_dir}review.json" ]; then
    echo "Missed trigger found: $task_id — starting supervisor"
    systemctl --user daemon-reload
    systemctl --user start "veridian-supervisor@${task_id}.service"
  fi
done

echo "=== done $(date -u) ==="
find /opt/veridian/logs -name 'supervisor-sweep-*.log' -mtime +14 -delete
