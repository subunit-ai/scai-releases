#!/usr/bin/env bash
# Generic disposable database provisioning; domain fixtures stay in private source.
set -euo pipefail
[[ $# -eq 2 ]] || { echo 'usage: setup-auth-ci-databases.sh <source> <env-output>' >&2; exit 64; }
source_dir=$1; github_env=$2
for helper in prepare-migration-fixture.ts seed-legacy-upgrade.sql run-proof-suite.sh; do
  test -f "$source_dir/scripts/ci/$helper" || { echo 'Private fixture helper missing' >&2; exit 65; }
done
host=${PGHOST:-127.0.0.1}; port=${PGPORT:-5432}; admin_user=${PGUSER:-postgres}
case "$host" in 127.0.0.1|localhost) ;; *) echo 'Fixture PostgreSQL must use IPv4 loopback or localhost' >&2; exit 64 ;; esac
[[ "$port" =~ ^[0-9]{1,5}$ && "$admin_user" =~ ^[a-z_][a-z0-9_]*$ ]] || exit 64
export PGPASSWORD=${PGPASSWORD:-postgres}
prefix=${AUTH_CI_PREFIX:-auth_ci_$(openssl rand -hex 4)}
[[ "$prefix" =~ ^auth_ci_[a-z0-9]{8}$ ]] || { echo 'Invalid fixture prefix' >&2; exit 64; }
migrator=${prefix}_migrator; owner=${prefix}_owner; runtime=${prefix}_runtime
migration_password=$(openssl rand -hex 24); runtime_password=$(openssl rand -hex 24)
admin_password_encoded=$(bun -e 'process.stdout.write(encodeURIComponent(process.env.PGPASSWORD ?? ""))')
admin_url="postgresql://${admin_user}:${admin_password_encoded}@${host}:${port}/postgres"
psql_admin=(psql "$admin_url" -X -v ON_ERROR_STOP=1)
databases=(test fresh upgrade workload cutover boundary atomic unknown drift)
for name in "$migrator" "$owner" "$runtime" "${databases[@]/#/${prefix}_}"; do
  collision=$("${psql_admin[@]}" -v name="$name" -At <<'SQL'
SELECT EXISTS (SELECT 1 FROM pg_roles WHERE rolname=:'name') OR EXISTS (SELECT 1 FROM pg_database WHERE datname=:'name');
SQL
  )
  [[ "$collision" = f ]] || { echo 'Fixture identity exists; refusing changes' >&2; exit 70; }
done
"${psql_admin[@]}" -v migrator="$migrator" -v owner="$owner" -v runtime="$runtime" -v mp="$migration_password" -v rp="$runtime_password" <<'SQL'
CREATE ROLE :"owner" NOLOGIN NOINHERIT NOSUPERUSER NOCREATEDB NOCREATEROLE NOREPLICATION NOBYPASSRLS;
CREATE ROLE :"migrator" LOGIN NOINHERIT NOSUPERUSER NOCREATEDB NOCREATEROLE NOREPLICATION NOBYPASSRLS PASSWORD :'mp';
CREATE ROLE :"runtime" LOGIN NOINHERIT NOSUPERUSER NOCREATEDB NOCREATEROLE NOREPLICATION NOBYPASSRLS PASSWORD :'rp';
GRANT :"owner" TO :"migrator" WITH INHERIT FALSE, SET TRUE, ADMIN FALSE;
SQL
for suffix in "${databases[@]}"; do
  "${psql_admin[@]}" -v db="${prefix}_${suffix}" -v migrator="$migrator" -v runtime="$runtime" <<'SQL'
