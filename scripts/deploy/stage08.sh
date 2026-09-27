#!/usr/bin/env bash
set -Eeuo pipefail
umask 077
old=/opt/vianoor-stage06
new=/opt/vianoor-stage08
test "$(id -u)" -eq 0
test "$(pwd -P)" = "$new"
test "$(git branch --show-current)" = stage/08-scholars-services-files
test -z "$(git status --porcelain)"
test ! -e infra/local
test ! -e infra/identity.compose.json
test -f "$old/infra/identity.compose.json"
for image in vianoor-services:stage8 vianoor-web:stage8; do docker image inspect "$image" >/dev/null; done
backup="/root/vianoor-backups/stage08-$(date -u +%Y%m%dT%H%M%SZ)"
mkdir -p "$backup"
docker exec vianoor-stage4-postgres-1 pg_dumpall -U postgres | gzip > "$backup/cluster.sql.gz"
gzip -t "$backup/cluster.sql.gz"
cp -a "$old/infra/local" "$backup/local"
cp -p "$old/infra/identity.compose.json" "$backup/identity.compose.json"
docker run --rm --user 0:0 -v vianoor-stage4_avatars:/source:ro -v "$backup:/backup" --entrypoint tar vianoor-services:stage8 -czf /backup/avatars.tar.gz -C /source .
cp -a "$old/infra/local" infra/local
cp -p "$old/infra/identity.compose.json" infra/identity.compose.json
docker run --rm --user 0:0 -v "$new:/work" -w /work vianoor-services:stage8 node scripts/scholars/prepare.mjs
compose=(docker compose -f "$new/infra/identity.compose.json")
"${compose[@]}" config -q
activated=0
rollback() {
  status=$?
  trap - ERR
  if [ "$activated" -eq 1 ]; then
    echo 'Activation failed; restoring stage 6 services. Database and objects are preserved.' >&2
    "${compose[@]}" stop scholar-service taxonomy-service || true
    docker compose -f "$old/infra/identity.compose.json" up -d --no-deps --no-build --force-recreate identity-service organization-service profile-service file-service consent-service booking-service api-gateway web || true
  fi
  echo 'Private backup retained; inspect prepared configuration before retry.' >&2
  exit "$status"
}
trap rollback ERR
"${compose[@]}" up -d --no-deps --no-build --wait --wait-timeout 300 object-storage scanner
activated=1
"${compose[@]}" up -d --no-deps --no-build --wait --wait-timeout 180 identity-service taxonomy-service scholar-service
"${compose[@]}" up -d --no-deps --no-build --wait --wait-timeout 180 organization-service profile-service file-service consent-service booking-service
"${compose[@]}" up -d --no-deps --no-build --wait --wait-timeout 180 api-gateway web
ready=0
for _ in $(seq 1 30); do
  if curl -fsS --max-time 5 http://127.0.0.1:18874/vianoor/api/version | grep -q 'V8.0.0'; then ready=1; break; fi
  sleep 2
done
test "$ready" -eq 1
docker exec -i vianoor-stage4-file-service-1 node --input-type=module <<'JS'
import assert from 'node:assert/strict';
import { randomUUID } from 'node:crypto';
import { putObject, getObject, deleteObject } from './services/file-service/dist/object-store.js';
import { scan } from './services/file-service/dist/scanner.js';
const key = 'deployment-probe/' + randomUUID(), bytes = Buffer.from('Vianoor stage 8 deployment probe');
try { await putObject(key,bytes,'text/plain'); assert.deepEqual(await getObject(key),bytes); }
finally { await deleteObject(key); }
assert.equal(await scan(bytes),'CLEAN');
console.log('Production object storage read/write/delete and ClamAV scan passed.');
JS
docker exec -i vianoor-stage4-identity-service-1 node --input-type=module <<'JS'
const r=await fetch('http://127.0.0.1:4101/internal/mail-status',{headers:{'x-internal-key':process.env.AUTH_INTERNAL_KEY}});
const s=await r.json(); if(!r.ok||!s.smtp_ready)throw Error('SMTP not ready'); console.log('Production SMTP ready.');
JS
activated=0
trap - ERR
echo 'Stage 8 activated; private pre-deployment backup retained.'
