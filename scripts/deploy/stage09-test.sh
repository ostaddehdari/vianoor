#!/usr/bin/env bash
set -Eeuo pipefail
umask 077
root=$(pwd -P)
test_root="$root/.cache/stage09-test"
mkdir -p "$test_root/infra/qa"
run=(docker run --rm --user 0:0 -v "$test_root:/work" -v "$root/scripts:/work/scripts:ro" -v "$root/docs:/work/docs:ro" -w /work)
if [ ! -f "$test_root/infra/identity.compose.json" ]; then
  cp "$root/infra/compose.json" "$test_root/infra/compose.json"
  "${run[@]}" vianoor-services:stage9 node scripts/infra/prepare.mjs
  "${run[@]}" -e AUTH_DEVELOPMENT=1 -e AUTH_PUBLIC_URL=http://127.0.0.1:18886/vianoor vianoor-services:stage9 node scripts/identity/prepare.mjs
  "${run[@]}" vianoor-services:stage9 node scripts/users/prepare.mjs
fi
"${run[@]}" -e SCHOLARS_TEST=1 vianoor-services:stage9 node scripts/scholars/prepare.mjs
"${run[@]}" -e SCHEDULING_TEST=1 vianoor-services:stage9 node scripts/scheduling/prepare.mjs
compose=(docker compose -f "$test_root/infra/identity.compose.json")
"${compose[@]}" up -d --no-build --wait --wait-timeout 300 postgres redis nats mailpit object-storage scanner identity-service organization-service profile-service file-service consent-service booking-service scholar-service taxonomy-service availability-service api-gateway web
"${compose[@]}" run --rm scholars-test
"${compose[@]}" run --rm scheduling-test
