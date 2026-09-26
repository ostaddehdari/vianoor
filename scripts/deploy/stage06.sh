#!/usr/bin/env bash
set -Eeuo pipefail
umask 077
old=/opt/vianoor-stage05
new=/opt/vianoor-stage06
if [ "$(id -u)" -ne 0 ] || [ "$(pwd -P)" != "$new" ] || [ "$(git branch --show-current)" != stage/06-users-permissions ]; then
  echo 'Run as root in /opt/vianoor-stage06 on stage/06-users-permissions.' >&2; exit 1
fi
if [ -n "$(git status --porcelain)" ]; then echo 'Stop: checkout has local changes.' >&2; exit 1; fi
if [ -e infra/local ] || [ -e infra/identity.compose.json ]; then echo 'Stop: deployment is already prepared; inspect before retrying.' >&2; exit 1; fi
for image in vianoor-services:stage6 vianoor-web:stage6; do docker image inspect "$image" >/dev/null; done
if [ ! -f "$old/infra/identity.compose.json" ]; then echo 'Existing stage 5 installation missing.' >&2; exit 1; fi
backup="/root/vianoor-backups/stage06-$(date -u +%Y%m%dT%H%M%SZ)"
mkdir -p "$backup"
docker exec vianoor-stage4-postgres-1 pg_dumpall -U postgres > "$backup/cluster.sql"
test -s "$backup/cluster.sql"
cp -a "$old/infra/local" infra/local
cp -p "$old/infra/identity.compose.json" infra/identity.compose.json
cp -p "$old/infra/identity.compose.json" "$backup/identity.compose.json"
docker run --rm --user 0:0 -v "$new:/work" -w /work vianoor-services:stage6 node scripts/users/prepare.mjs
compose=(docker compose -f "$new/infra/identity.compose.json")
"${compose[@]}" config -q
activated=0
rollback() {
  status=$?
  trap - ERR
  if [ "$activated" -eq 1 ]; then
    echo 'Activation failed; restoring previous identity, gateway and web images.' >&2
    docker compose -f "$old/infra/identity.compose.json" up -d --no-deps --force-recreate identity-service api-gateway web || true
  fi
  echo 'Backup is preserved in the private server backup directory.' >&2
  exit "$status"
}
trap rollback ERR
activated=1
"${compose[@]}" up -d --no-deps --no-build --wait --wait-timeout 180 identity-service
"${compose[@]}" up -d --no-deps --no-build --wait --wait-timeout 180 organization-service profile-service file-service consent-service booking-service
"${compose[@]}" up -d --no-deps --no-build --wait --wait-timeout 180 api-gateway web
ready=0
for _ in $(seq 1 30); do
  if curl -fsS --max-time 5 -o /dev/null http://127.0.0.1:18874/vianoor/fa/account; then ready=1; break; fi
  sleep 2
done
test "$ready" -eq 1
docker exec vianoor-stage4-identity-service-1 node --input-type=module -e '
const response=await fetch("http://127.0.0.1:4101/internal/mail-status",{headers:{"x-internal-key":process.env.AUTH_INTERNAL_KEY}});
const status=await response.json();console.log(JSON.stringify({smtp_ready:status.smtp_ready,pending:status.queue?.pending}));
if(!response.ok||!status.smtp_ready)process.exitCode=1;
'
activated=0
trap - ERR
echo 'Stage 6 activated. Bootstrap the verified owner account using the stage 6 runbook.'
