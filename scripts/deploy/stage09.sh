#!/usr/bin/env bash
set -Eeuo pipefail
umask 077
old=/opt/vianoor-stage08
new=/opt/vianoor-stage09
test "$(id -u)" -eq 0
test "$(pwd -P)" = "$new"
test "$(git branch --show-current)" = stage/09-scheduling-booking
test -z "$(git status --porcelain)"
test ! -e infra/local
test ! -e infra/identity.compose.json
test -f "$old/infra/identity.compose.json"
for image in vianoor-services:stage9 vianoor-web:stage9; do docker image inspect "$image" >/dev/null; done
backup="/root/vianoor-backups/stage09-$(date -u +%Y%m%dT%H%M%SZ)"
mkdir -p "$backup"
docker exec vianoor-stage4-postgres-1 pg_dumpall -U postgres | gzip > "$backup/cluster.sql.gz"
gzip -t "$backup/cluster.sql.gz"
cp -a "$old/infra/local" "$backup/local"
cp -p "$old/infra/identity.compose.json" "$backup/identity.compose.json"
docker image inspect vianoor-services:stage8 vianoor-web:stage8 --format '{{.Id}}' > "$backup/previous-images.txt"
cp -a "$old/infra/local" infra/local
cp -p "$old/infra/identity.compose.json" infra/identity.compose.json
docker run --rm --user 0:0 -v "$new:/work" -w /work vianoor-services:stage9 node scripts/scheduling/prepare.mjs
compose=(docker compose -f "$new/infra/identity.compose.json")
"${compose[@]}" config -q
activated=0
rollback() {
  status=$?
  trap - ERR
  if [ "$activated" -eq 1 ]; then
    echo 'Activation failed; restoring stage 8 services. Existing and newly added data are preserved.' >&2
    "${compose[@]}" stop availability-service || true
    docker compose -f "$old/infra/identity.compose.json" up -d --no-deps --no-build --force-recreate identity-service organization-service profile-service file-service consent-service booking-service scholar-service taxonomy-service api-gateway web || true
  fi
  echo 'Private backup retained; inspect prepared configuration before retry.' >&2
  exit "$status"
}
trap rollback ERR
activated=1
"${compose[@]}" up -d --no-deps --no-build --wait --wait-timeout 180 identity-service taxonomy-service scholar-service organization-service profile-service file-service consent-service
"${compose[@]}" up -d --no-deps --no-build --wait --wait-timeout 180 availability-service booking-service
"${compose[@]}" up -d --no-deps --no-build --wait --wait-timeout 180 api-gateway web
ready=0
for _ in $(seq 1 30); do
  if curl -fsS --max-time 5 http://127.0.0.1:18874/vianoor/api/version | grep -q 'V9.0.0'; then ready=1; break; fi
  sleep 2
done
test "$ready" -eq 1
docker exec -i vianoor-stage4-identity-service-1 node --input-type=module <<'JS'
const r=await fetch('http://127.0.0.1:4101/internal/mail-status',{headers:{'x-internal-key':process.env.AUTH_INTERNAL_KEY}});
const s=await r.json(); if(!r.ok||!s.smtp_ready)throw Error('SMTP not ready'); console.log('Production SMTP ready.');
JS
for service in availability-service booking-service; do
  docker exec -i -e STAGE9_PROBE_SERVICE="$service" "vianoor-stage4-$service-1" node --input-type=module <<'JS'
import pg from 'pg';
const db = new pg.Pool({connectionString:process.env.DATABASE_URL});
try {
  const tables = process.env.STAGE9_PROBE_SERVICE === 'availability-service' ? ['expert_calendars','availability_slots','slot_claims'] : ['scheduled_bookings','booking_events','booking_notifications'];
  for (const table of tables) { const r=await db.query('SELECT to_regclass($1) AS name',[table]); if(!r.rows[0].name)throw Error('Missing scheduling table'); }
  console.log('Scheduling owner schema verified.');
} finally { await db.end(); }
JS
done
activated=0
trap - ERR
echo 'Stage 9 activated; private pre-deployment backup retained.'
