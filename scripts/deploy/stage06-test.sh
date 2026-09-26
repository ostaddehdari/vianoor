#!/usr/bin/env bash
set -Eeuo pipefail
umask 077
root=$(pwd -P)
test_root="$root/.cache/stage06-test"
if [ ! -f "$root/scripts/users/prepare.mjs" ]; then echo 'Run from the stage 6 repository.' >&2; exit 1; fi
mkdir -p "$test_root/infra/qa"
if [ ! -f "$test_root/infra/identity.compose.json" ]; then
  cp "$root/infra/compose.json" "$test_root/infra/compose.json"
  run=(docker run --rm --user 0:0 -v "$test_root:/work" -v "$root/scripts:/work/scripts:ro" -v "$root/docs:/work/docs:ro" -w /work)
  "${run[@]}" vianoor-services:stage6 node scripts/infra/prepare.mjs
  "${run[@]}" -e AUTH_DEVELOPMENT=1 -e AUTH_PUBLIC_URL=http://127.0.0.1:18876/vianoor vianoor-services:stage6 node scripts/identity/prepare.mjs
  "${run[@]}" -e USERS_TEST=1 vianoor-services:stage6 node scripts/users/prepare.mjs
fi
compose=(docker compose -f "$test_root/infra/identity.compose.json")
"${compose[@]}" up -d --no-build --wait --wait-timeout 180 postgres redis nats mailpit identity-service api-gateway organization-service profile-service file-service consent-service booking-service web
"${compose[@]}" run --rm users-test
echo 'Isolated stage 6 integration suite completed; test web listens only on 127.0.0.1:18876.'
