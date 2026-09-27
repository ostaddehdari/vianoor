#!/usr/bin/env bash
set -Eeuo pipefail
[[ "$(pwd -P)" == /opt/vianoor-stage11 ]] || { echo 'Expected stage 11 checkout'; exit 1; }
umask 077
backup="/opt/vianoor-backups/stage11-$(date -u +%Y%m%dT%H%M%SZ)"
mkdir -p "$backup"
cp infra/identity.compose.json "$backup/compose-before.json"
tar -czf "$backup/private-config.tgz" infra/local
docker exec vianoor-stage4-postgres-1 pg_dumpall -U postgres | gzip > "$backup/postgres-before.sql.gz"
test -s "$backup/postgres-before.sql.gz"
node scripts/finance/prepare.mjs
cp infra/local/finance-key.env "$backup/finance-key.env"
docker compose -p vianoor-stage4 -f infra/identity.compose.json up -d --no-build --wait identity-service organization-service profile-service file-service consent-service scholar-service taxonomy-service availability-service booking-service accounting-service wallet-service payment-service payout-service dispute-service search-service matching-service api-gateway web </dev/null
docker compose -p vianoor-stage4 -f infra/identity.compose.json exec -T taxonomy-service node scripts/discovery/bootstrap.mjs </dev/null
printf 'Backup directory: %s\n' "$backup"
