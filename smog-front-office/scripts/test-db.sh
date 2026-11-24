#!/usr/bin/env bash
# Apply migrations + seed to a scratch PostgreSQL database and run the business-rule tests.
# Usage: PGHOST=... PGPORT=... PGUSER=postgres scripts/test-db.sh   (needs PostgreSQL 15+, pgcrypto)
set -euo pipefail
cd "$(dirname "$0")/.."
DB=${TEST_DB:-smog_test}
P="psql -v ON_ERROR_STOP=1 -q"
$P -d postgres -c "drop database if exists $DB" -c "create database $DB" >/dev/null
$P -d "$DB" -f supabase/tests/supabase_stubs.sql >/dev/null 2>&1
for f in supabase/migrations/*.sql supabase/seed.sql; do $P -d "$DB" -f "$f" >/dev/null; done
$P -d "$DB" -o /dev/null -f supabase/tests/business_rules.sql
echo "ALL RULES PASS"
