#!/usr/bin/env bash
set -Eeuo pipefail
umask 077
old=/opt/vianoor-stage09
new=/opt/vianoor-stage10
test "$(id -u)" -eq 0
test "$(pwd -P)" = "$new"
test "$(git branch --show-current)" = stage/10-multilingual-discovery
for image in vianoor-services:stage10 vianoor-web:stage10; do docker image inspect "$image" >/dev/null; done
if [ ! -f infra/identity.compose.json ]; then
  backup="/root/vianoor-backups/stage10-$(date -u +%Y%m%dT%H%M%SZ)"
  mkdir -p "$backup"
  docker exec vianoor-stage4-postgres-1 pg_dumpall -U postgres | gzip > "$backup/cluster.sql.gz"
  gzip -t "$backup/cluster.sql.gz"
  cp -a "$old/infra/local" "$backup/local"
  cp -p "$old/infra/identity.compose.json" "$backup/identity.compose.json"
  cp -a "$old/infra/local" infra/local
  cp -p "$old/infra/identity.compose.json" infra/identity.compose.json
fi
baseline=()
if [ -x /opt/vianoor-opensearch-runtime/bin/opensearch ]; then
  baseline=(-e OPENSEARCH_BASELINE_RUNTIME=/opt/vianoor-opensearch-runtime)
fi
docker run --rm --user 0:0 "${baseline[@]}" -v "$new:/work" -w /work vianoor-services:stage10 node scripts/discovery/prepare.mjs
compose=(docker compose -f "$new/infra/identity.compose.json")
"${compose[@]}" config -q
docker volume create vianoor-stage4_search-index >/dev/null
docker run --rm --user 0:0 -v vianoor-stage4_search-index:/data node:24.19.0-bookworm-slim chown 1000:1000 /data
activated=0
rollback() {
  status=$?
  trap - ERR
  if [ "$activated" -eq 1 ]; then
    "${compose[@]}" stop search-service matching-service || true
    docker compose -f "$old/infra/identity.compose.json" up -d --no-deps --no-build identity-service organization-service profile-service file-service consent-service taxonomy-service scholar-service availability-service booking-service api-gateway web || true
  fi
  echo 'Activation failed. Additive data retained; inspect the deployment logs.' >&2
  exit "$status"
}
trap rollback ERR
"${compose[@]}" up -d --no-deps --no-build --wait --wait-timeout 240 opensearch
activated=1
"${compose[@]}" up -d --no-deps --no-build --wait --wait-timeout 180 identity-service organization-service profile-service file-service consent-service taxonomy-service scholar-service
"${compose[@]}" exec -T taxonomy-service node scripts/discovery/bootstrap.mjs </dev/null
"${compose[@]}" up -d --no-deps --no-build --wait --wait-timeout 180 availability-service booking-service search-service matching-service api-gateway web
curl -fsS --max-time 30 http://127.0.0.1:18874/vianoor/api/version | grep -q 'V10.0.0'
trap - ERR
echo 'Stage 10 demo activated. Verify /fa/experts and /en/admin/localization.'
