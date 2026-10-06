#!/bin/bash
# Builds a fresh LOCAL database: the Supabase stand-in, every migration in
# order, then seed.sql. Drops and recreates only the named local database.
#   PGHOST=/tmp PGPORT=54329 scripts/local-e2e/build-db.sh ember_e2e
set -euo pipefail
DB=${1:?database name}
HOST=${PGHOST:-localhost}
case "$HOST" in localhost|127.0.0.1|/*) ;; *) echo "Refusing non-local host $HOST" >&2; exit 1 ;; esac
HERE=$(cd "$(dirname "$0")" && pwd)
P="psql -h $HOST -p ${PGPORT:-5432} -U ${PGUSER:-postgres} -v ON_ERROR_STOP=1 -q"
$P -d postgres -c "drop database if exists $DB" -c "create database $DB"
$P -d "$DB" -f "$HERE/supabase-stub.sql" >/dev/null
for f in "$HERE"/../../supabase/migrations/*.sql; do
  $P -d "$DB" -f "$f" >/dev/null 2>/tmp/local-e2e-migration.err || { echo "FAILED: $f"; head -5 /tmp/local-e2e-migration.err; exit 1; }
done
$P -d "$DB" -f "$HERE/seed.sql" >/dev/null
echo "Built $DB: $(ls "$HERE"/../../supabase/migrations/*.sql | wc -l) migrations + seed"
