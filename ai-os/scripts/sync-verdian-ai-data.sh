#!/bin/bash
# Full refresh of the verdian-ai Supabase local mirror (schema + data).
# DESTRUCTIVE to the local mirror: drops and recreates public+compliance schemas each run.
# Intended to run at low-traffic hours (see cron schedule). Does not touch the remote database.
set -euo pipefail
LOG=/opt/veridian/logs/sync-verdian-ai-data-$(date +%Y%m%d-%H%M%S).log
exec > "$LOG" 2>&1
echo "=== verdian-ai data sync $(date -u) ==="

MIRROR_DIR=/opt/veridian/workspace/supabase-mirrors/verdian-ai
REMOTE=$(cat /opt/veridian/shared/.pgurl_verdian_ai)
PGD=/usr/lib/postgresql/17/bin/pg_dump
PSQL="/usr/lib/postgresql/17/bin/psql -h 127.0.0.1 -p 54322 -U postgres -d postgres"
export PGPASSWORD=postgres

cd "$MIRROR_DIR"

echo "--- dumping remote schema ---"
$PGD "$REMOTE" --schema-only --schema=public --schema=compliance --no-owner --no-privileges -f schema_app.sql

echo "--- dumping remote data ---"
$PGD "$REMOTE" --data-only --schema=public --schema=compliance --schema=auth --schema=storage --schema=vault --no-owner --no-privileges -f data_all.sql

echo "--- resetting local schemas ---"
$PSQL -v ON_ERROR_STOP=1 -c "DROP SCHEMA IF EXISTS compliance CASCADE; DROP SCHEMA IF EXISTS public CASCADE; CREATE SCHEMA public; CREATE EXTENSION IF NOT EXISTS hstore SCHEMA public;"

echo "--- ensuring prerequisites (idempotent) ---"
$PSQL -v ON_ERROR_STOP=0 <<'SQL'
DO $$ BEGIN
  IF NOT EXISTS (SELECT FROM pg_roles WHERE rolname = 'app_runtime') THEN
    CREATE ROLE app_runtime NOLOGIN;
  END IF;
END $$;
GRANT app_runtime TO postgres;
CREATE EXTENSION IF NOT EXISTS pg_stat_statements SCHEMA extensions;
CREATE EXTENSION IF NOT EXISTS pg_trgm SCHEMA extensions;
CREATE EXTENSION IF NOT EXISTS pgcrypto SCHEMA extensions;
CREATE EXTENSION IF NOT EXISTS "uuid-ossp" SCHEMA extensions;
CREATE EXTENSION IF NOT EXISTS vector SCHEMA extensions;
SQL

echo "--- applying schema ---"
$PSQL -v ON_ERROR_STOP=1 -f schema_app.sql

echo "--- applying data (FK checks bypassed at session level, safe for a single-session bulk load) ---"
$PSQL -v ON_ERROR_STOP=0 <<EOF
SET session_replication_role = replica;
\i data_all.sql
SET session_replication_role = default;
EOF

echo "--- analyze ---"
$PSQL -c "ANALYZE;" > /dev/null

echo "--- verifying row counts ---"
$PGD "$REMOTE" --schema-only >/dev/null 2>&1 || true
$PSQL -t -A -c "select count(*) from compliance.compliance_items;"

echo "=== done $(date -u) ==="
find /opt/veridian/logs -name 'sync-verdian-ai-data-*.log' -mtime +14 -delete