CREATE DATABASE :"db" OWNER :"migrator";
GRANT CONNECT ON DATABASE :"db" TO :"runtime";
SQL
done
migration_url="postgresql://${migrator}:${migration_password}@${host}:${port}"
runtime_url="postgresql://${runtime}:${runtime_password}@${host}:${port}"
export DATABASE_MIGRATION_ROLE=$migrator DATABASE_OWNER_ROLE=$owner DATABASE_RUNTIME_ROLE=$runtime
run_migration() { DATABASE_MIGRATION_URL="${migration_url}/${prefix}_$1" env -u DATABASE_URL -u DATABASE_RUNTIME_URL bun "$source_dir/src/cli/migrate.ts"; }
prepare() { DATABASE_MIGRATION_URL="${migration_url}/${prefix}_$1" env -u DATABASE_URL -u DATABASE_RUNTIME_URL bun "$source_dir/scripts/ci/prepare-migration-fixture.ts" "$2"; }
for suffix in test fresh workload cutover boundary; do run_migration "$suffix"; done
prepare upgrade 35
psql "${migration_url}/${prefix}_upgrade" -X -v ON_ERROR_STOP=1 -f "$source_dir/scripts/ci/seed-legacy-upgrade.sql"
run_migration upgrade
prepare atomic 36
prepare unknown 32
# drift deliberately stays empty: its test asserts migration fails before any DDL.
workload_secret=$(openssl rand -hex 32); vault_secret=$(openssl rand -hex 32); cutover_secret=$(openssl rand -hex 32)
# Hex is converted to base64url without shell interpolation into executable code.
workload_secret=$(printf '%s' "$workload_secret" | xxd -r -p | openssl base64 -A | tr '+/' '-_' | tr -d '=')
vault_secret=$(printf '%s' "$vault_secret" | xxd -r -p | openssl base64 -A | tr '+/' '-_' | tr -d '=')
cutover_secret=$(printf '%s' "$cutover_secret" | xxd -r -p | openssl base64 -A | tr '+/' '-_' | tr -d '=')
sso_secret=$(openssl rand -base64 32 | tr '+/' '-_' | tr -d '=\n')
cat >> "$github_env" <<EOF
SSO_SESSION_SECRET=$sso_secret
AUTH_CI_ADMIN_URL=$admin_url
DATABASE_RUNTIME_URL=${runtime_url}/${prefix}_test
DATABASE_RUNTIME_ROLE=$runtime
DATABASE_MIGRATION_ROLE=$migrator
DATABASE_OWNER_ROLE=$owner
DATABASE_MIGRATION_URL=${migration_url}/${prefix}_test
WORKLOAD_DELEGATION_SECRETS=scai-operations-api:$workload_secret,scai-vault-store:$vault_secret
MOCO_CUSTOMER_CUTOVER_SECRET=$cutover_secret
AUTH_MOCO_AUTHORITY_TEST_DATABASE_URL=${runtime_url}/${prefix}_test
AUTH_MOCO_AUTHORITY_TEST_ADMIN_URL=${admin_url%/postgres}/${prefix}_test
AUTH_MOCO_AUTHORITY_FRESH_URL=${admin_url%/postgres}/${prefix}_fresh
AUTH_MOCO_AUTHORITY_UPGRADE_URL=${admin_url%/postgres}/${prefix}_upgrade
AUTH_CI_FRESH_RUNTIME_URL=${runtime_url}/${prefix}_fresh
AUTH_MOCO_PURCHASE_V2_RUNTIME_URL=${runtime_url}/${prefix}_upgrade
AUTH_WORKLOAD_TEST_DATABASE_URL=${runtime_url}/${prefix}_workload
AUTH_CUTOVER_TEST_DATABASE_URL=${runtime_url}/${prefix}_cutover
AUTH_DATABASE_BOUNDARY_RUNTIME_URL=${runtime_url}/${prefix}_boundary
AUTH_DATABASE_BOUNDARY_ADMIN_URL=${admin_url%/postgres}/${prefix}_boundary
AUTH_DATABASE_ATOMIC_MIGRATION_URL=${migration_url}/${prefix}_atomic
AUTH_DATABASE_ATOMIC_ADMIN_URL=${admin_url%/postgres}/${prefix}_atomic
AUTH_DATABASE_UNKNOWN_MIGRATION_URL=${migration_url}/${prefix}_unknown
AUTH_DATABASE_UNKNOWN_ADMIN_URL=${admin_url%/postgres}/${prefix}_unknown
AUTH_DATABASE_INHERIT_DRIFT_URL=${migration_url}/${prefix}_drift
EOF
chmod 600 "$github_env"
echo 'PASS disposable Auth database fixtures prepared'
