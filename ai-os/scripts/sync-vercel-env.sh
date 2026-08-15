#!/bin/bash
# Refreshes .env.local for the 3 linked Vercel projects with current production env vars.
set -uo pipefail
LOG=/opt/veridian/logs/sync-vercel-env-$(date +%Y%m%d-%H%M%S).log
exec > "$LOG" 2>&1
echo "=== vercel env sync $(date -u) ==="
VT=$(grep '^VERCEL_ACCESS_TOKEN=' /opt/veridian/shared/.env | cut -d= -f2)
SCOPE="meet-track-s-projects"
for repo in compliance-tracker projexa veda-advisors; do
  echo "--- $repo ---"
  cd "/opt/veridian/repos/$repo" || { echo "MISSING DIR, skip"; continue; }
  vercel env pull --token "$VT" --scope "$SCOPE" --yes .env.local 2>&1 | tail -5
done
echo "=== done $(date -u) ==="
find /opt/veridian/logs -name 'sync-vercel-env-*.log' -mtime +14 -delete
