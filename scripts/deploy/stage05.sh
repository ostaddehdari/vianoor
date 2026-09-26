#!/usr/bin/env bash
set -Eeuo pipefail
umask 077

old=/opt/vianoor-stage4
new=/opt/vianoor-stage05
expected_commit=820c727

if [ "$(id -u)" -ne 0 ]; then
  echo 'Run as root on the Vianoor server.' >&2
  exit 1
fi
if [ "$(pwd -P)" != "$new" ] ||
   [ "$(git branch --show-current)" != 'stage/05-multimethod-auth' ] ||
   ! git merge-base --is-ancestor "$expected_commit" HEAD; then
  echo "Stop: expected stage/05-multimethod-auth in $new containing $expected_commit." >&2
  exit 1
fi
if [ -n "$(git status --porcelain)" ]; then
  echo 'Stop: new checkout has local changes.' >&2
  exit 1
fi
for file in "$old/infra/identity.compose.json" "$old/infra/local/identity-auth.env" "$old/infra/local/web-auth.env"; do
  if [ ! -f "$file" ]; then echo "Stop: missing $file" >&2; exit 1; fi
done
if [ -e "$new/infra/local" ] || [ -e "$new/infra/identity.compose.json" ]; then
  echo 'Stop: this checkout was already prepared. Inspect it before retrying.' >&2
  exit 1
fi
docker_root=$(docker info -f '{{.DockerRootDir}}')
free_kib=$(df -Pk "$docker_root" | awk 'NR==2 { print $4 }')
if [ "$free_kib" -lt 4194304 ]; then
  echo 'Stop: Docker rebuild requires at least 4 GiB free on this filesystem.' >&2
  exit 1
fi
for container in vianoor-stage4-postgres-1 vianoor-stage4-redis-1 vianoor-stage4-nats-1 vianoor-stage4-api-gateway-1 vianoor-stage4-identity-service-1; do
  health=$(docker inspect -f '{{if .State.Health}}{{.State.Health.Status}}{{else}}{{.State.Status}}{{end}}' "$container")
  if [ "$health" != healthy ]; then echo "Stop: $container is $health" >&2; exit 1; fi
done

cp -a "$old/infra/local" "$new/infra/local"
cp -p "$old/infra/identity.compose.json" "$new/infra/identity.compose.json"
python3 - <<'PY'
import json
from pathlib import Path

p = Path('infra/identity.compose.json')
d = json.loads(p.read_text())
if d.get('name') != 'vianoor-stage4':
    raise SystemExit('Stop: unexpected Docker Compose project name.')
services = d['services']
if services['identity-service']['image'] != 'vianoor-services:stage4' or services['web']['image'] != 'vianoor-web:stage4':
    raise SystemExit('Stop: unexpected old image tags.')
services['identity-service']['image'] = 'vianoor-services:stage5'
services['web']['image'] = 'vianoor-web:stage5'
p.write_text(json.dumps(d, indent=2) + '\n')
PY

old_compose="$old/infra/identity.compose.json"
new_compose="$new/infra/identity.compose.json"
docker compose -f "$new_compose" config -q
echo 'Building stage 5 images while stage 4 remains online.'
docker compose -f "$new_compose" build identity-service web

activated=0
rollback() {
  status=$?
  trap - ERR
  if [ "$activated" -eq 1 ]; then
    echo 'Health check failed. Restoring stage 4 identity and web containers.' >&2
    docker compose -f "$old_compose" up -d --no-deps --force-recreate identity-service web || true
  fi
  exit "$status"
}
trap rollback ERR
activated=1
docker compose -f "$new_compose" up -d --no-deps --force-recreate identity-service web

ready=0
for _ in $(seq 1 30); do
  health=$(docker inspect -f '{{if .State.Health}}{{.State.Health.Status}}{{else}}{{.State.Status}}{{end}}' vianoor-stage4-identity-service-1)
  if [ "$health" = healthy ] && curl -fsS --max-time 5 -o /dev/null http://127.0.0.1:18874/vianoor/fa/auth/login; then
    ready=1
    break
  fi
  sleep 5
done
if [ "$ready" -ne 1 ]; then
  echo 'New containers did not become healthy.' >&2
  false
fi
activated=0
trap - ERR
echo 'Stage 5 checkout is live. Current images:'
docker ps --filter name=vianoor-stage4 --format 'table {{.Names}}\t{{.Image}}\t{{.Status}}'
echo 'SMTP delivery status (without recipient or message content):'
docker exec vianoor-stage4-identity-service-1 node -e '
fetch("http://127.0.0.1:4101/internal/mail-status", {
  headers: { "x-internal-key": process.env.AUTH_INTERNAL_KEY ?? "" }
}).then(async r => { console.log(r.status, await r.text()); if (!r.ok) process.exitCode = 1 })
.catch(() => { console.error("Identity unreachable"); process.exitCode = 1 })
' || echo 'Mail status could not be checked. The website is running; inspect SMTP separately.'
